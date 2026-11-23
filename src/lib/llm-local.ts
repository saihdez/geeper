/**
 * El modelo local (Ollama de MoneyPrinterTurbo) con salida restringida por esquema (A3 de
 * docs/STACK-AGENTICO.md). Un solo camino para ganchos, títulos e ideas de anuncios.
 *
 * Vía: la API HTTP de Ollama (`/api/chat`) desde un puente de Python dentro del contenedor de la API de
 * MPT, que ve a `ollama` por la red de Docker. No abre puertos en el host ni toca el compose de MPT, y
 * a diferencia de `ollama run --format json` acepta un JSON Schema completo en `format`: Ollama lo
 * convierte en gramática y el modelo no puede salirse de la forma. Igual se valida **siempre** con Zod
 * (los refinamientos y los largos finos no llegan a la gramática).
 *
 * La GPU: se toma `gpu-lock` (sin esperar, salvo que se pida) y el modelo se descarga al terminar
 * (`keep_alive: 0`): los renders necesitan la VRAM. Con el candado en la mano se enciende Ollama si un
 * corte lo dejó apagado (GPU-02).
 *
 * El tope (300 s por defecto, GPU-09) corta **dentro** del contenedor: el puente cierra la conexión y
 * Ollama deja de cargar o generar. Con `ollama run` por `docker exec`, matar el `docker exec` dejaba a
 * Ollama cargando ~12 GB sin candado; y 150 s no alcanzaban para la primera carga en frío.
 *
 * Traído de la rama feat/stack-llm-local (8d8cbfe y d2bc173) sin las trazas de OpenTelemetry, que esa
 * rama trae aparte (decisión 6.3 #5 de la auditoría: sólo el cliente).
 */
import { z } from "zod";
import { tomarGpu, type Candado } from "./gpu";
import { encenderIaMpt, OLLAMA_MPT, type Encendido } from "./ia-mpt";
import { correr } from "./proceso";
import { MPT_CONTENEDOR } from "./rutas";

/** Tope por defecto de un pedido, con la carga en frío del modelo incluida (GPU-09). */
export const TOPE_LLM_MS = 300_000;
/** Lo que se le dice a la persona mientras el modelo carga (keep_alive 0: casi siempre en frío). */
export const AVISO_DESPERTANDO = "La IA está despertando: puede tardar hasta 3 min.";

export type CausaLlm =
  | "gpu-ocupada"
  | "docker-apagado"
  | "mpt-apagado"
  | "ollama-no-responde"
  | "modelo-falta"
  | "tiempo"
  | "respuesta-invalida"
  | "otro";

const MENSAJES: Record<CausaLlm, string> = {
  "gpu-ocupada": "La tarjeta de video está ocupada (renderizando o generando). Prueba en un rato.",
  "docker-apagado": "La IA local usa MoneyPrinterTurbo: abre Docker Desktop, espera a que arranque y vuelve a intentar.",
  "mpt-apagado": "La IA local (MoneyPrinterTurbo) no está encendida: abre Docker Desktop, espera un minuto y vuelve a intentar.",
  "ollama-no-responde": "El modelo local (Ollama de MPT) no responde.",
  "modelo-falta": "Falta el modelo en la IA local.",
  tiempo: "El modelo local tardó demasiado.",
  "respuesta-invalida": "El modelo local respondió algo que no tiene la forma esperada. Vuelve a intentarlo.",
  otro: "La IA local no respondió.",
};

export class ErrorLlm extends Error {
  constructor(
    readonly causa: CausaLlm,
    readonly detalle = "",
    mensaje = MENSAJES[causa],
  ) {
    super(mensaje);
    this.name = "ErrorLlm";
  }
}

export interface ResultadoEjecutor {
  codigo: number;
  stdout: string;
  stderr: string;
}
/** Corre el puente con el cuerpo del pedido en stdin. Las pruebas pasan uno falso. */
export type EjecutorLlm = (cuerpo: string, timeoutMs: number, signal?: AbortSignal) => Promise<ResultadoEjecutor>;

