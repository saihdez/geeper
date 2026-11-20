import { FFMPEG, FFPROBE } from "./rutas";
import { correrSiExterno, entradasYSalida } from "./aislado";
import { correr, type Registro } from "./proceso";

export interface InfoMedia {
  duracion: number;
  ancho?: number;
  alto?: number;
  fps?: number;
  video?: Record<string, string>;
  audio?: Record<string, string>;
}

export async function probar(ruta: string): Promise<InfoMedia> {
  // Un archivo de fuera se lee sin red ni permiso de escritura (aislado.ts).
  const r = await correrSiExterno(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream", "-of", "json", ruta], [ruta], []);
  const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: Record<string, unknown>[] };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const fps = typeof v?.r_frame_rate === "string" ? fraccion(v.r_frame_rate) : undefined;
  return {
    duracion: Number(j.format?.duration ?? 0),
    ancho: typeof v?.width === "number" ? v.width : undefined,
    alto: typeof v?.height === "number" ? v.height : undefined,
    fps,
    video: v ? (Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) as Record<string, string>) : undefined,
    audio: a ? (Object.fromEntries(Object.entries(a).map(([k, x]) => [k, String(x)])) as Record<string, string>) : undefined,
  };
}

function fraccion(s: string): number {
  const [n, d] = s.split("/").map(Number);
  return d ? (n ?? 0) / d : (n ?? 0);
}

export function ffmpeg(args: string[], log?: Registro) {
  // Si alguna entrada viene de fuera, corre aislado: sin red y escribiendo sólo en la carpeta de salida.
  const { entradas, salidas } = entradasYSalida(args);
  return correrSiExterno(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], entradas, salidas, { log });
}

/** Versión de ffmpeg (para la huella de los pasos que dependen de él). */
let versionFfmpeg: string | undefined;
export async function huellaFfmpeg(): Promise<string> {
  versionFfmpeg ??= (await correr(FFMPEG, ["-version"])).stdout.split("\n")[0] ?? "ffmpeg";
  return versionFfmpeg;
}

/** Fotograma JPEG de un video en el instante t (miniaturas y hojas de contacto). */
export async function fotograma(video: string, t: number, salida: string, ancho = 360): Promise<void> {
  await ffmpeg(["-v", "error", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `scale=${ancho}:-2`, "-q:v", "4", salida]);
}
