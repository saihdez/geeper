/**
 * Cómo usa la tarjeta el render de Hyperframes. Cambios de la auditoría que necesitan probarse con
 * la tarjeta puesta, así que quedan apagados por defecto detrás de una variable de entorno:
 *
 * - REN-01 (`GEEPER_RENDER_CAPTURA_AUTO=1`): sin NVENC, no pasar `--no-browser-gpu` en Linux (esa
 *   bandera elige la captura lenta por capturas de pantalla) y dar a Chrome `LIBGL_ALWAYS_SOFTWARE=1`
 *   para que use la captura «beginframe» con GPU por software. Probar: un render sin `--gpu` y sin
 *   `--quiet` debe decir «beginframe capture · software gpu».
 * - REN-03 (`GEEPER_RENDER_DETECTAR_NVIDIA=1`): antes de pedir `--gpu`, comprobar una vez que hay una
 *   NVIDIA (`nvidia-smi -L`); si no, ir por CPU. Si el render con `--gpu` falla, reintentar una vez sin
 *   la bandera.
 */
import { correr } from "./proceso";
import type { Sistema } from "./plataforma";

type Entorno = Record<string, string | undefined>;

export const capturaAuto = (env: Entorno = process.env) => env.GEEPER_RENDER_CAPTURA_AUTO === "1";
export const detectarNvidia = (env: Entorno = process.env) => env.GEEPER_RENDER_DETECTAR_NVIDIA === "1";

/** Banderas y entorno extra del render según use NVENC o no. */
export function banderasRender(gpu: boolean, sistema: Sistema, env: Entorno = process.env): { args: string[]; env: Record<string, string> } {
  if (gpu) return { args: ["--gpu"], env: {} };
  if (sistema === "linux" && capturaAuto(env)) return { args: [], env: { LIBGL_ALWAYS_SOFTWARE: "1" } };
  return { args: ["--no-browser-gpu"], env: {} };
}

let hayNvidiaCache: Promise<boolean> | null = null;

/**
 * ¿Hay una NVIDIA que pueda usar NVENC? Sin `GEEPER_RENDER_DETECTAR_NVIDIA=1` responde que sí (lo de
 * siempre: el candado decide). Con la variable, pregunta a `nvidia-smi -L` una sola vez por proceso
 * (en WSL, consultarlo seguido con la tarjeta ocupada molesta: doctor.ts).
 */
export function hayNvidia(sistema: Sistema, env: Entorno = process.env, consultar: () => Promise<boolean> = consultarNvidiaSmi): Promise<boolean> {
  if (sistema === "mac") return Promise.resolve(false);
  if (!detectarNvidia(env)) return Promise.resolve(true);
  hayNvidiaCache ??= consultar().catch(() => false);
  return hayNvidiaCache;
}

/** Sólo para pruebas. */
export function olvidarNvidia() {
  hayNvidiaCache = null;
}

async function consultarNvidiaSmi(): Promise<boolean> {
  const r = await correr("nvidia-smi", ["-L"], { permitirFallo: true, timeout: 15_000 });
  return /GPU \d+:/.test(r.stdout);
}

/**
 * Corre el render con NVENC y, si falla y está activa la detección (REN-03), lo repite una vez por CPU.
 * Devuelve si al final usó la tarjeta.
 */
export async function renderConRespaldo(
  gpu: boolean,
  correrCon: (gpu: boolean) => Promise<void>,
  log: (s: string) => void,
  env: Entorno = process.env,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await correrCon(gpu);
    return gpu;
  } catch (e) {
    if (!gpu || !detectarNvidia(env) || signal?.aborted) throw e;
    log(`El render con NVENC falló (${(e as Error).message.split("\n")[0]}); se repite una vez por CPU.`);
    await correrCon(false);
    return false;
  }
}