export interface OpcionesLlm {
  /** Para gpu-lock y las trazas: qué pide el modelo («ganchos», «títulos»…). */
  tarea: string;
  sistema?: string;
  temperatura?: number;
  /** Imágenes en base64 (modelos con visión). */
  imagenes?: string[];
  timeoutMs?: number;
  /** Esperar la GPU en vez de rendirse si está ocupada. */
  esperarGpu?: boolean;
  /** `esquema` (por defecto): JSON Schema en `format`. `json`: sólo JSON libre (respaldo si un esquema no entra en la gramática). */
  formato?: "esquema" | "json";
  /**
   * Dejar que el modelo «piense» antes de responder (gemma4, qwen3). Apagado por defecto: con salida
   * estructurada no mejora el JSON y gasta el contexto; medido el 2026-11-20 (DECISIONES §34), con
   * pensamiento el director de gemma4:12b se cortaba a la mitad en 32 s y sin él sale completo en 9 s.
   */
  pensar?: boolean;
  ejecutar?: EjecutorLlm;
  /** Para pruebas: cómo se toma la GPU. */
  candado?: (tarea: string, esperar: boolean, alEsperar?: (quien: string) => void) => Promise<Candado | null>;
  /** Para pruebas: cómo se enciende Ollama si quedó apagado. */
  encender?: () => Promise<Encendido>;
  /** Cancelar (el trabajo de la cola): corta la espera de la tarjeta y el pedido. */
  signal?: AbortSignal;
  /** Avisos para la persona o el registro: la tarjeta está ocupada, la IA está despertando. */
  avisar?: (texto: string) => void;
}

export interface RespuestaLlm<T> {
  datos: T;
  crudo: string;
  modelo: string;
  duracionMs: number;
  tokensEntrada?: number;
  tokensSalida?: number;
}

// Corre dentro del contenedor de la API de MPT: lee el pedido por stdin, habla con Ollama por la red de
// Docker e imprime la respuesta completa de Ollama (texto + conteo de tokens).
export const PUENTE = `
import json, sys, urllib.request, urllib.error
cuerpo = sys.stdin.read().encode()
r = urllib.request.Request("http://ollama:11434/api/chat", data=cuerpo, headers={"content-type": "application/json"})
try:
    with urllib.request.urlopen(r, timeout=int(sys.argv[1])) as resp:
        sys.stdout.write(resp.read().decode())
except urllib.error.HTTPError as e:
    sys.stderr.write("HTTP %d: %s" % (e.code, e.read().decode()[:400]))
    sys.exit(3)
`;

const ejecutorDocker: EjecutorLlm = (cuerpo, timeoutMs, signal) =>
  correr("docker", ["exec", "-i", MPT_CONTENEDOR, "python", "-c", PUENTE, String(Math.ceil(timeoutMs / 1000) - 5)], {
    entrada: cuerpo,
    timeout: timeoutMs,
    permitirFallo: true,
    signal,
  });

/**
 * JSON Schema para el `format` de Ollama (función pura): el de salida (todo campo con valor por defecto
 * queda obligatorio, así el modelo lo escribe), sin `$schema` ni `$id`. Zod no emite `$ref` salvo en
 * esquemas recursivos, que aquí no hay; si apareciera uno se avisa.
 */
export function esquemaParaOllama(esquema: z.ZodType): Record<string, unknown> {
  const j = z.toJSONSchema(esquema, { target: "draft-2020-12", io: "output", unrepresentable: "any" }) as Record<string, unknown>;
  delete j.$schema;
  delete j.$id;
  if (JSON.stringify(j).includes('"$ref"')) throw new Error("El esquema tiene $ref: Ollama no lo convierte bien en gramática; simplifícalo.");
  return j;
}

