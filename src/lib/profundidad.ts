/**
 * Profundidad de una foto para la cámara 3D: Depth Anything V2 Small (Apache-2.0, la única de la familia con
 * licencia libre para uso comercial) en ONNX, con onnxruntime en CPU desde el venv `geeper-clips` (el mismo
 * de las caras). Unos 0,6 s por foto, sin tarjeta de video. Modelo fijado a una revisión de Hugging Face y
 * comprobado por tamaño y SHA-256 (como YuNet en caras.ts).
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { existe, rutaTemporal, sha256Archivo } from "./archivos";
import { PYTHON_CARAS } from "./caras";
import { correr, type Registro } from "./proceso";
import { dirDatos, RAIZ_REPO } from "./rutas";

export const DEPTH_ANYTHING = {
  id: "depth-anything-v2-small",
  url: "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx",
  archivo: "depth_anything_v2_small.onnx",
  tamano: 99_060_839,
  sha256: "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
  licencia: "Apache-2.0 (Depth Anything V2 Small, Yang et al.; exportado a ONNX por onnx-community)",
} as const;

export const rutaModeloProfundidad = () => path.join(dirDatos(), "modelos", DEPTH_ANYTHING.archivo);

/** Deja el modelo en disco (99 MB, una sola vez), comprobado. Devuelve la ruta. */
export async function asegurarModeloProfundidad(log?: Registro): Promise<string> {
  const ruta = rutaModeloProfundidad();
  if ((await existe(ruta)) && (await fs.stat(ruta)).size === DEPTH_ANYTHING.tamano) return ruta;
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  log?.(`Descargando el modelo de profundidad (${Math.round(DEPTH_ANYTHING.tamano / 1e6)} MB, ${DEPTH_ANYTHING.licencia.split(" (")[0]}), sólo la primera vez`);
  const r = await fetch(DEPTH_ANYTHING.url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`No pude descargar el modelo de profundidad: HTTP ${r.status}`);
  const tmp = rutaTemporal(ruta);
  const hash = createHash("sha256");
  const cuerpo = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
  cuerpo.on("data", (d: Buffer) => hash.update(d));
  await pipeline(cuerpo, createWriteStream(tmp));
  if (hash.digest("hex") !== DEPTH_ANYTHING.sha256 || (await fs.stat(tmp)).size !== DEPTH_ANYTHING.tamano) {
    await fs.rm(tmp, { force: true });
    throw new Error("El modelo de profundidad no coincide con el fijado; lo descarté (puede ser la red: prueba de nuevo).");
  }
  await fs.rename(tmp, ruta);
  return ruta;
}

/** Comprueba el SHA-256 del modelo ya bajado (para el chequeo de Sistema; lee 99 MB). */
export async function modeloProfundidadValido(): Promise<boolean> {
  const ruta = rutaModeloProfundidad();
  return (await existe(ruta)) && (await sha256Archivo(ruta)) === DEPTH_ANYTHING.sha256;
}

export const InfoProfundidad = z.object({
  ancho: z.number().int().positive(),
  alto: z.number().int().positive(),
  foco: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), profundidad: z.number().min(0).max(1) }),
  relieve: z.number().min(0).max(1),
});
export type InfoProfundidad = z.infer<typeof InfoProfundidad>;

/** Profundidad de `foto` en `salida` (PNG de 16 bits, blanco = cerca) y dónde está lo más cercano. */
export async function estimarProfundidad(foto: string, salida: string, op: { log?: Registro; signal?: AbortSignal } = {}): Promise<InfoProfundidad> {
  const modelo = await asegurarModeloProfundidad(op.log);
  const r = await correr(PYTHON_CARAS, ["-I", path.join(RAIZ_REPO, "py", "profundidad.py"), modelo, foto, salida], { signal: op.signal, timeout: 5 * 60_000, permitirFallo: true });
  if (r.codigo !== 0) {
    if (/No module named 'onnxruntime'/.test(r.stderr)) throw new Error("Falta una pieza del estudio para la cámara 3D: Sistema → «Preparar el estudio».");
    throw new Error(`No pude calcular la profundidad (${(r.stderr || r.stdout).trim().split("\n").pop()?.slice(0, 200)}).`);
  }
  return InfoProfundidad.parse(JSON.parse(r.stdout.trim().split("\n").pop()!));
}
