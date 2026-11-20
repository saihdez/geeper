/**
 * Huella de los pesos de cada modelo local (BRECHAS.md Q5): sha256 del archivo de pesos, para saber si
 * un asset se puede volver a generar igual dentro de seis meses. El sha256 de un archivo de 1,5 GB tarda
 * unos segundos: se guarda en `~/geeper-data/modelos.json` por ruta, tamaño y fecha de modificación, y
 * sólo se recalcula si el archivo cambió.
 *
 * Los modelos dentro del contenedor de MPT (su Kokoro, SDXL) no se ven desde aquí: para esos se anota
 * el nombre del modelo, como hasta ahora.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { escribirAtomico, sha256Archivo } from "./archivos";
import { rutaYunet, YUNET } from "./caras";
import { dirDatos } from "./rutas";

const CACHE_HF = path.join(os.homedir(), ".cache", "hyperframes");

/** Archivos de pesos de los modelos locales que usa Geeper. */
export const PESOS: Record<string, string> = {
  "whisper-medium": path.join(CACHE_HF, "whisper", "models", "ggml-medium.bin"),
  "kokoro-82m-onnx": path.join(CACHE_HF, "tts", "models", "kokoro-v1.0.onnx"),
  // Detector de caras para el reencuadre (src/lib/caras.ts); se descarga con su SHA-256 fijado.
  [YUNET.id]: rutaYunet(),
};

/**
 * Formatos de pesos permitidos (docs/STACK-AGENTICO.md E2): los que no ejecutan código al cargarse.
 * `.bin` sólo si es GGML de whisper.cpp (`ggml-*.bin`); un `.bin`, `.pt`, `.pth` o `.ckpt` de PyTorch es
 * *pickle* y queda fuera.
 */
export function formatoDePesos(ruta: string): "safetensors" | "gguf" | "ggml" | "onnx" | null {
  const nombre = path.basename(ruta).toLowerCase();
  if (nombre.endsWith(".safetensors")) return "safetensors";
  if (nombre.endsWith(".gguf")) return "gguf";
  if (nombre.endsWith(".onnx")) return "onnx";
  if (/^ggml-.+\.bin$/.test(nombre)) return "ggml";
  return null;
}

interface Entrada {
  tamano: number;
  modificado: number;
  sha256: string;
}

const rutaCache = () => path.join(dirDatos(), "modelos.json");

async function leerCache(): Promise<Record<string, Entrada>> {
  try {
    return JSON.parse(await fs.readFile(rutaCache(), "utf8")) as Record<string, Entrada>;
  } catch {
    return {};
  }
}

/** sha256 de los pesos de `modelo` (o null si el archivo no está en esta PC). */
export async function huellaPesos(modelo: string): Promise<string | null> {
  const ruta = PESOS[modelo];
  if (!ruta) return null;
  let st;
  try {
    st = await fs.stat(ruta);
  } catch {
    return null;
  }
  const cache = await leerCache();
  const previa = cache[ruta];
  if (previa && previa.tamano === st.size && previa.modificado === st.mtimeMs) return previa.sha256;
  const sha256 = await sha256Archivo(ruta);
  cache[ruta] = { tamano: st.size, modificado: st.mtimeMs, sha256 };
  await escribirAtomico(rutaCache(), JSON.stringify(cache, null, 2));
  return sha256;
}

/** `modelo@sha256:<12>` para usar en la huella de un paso (input_hash). */
export async function etiquetaPesos(modelo: string): Promise<string> {
  const h = await huellaPesos(modelo);
  return `${modelo}@${h ? `sha256:${h.slice(0, 12)}` : "sin-pesos-locales"}`;
}