/** Clasifica un fallo del puente (función pura). */
export function causaDeFallo(r: ResultadoEjecutor): CausaLlm {
  const e = r.stderr;
  // «Error response from daemon: No such container» = Docker prendido y MPT apagado: va primero.
  if (/No such container|is not running/i.test(e)) return "mpt-apagado";
  if (/docker API|daemon|dockerDesktop|cannot find the file|no puede encontrar|pipe/i.test(e)) return "docker-apagado";
  if (/HTTP 404|not found|try pulling/i.test(e)) return "modelo-falta";
  if (/timed out|timeout/i.test(e)) return "tiempo";
  if (/Connection refused|Name or service not known|URLError|Temporary failure/i.test(e)) return "ollama-no-responde";
  return "otro";
}

/** Quita cercas de Markdown que algunos modelos agregan aun con `format`. */
function sinCercas(t: string): string {
  return t.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
}

/** Pide JSON al modelo local y lo valida con `esquema`. */
export async function pedirJson<T>(modelo: string, prompt: string, esquema: z.ZodType<T>, op: OpcionesLlm): Promise<RespuestaLlm<T>> {
  const tomar = op.candado ?? ((t: string, esperar: boolean, alEsperar?: (quien: string) => void) => tomarGpu(t, { esperar, signal: op.signal, alEsperar }));
  const candado = await tomar(op.tarea, op.esperarGpu ?? false, (quien) => op.avisar?.(`La tarjeta de video está ocupada (${quien.slice(0, 80)}); la IA espera su turno y sigue sola.`));
  if (!candado) throw new ErrorLlm("gpu-ocupada");
  const timeoutMs = op.timeoutMs ?? TOPE_LLM_MS;
  const inicio = Date.now();
  try {
    // Con la tarjeta en la mano: si un corte dejó apagado a Ollama, se enciende (GPU-02).
    const ia = await (op.encender ?? (() => encenderIaMpt({ contenedores: [OLLAMA_MPT], log: op.avisar })))().catch(() => null);
    if (ia?.sinDocker) throw new ErrorLlm("docker-apagado");
    if (ia?.faltan.includes(OLLAMA_MPT)) throw new ErrorLlm("mpt-apagado");
    op.avisar?.(AVISO_DESPERTANDO);
    const cuerpo = {
      model: modelo,
      stream: false,
      format: op.formato === "json" ? "json" : esquemaParaOllama(esquema),
      keep_alive: 0,
      think: op.pensar ?? false,
      options: op.temperatura === undefined ? {} : { temperature: op.temperatura },
      messages: [
        ...(op.sistema ? [{ role: "system", content: op.sistema }] : []),
        { role: "user", content: prompt, ...(op.imagenes?.length ? { images: op.imagenes } : {}) },
      ],
    };
    const r = await (op.ejecutar ?? ejecutorDocker)(JSON.stringify(cuerpo), timeoutMs, op.signal);
    if (r.codigo !== 0) {
      const causa = causaDeFallo(r);
      const detalle = r.stderr.trim().split("\n").pop()?.slice(0, 200) ?? "";
      throw new ErrorLlm(causa, detalle, causa === "modelo-falta" ? `Falta el modelo ${modelo} en la IA local.` : undefined);
    }
    let respuesta: { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; done_reason?: string };
    try {
      respuesta = JSON.parse(r.stdout);
    } catch {
      throw new ErrorLlm("ollama-no-responde", r.stdout.slice(0, 200));
    }
    const crudo = respuesta.message?.content ?? "";
    if (respuesta.done_reason === "length") throw new ErrorLlm("respuesta-invalida", `respuesta cortada: se acabó el contexto (${respuesta.eval_count ?? "?"} tokens de salida)`);
    let json: unknown;
    try {
      json = JSON.parse(sinCercas(crudo));
    } catch {
      throw new ErrorLlm("respuesta-invalida", crudo.slice(0, 200));
    }
    const v = esquema.safeParse(json);
    if (!v.success) throw new ErrorLlm("respuesta-invalida", v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300));
    return {
      datos: v.data,
      crudo,
      modelo,
      duracionMs: Date.now() - inicio,
      tokensEntrada: respuesta.prompt_eval_count,
      tokensSalida: respuesta.eval_count,
    };
  } finally {
    candado.liberar();
  }
}
