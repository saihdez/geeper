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
 * (`keep_alive: 0`): los renders necesitan la VRAM.
 */
import { z } from "zod";
import { tomarGpu, type Candado } from "./gpu";
import { correr } from "./proceso";
import { MPT_CONTENEDOR } from "./rutas";
import { enSpan } from "./trazas";

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
  "mpt-apagado": "MoneyPrinterTurbo no está corriendo (`pnpm run doctor` dice qué falta).",
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
export type EjecutorLlm = (cuerpo: string, timeoutMs: number) => Promise<ResultadoEjecutor>;

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
  ejecutar?: EjecutorLlm;
  /** Para pruebas: cómo se toma la GPU. */
  candado?: (tarea: string, esperar: boolean) => Promise<Candado | null>;
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

const ejecutorDocker: EjecutorLlm = (cuerpo, timeoutMs) =>
  correr("docker", ["exec", "-i", MPT_CONTENEDOR, "python", "-c", PUENTE, String(Math.ceil(timeoutMs / 1000) - 5)], {
    entrada: cuerpo,
    timeout: timeoutMs,
    permitirFallo: true,
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

/**
 * Pide JSON al modelo local. Queda en la traza como un *span* `chat <modelo>` con las convenciones
 * GenAI de OpenTelemetry (modelo, tokens de entrada y salida) y `error.type` si falla.
 */
export async function pedirJson<T>(modelo: string, prompt: string, esquema: z.ZodType<T>, op: OpcionesLlm): Promise<RespuestaLlm<T>> {
  const atributos = {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": "ollama",
    "gen_ai.request.model": modelo,
    "gen_ai.output.type": "json",
    "geeper.llm.tarea": op.tarea,
    "geeper.llm.formato": op.formato ?? "esquema",
    ...(op.temperatura === undefined ? {} : { "gen_ai.request.temperature": op.temperatura }),
  };
  return enSpan(`chat ${modelo}`, atributos, async (span) => {
    try {
      const r = await pedirJsonSinTraza(modelo, prompt, esquema, op);
      span.setAttributes({
        "gen_ai.response.model": modelo,
        ...(r.tokensEntrada === undefined ? {} : { "gen_ai.usage.input_tokens": r.tokensEntrada }),
        ...(r.tokensSalida === undefined ? {} : { "gen_ai.usage.output_tokens": r.tokensSalida }),
      });
      return r;
    } catch (e) {
      span.setAttribute("error.type", e instanceof ErrorLlm ? e.causa : "otro");
      throw e;
    }
  });
}

async function pedirJsonSinTraza<T>(modelo: string, prompt: string, esquema: z.ZodType<T>, op: OpcionesLlm): Promise<RespuestaLlm<T>> {
  const tomar = op.candado ?? ((t: string, esperar: boolean) => tomarGpu(t, { esperar }));
  const candado = await tomar(op.tarea, op.esperarGpu ?? false);
  if (!candado) throw new ErrorLlm("gpu-ocupada");
  const timeoutMs = op.timeoutMs ?? 170_000;
  const inicio = Date.now();
  try {
    const cuerpo = {
      model: modelo,
      stream: false,
      format: op.formato === "json" ? "json" : esquemaParaOllama(esquema),
      keep_alive: 0,
      options: op.temperatura === undefined ? {} : { temperature: op.temperatura },
      messages: [
        ...(op.sistema ? [{ role: "system", content: op.sistema }] : []),
        { role: "user", content: prompt, ...(op.imagenes?.length ? { images: op.imagenes } : {}) },
      ],
    };
    const r = await (op.ejecutar ?? ejecutorDocker)(JSON.stringify(cuerpo), timeoutMs);
    if (r.codigo !== 0) {
      const causa = causaDeFallo(r);
      const detalle = r.stderr.trim().split("\n").pop()?.slice(0, 200) ?? "";
      throw new ErrorLlm(causa, detalle, causa === "modelo-falta" ? `Falta el modelo ${modelo} en la IA local.` : undefined);
    }
    let respuesta: { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    try {
      respuesta = JSON.parse(r.stdout);
    } catch {
      throw new ErrorLlm("ollama-no-responde", r.stdout.slice(0, 200));
    }
    const crudo = respuesta.message?.content ?? "";
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
