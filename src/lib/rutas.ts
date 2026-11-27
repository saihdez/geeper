import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliCraft, datosPorDefecto, ESCRITORIO, exe, herramientasPorDefecto, pythonDeVenv, RECURSOS } from "./plataforma";

/**
 * Carpeta de datos de Geeper (fuera del repo). Se puede cambiar con GEEPER_DATA. Desarrollo: ~/geeper-data;
 * app de escritorio: Documentos/Geeper (ver plataforma.ts).
 */
export function dirDatos(): string {
  return process.env.GEEPER_DATA ?? datosPorDefecto();
}

export function rutaBaseDatos(): string {
  return process.env.GEEPER_DB ?? path.join(dirDatos(), "geeper.db");
}

export function dirProyecto(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) throw new Error(`Slug de proyecto inválido: ${slug}`);
  return path.join(dirDatos(), slug);
}

/** Herramientas (ffmpeg, venvs, CLIs de Craft, modelos). Desarrollo: ~/dev/video-tools; app: su carpeta de datos. */
export const ESTUDIO = process.env.GEEPER_HERRAMIENTAS ?? herramientasPorDefecto();
export const MPT_DIR = path.join(os.homedir(), "dev", "MoneyPrinterTurbo");
/** gpu-lock del estudio (Linux, compartido con MPT y otras herramientas). Sin él, Geeper usa su propio candado (gpu.ts). */
export const GPU_LOCK_BIN = path.join(ESTUDIO, "bin", "gpu-lock");
export const GPU_LOCK_FILE = process.env.GPU_LOCK ?? path.join(ESTUDIO, ".gpu.lock");
/** ffmpeg: el que trae el instalador (GEEPER_RECURSOS) o, en desarrollo, el de ~/.local/bin (con NVENC). */
const ffDe = (n: string) => (RECURSOS ? path.join(RECURSOS, "ffmpeg", exe(n)) : ESCRITORIO ? path.join(ESTUDIO, "ffmpeg", exe(n)) : path.join(os.homedir(), ".local", "bin", n));
export const FFMPEG = process.env.GEEPER_FFMPEG ?? ffDe("ffmpeg");
export const FFPROBE = process.env.GEEPER_FFPROBE ?? ffDe("ffprobe");
export const MPT_API = process.env.GEEPER_MPT_API ?? "http://127.0.0.1:8080";
export const MPT_CONTENEDOR = "moneyprinterturbo-api";
export const MPT_TAREAS = "/MoneyPrinterTurbo/storage/tasks";
export const HYPERFRAMES_VERSION = process.env.GEEPER_HYPERFRAMES_VERSION ?? "0.9.27";
/** CLI de PhotoCraft (MIT/Apache 2.0): portadas desde plantillas PSD. Ver docs/PHOTOCRAFT.md. */
export const PHOTOCRAFT_CLI = process.env.GEEPER_PHOTOCRAFT ?? cliCraft(path.join(ESTUDIO, "photocraft"), "photocraft-cli");
export const PHOTOCRAFT_VERSION = process.env.GEEPER_PHOTOCRAFT_VERSION ?? "0.23.1";
/** CLI de VectorCraft (MIT/Apache 2.0): logos de Illustrator, PDF, EPS o Affinity a SVG, y vectorizar. Ver docs/HEREDADO.md. */
export const VECTORCRAFT_CLI = process.env.GEEPER_VECTORCRAFT ?? cliCraft(path.join(ESTUDIO, "vectorcraft"), "vectorcraft-cli");
export const VECTORCRAFT_VERSION = process.env.GEEPER_VECTORCRAFT_VERSION ?? "0.24.1";
/** Raíz del repo (para localizar py/, docs/ y otros recursos). En la app, la carcasa la apunta a sus recursos. */
export const RAIZ_REPO = process.env.GEEPER_REPO ?? process.cwd();
/** Venv de Python de Geeper para clips y caras (OpenCV, yt-dlp). */
export const VENV_CLIPS = path.join(ESTUDIO, "venvs", "geeper-clips");
/**
 * Wan2GP (opcional, lo instala la persona: github.com/deepbeepmeep/Wan2GP): motor local de planos
 * generativos con manejo de VRAM para 16 GB (wan2gp.ts). Python por defecto: el venv de esa carpeta.
 */
export const WAN2GP_DIR = process.env.GEEPER_WAN2GP ?? path.join(ESTUDIO, "Wan2GP");
export const WAN2GP_PYTHON = process.env.GEEPER_WAN2GP_PYTHON ?? pythonDeVenv(path.join(WAN2GP_DIR, "venv"));
/** gpu-solo del estudio: toma el candado y pausa los contenedores de MPT que ocupan VRAM. */
export const GPU_SOLO_BIN = path.join(ESTUDIO, "bin", "gpu-solo");
/**
 * Python con kokoro-onnx para `hyperframes tts`: el venv propio `venvs/voz` (kokoro-onnx y soundfile,
 * unos cientos de MB). En desarrollo, mientras ese venv no exista, el de OpenMontage (7,5 GB con
 * PyTorch), que es de donde salía antes (TER-04). Función pura para las pruebas.
 */
export function pythonVoz(estudio: string, escritorio: boolean, existe: (ruta: string) => boolean = fs.existsSync): string {
  const propio = pythonDeVenv(path.join(estudio, "venvs", "voz"));
  if (escritorio || existe(propio)) return propio;
  return path.join(estudio, "OpenMontage", ".venv", "bin", "python");
}
export const PYTHON_VOZ = process.env.HYPERFRAMES_PYTHON ?? pythonVoz(ESTUDIO, ESCRITORIO);
/** uv (crea los Python del estudio): el del instalador o, en desarrollo, el del PATH. */
export const UV = process.env.GEEPER_UV ?? (RECURSOS ? path.join(RECURSOS, "uv", exe("uv")) : "uv");
/**
 * whisper-cli del instalador (Windows: binario oficial; macOS: compilado en el empaquetado). Sin él,
 * Hyperframes busca el suyo (en Linux lo compila solo).
 */
export const WHISPER_CLI = process.env.HYPERFRAMES_WHISPER_PATH ?? (RECURSOS && fs.existsSync(path.join(RECURSOS, "whisper", exe("whisper-cli"))) ? path.join(RECURSOS, "whisper", exe("whisper-cli")) : null);
/** Caché de Hyperframes (navegador para renderizar, modelos de Kokoro y whisper). En la app, dentro de las herramientas. */
export const CACHE_HF = process.env.HYPERFRAMES_CACHE_DIR ?? (ESCRITORIO ? path.join(ESTUDIO, "hyperframes") : path.join(os.homedir(), ".cache", "hyperframes"));
