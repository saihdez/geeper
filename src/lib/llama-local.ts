/**
 * Motor de texto local con llama.cpp (títulos, ganchos, texto de publicación, traducción, efectos de
 * sonido). Para cada pedido se abre `llama-server` con el GGUF del estudio, se pide la respuesta en JSON
 * por la API compatible con OpenAI y se cierra: la VRAM queda libre antes de soltar el candado de GPU, que
 * siempre toma quien llama.
 *
 * Si no hay llama.cpp o su modelo (la app de escritorio, una PC sin compilar) o si falla, devuelve null y
 * quien llama sigue con el Ollama de MPT. `pedirJson` (llm-local.ts) lo usa primero, con su esquema. `GEEPER_LLM=ollama` lo apaga.
 *
 * Sin «pensar en voz alta» (`--reasoning off`): Gemma razonaba antes del JSON y rompía la lectura (ver
 * ganchos.ts). `response_format: json_object` fuerza JSON con gramática, así que la salida siempre se puede
 * leer.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ESTUDIO } from "./rutas";

export const LLAMA_SERVER = process.env.GEEPER_LLAMA_SERVER ?? path.join(ESTUDIO, "src", "llama.cpp", "build", "bin", "llama-server");
/** GGUF de Gemma 4 26B sacado del Ollama de MPT (`llama traer-de-ollama gemma4:26b`): no se baja nada. */
export const LLAMA_MODELO = process.env.GEEPER_LLAMA_MODELO ?? path.join(ESTUDIO, "modelos", "gguf", "gemma4-26b.gguf");
/**
 * Borrador de Gemma 4 (la capa «draft» del mismo modelo de Ollama): decodificación especulativa, misma
 * respuesta y más rápida. Si no está, se usa sin él. `GEEPER_LLAMA_BORRADOR=0` lo apaga.
 */
export const LLAMA_BORRADOR = process.env.GEEPER_LLAMA_BORRADOR_RUTA ?? LLAMA_MODELO.replace(/\.gguf$/, "-borrador.gguf");
/** 8080 es la API de MPT y 8501 su web. */
export const LLAMA_PUERTO = Number(process.env.GEEPER_LLAMA_PUERTO ?? 8095);
/** Cargar ~16 GB del disco y repartir capas entre VRAM y RAM. */
const ESPERA_CARGA_MS = 240_000;

export interface OpcionesLlama {
  timeout: number;
  signal?: AbortSignal;
  log?: (linea: string) => void;
}

/** ¿Se puede usar llama.cpp? Se lee en cada llamada: las pruebas fijan las variables antes. */
export function llamaDisponible(): boolean {
  if (process.env.GEEPER_LLM === "ollama") return false;
  // En las pruebas nunca se abre el llama-server real (usaría la GPU): sólo si la prueba lo pide.
  if (process.env.VITEST && process.env.GEEPER_LLM !== "llama") return false;
  return existsSync(LLAMA_SERVER) && existsSync(LLAMA_MODELO);
}

/** Nombre corto del motor para registros e informes. */
export function nombreMotorLlama(): string {
  return `llama.cpp (${path.basename(LLAMA_MODELO, ".gguf")})`;
}

export function argsServidor(contexto: number): string[] {
  return [
    "-m", LLAMA_MODELO,
    "--host", "127.0.0.1", "--port", String(LLAMA_PUERTO),
    // --fit (por defecto) reparte las capas según la VRAM libre: el 26B no entra entero en 16 GB.
    "-fa", "on", "--jinja", "-c", String(contexto), "-np", "1",
    "--reasoning", "off", "--no-webui",
    // El tipo de especulación (Gemma 4: borrador que comparte la caché) lo deduce llama.cpp del GGUF.
    ...(process.env.GEEPER_LLAMA_BORRADOR !== "0" && existsSync(LLAMA_BORRADOR) ? ["-md", LLAMA_BORRADOR] : []),
  ];
}

/** Cierra el servidor y espera a que salga (si no, la VRAM sigue ocupada al soltar el candado). */
async function cerrar(hijo: ChildProcess): Promise<void> {
  if (hijo.exitCode !== null || hijo.signalCode !== null) return;
  const salio = new Promise<void>((ok) => hijo.once("exit", () => ok()));
  hijo.kill("SIGTERM");
  const forzar = setTimeout(() => hijo.kill("SIGKILL"), 10_000);
  await salio;
  clearTimeout(forzar);
}

const dormir = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok, mal) => {
    const t = setTimeout(ok, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), mal(signal.reason)), { once: true });
  });

/**
 * Pregunta a llama.cpp y devuelve el texto (JSON). null si no está disponible o falló: quien llama usa
 * Ollama. Si la persona canceló (`signal`), lanza el error de cancelación en vez de seguir con Ollama.
 */
export async function preguntarLlama(prompt: string, op: OpcionesLlama): Promise<string | null> {
  if (!llamaDisponible()) return null;
  const limite = AbortSignal.timeout(op.timeout);
  const signal = op.signal ? AbortSignal.any([op.signal, limite]) : limite;
  const contexto = Math.min(32_768, Math.max(8192, 2048 * Math.ceil((prompt.length / 2 + 4096) / 2048)));
  // Otro servidor en el puerto (p. ej. un `llama servidor` abierto a mano): no se le pregunta a ése.
  const ocupado = await fetch(`http://127.0.0.1:${LLAMA_PUERTO}/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  if (ocupado) {
    op.log?.(`El puerto ${LLAMA_PUERTO} ya está en uso; sigo con Ollama.`);
    return null;
  }
  let stderr = "";
  let hijo: ChildProcess;
  try {
    hijo = spawn(LLAMA_SERVER, argsServidor(contexto), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  } catch (e) {
    op.log?.(`llama.cpp no arrancó (${(e as Error).message}); sigo con Ollama.`);
    return null;
  }
  hijo.stderr?.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  const murio = new Promise<string>((ok) => {
    hijo.once("error", (e) => ok(e.message));
    hijo.once("exit", (c, s) => ok(`salió con ${c ?? s}`));
  });
  let terminado: string | null = null;
  void murio.then((m) => (terminado = m));
  const base = `http://127.0.0.1:${LLAMA_PUERTO}`;
  try {
    op.log?.(`Cargando ${nombreMotorLlama()}…`);
    const hasta = Date.now() + ESPERA_CARGA_MS;
    for (;;) {
      if (terminado) throw new Error(`llama-server ${terminado}`);
      if (Date.now() > hasta) throw new Error("el modelo no terminó de cargar a tiempo");
      const ok = await fetch(`${base}/health`, { signal }).then((r) => r.ok, () => false);
      if (signal.aborted) throw signal.reason;
      if (ok) break;
      await dormir(500, signal);
    }
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Muestreo recomendado para Gemma (el mismo que trae su Modelfile en Ollama).
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 1.0, top_k: 64, top_p: 0.95,
      }),
      signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const texto = d.choices?.[0]?.message?.content ?? "";
    if (!texto.trim()) throw new Error("respuesta vacía");
    return texto;
  } catch (e) {
    if (op.signal?.aborted) throw op.signal.reason;
    const cola = stderr.trim().split("\n").slice(-3).join(" | ");
    const motivo = limite.aborted ? "no respondió a tiempo" : (e as Error).message;
    op.log?.(`llama.cpp: ${motivo}${cola ? ` (${cola.slice(0, 300)})` : ""}; sigo con Ollama.`);
    return null;
  } finally {
    await cerrar(hijo);
  }
}
