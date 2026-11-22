/**
 * Cómo usa la tarjeta el render de Hyperframes.
 *
 * - REN-01 (`GEEPER_RENDER_CAPTURA_AUTO=1`, apagado por defecto: hay que probarlo con la tarjeta): sin
 *   NVENC, no pasar `--no-browser-gpu` en Linux (esa bandera elige la captura lenta por capturas de
 *   pantalla) y dar a Chrome `LIBGL_ALWAYS_SOFTWARE=1` para que use la captura «beginframe» con GPU por
 *   software. Probar: un render sin `--gpu` y sin `--quiet` debe decir «beginframe capture · software gpu».
 * - REN-03, detección: antes de pedir `--gpu`, comprobar que hay una NVIDIA (`nvidia-smi -L`); si no, ir
 *   por CPU. Encendida por defecto en Windows (la app de escritorio corre en equipos sin NVIDIA);
 *   `GEEPER_RENDER_DETECTAR_NVIDIA=1` la enciende en cualquier sistema y `=0` la apaga.
 * - REN-03, reintento: si el render con `--gpu` falla, repetirlo una vez sin la bandera. Encendido por
 *   defecto (riesgo bajo: sólo corre tras un fallo); `GEEPER_RENDER_REINTENTO_CPU=0` lo apaga.
 */
import { correr } from "./proceso";
import type { Sistema } from "./plataforma";

type Entorno = Record<string, string | undefined>;

export const capturaAuto = (env: Entorno = process.env) => env.GEEPER_RENDER_CAPTURA_AUTO === "1";
export function detectarNvidia(sistema: Sistema, env: Entorno = process.env): boolean {
  const v = env.GEEPER_RENDER_DETECTAR_NVIDIA;
  if (v === "1") return true;
  if (v === "0") return false;
  return sistema === "windows";
}
export const reintentoCpu = (env: Entorno = process.env) => env.GEEPER_RENDER_REINTENTO_CPU !== "0";

/** Banderas y entorno extra del render según use NVENC o no. */
export function banderasRender(gpu: boolean, sistema: Sistema, env: Entorno = process.env): { args: string[]; env: Record<string, string> } {
  if (gpu) return { args: ["--gpu"], env: {} };
  if (sistema === "linux" && capturaAuto(env)) return { args: [], env: { LIBGL_ALWAYS_SOFTWARE: "1" } };
  return { args: ["--no-browser-gpu"], env: {} };
}

/** Respuesta de `nvidia-smi`: `null` cuando no contestó a tiempo (no se sabe). */
export type ConsultaNvidia = boolean | null;

let hayNvidiaCache: boolean | null = null;
let enCurso: Promise<boolean> | null = null;

/**
 * ¿Hay una NVIDIA que pueda usar NVENC? Sin la detección responde que sí (lo de siempre: el candado
 * decide). Con ella pregunta a `nvidia-smi -L` y guarda la respuesta para el resto del proceso (en WSL,
 * consultarlo seguido con la tarjeta ocupada molesta: doctor.ts). Si no contestó a tiempo no se guarda
 * nada y se responde que sí: una tarjeta ocupada tarda, y si NVENC falla el reintento va por CPU.
 */
export function hayNvidia(sistema: Sistema, env: Entorno = process.env, consultar: () => Promise<ConsultaNvidia> = consultarNvidiaSmi): Promise<boolean> {
  if (sistema === "mac") return Promise.resolve(false);
  if (!detectarNvidia(sistema, env)) return Promise.resolve(true);
  if (hayNvidiaCache !== null) return Promise.resolve(hayNvidiaCache);
  enCurso ??= consultar()
    .catch((): ConsultaNvidia => false)
    .then((r) => {
      enCurso = null;
      if (r === null) return true;
      hayNvidiaCache = r;
      return r;
    });
  return enCurso;
}

/** Sólo para pruebas. */
export function olvidarNvidia() {
  hayNvidiaCache = null;
  enCurso = null;
}

const LIMITE_NVIDIA_SMI_MS = 15_000;

async function consultarNvidiaSmi(): Promise<ConsultaNvidia> {
  const t0 = Date.now();
  // Sin nvidia-smi, correr() lanza (ENOENT): hayNvidia lo toma como «no hay».
  const r = await correr("nvidia-smi", ["-L"], { permitirFallo: true, timeout: LIMITE_NVIDIA_SMI_MS });
  if (/GPU \d+:/.test(r.stdout)) return true;
  // Cortado por el límite: no se sabe.
  if (r.codigo === -1 && Date.now() - t0 >= LIMITE_NVIDIA_SMI_MS - 500) return null;
  return false;
}

/**
 * Corre el render con NVENC y, si falla, lo repite una vez por CPU (REN-03). Antes de repetir llama a
 * `antesDeCpu` (soltar el candado de la tarjeta: el render por CPU tarda minutos y no la usa).
 * Devuelve si al final usó la tarjeta.
 */
export async function renderConRespaldo(
  gpu: boolean,
  correrCon: (gpu: boolean) => Promise<void>,
  log: (s: string) => void,
  env: Entorno = process.env,
  signal?: AbortSignal,
  antesDeCpu?: () => void,
): Promise<boolean> {
  try {
    await correrCon(gpu);
    return gpu;
  } catch (e) {
    if (!gpu || !reintentoCpu(env) || signal?.aborted) throw e;
    log(`El render con NVENC falló (${(e as Error).message.split("\n")[0]}); se repite una vez por CPU.`);
    antesDeCpu?.();
    await correrCon(false);
    return false;
  }
}
