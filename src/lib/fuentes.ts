/**
 * Material largo de donde salen clips (BRECHAS.md G5): un archivo local o un VOD/video público que se
 * baja con yt-dlp. Vive en ~/geeper-data/_fuentes/<id>/ con su info.json (procedencia y crédito), fuera
 * de los proyectos: varios clips pueden salir de la misma fuente.
 *
 * No graba directos en vivo (decisión DECISIONES.md §21): sólo VODs ya publicados o archivos propios.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { escribirAtomico, existe } from "./archivos";
import { probar } from "./media";
import { correr, type Registro } from "./proceso";
import { ESCRITORIO, pythonDeVenv } from "./plataforma";
import { dirDatos, VENV_CLIPS } from "./rutas";

/** Python con OpenCV, numpy y yt-dlp para clips (venv propio, ver README). */
export const PYTHON_CLIPS = process.env.GEEPER_PYTHON_CLIPS ?? pythonDeVenv(VENV_CLIPS);

export interface InfoFuente {
  /** URL de la página o ruta del archivo. */
  url: string;
  titulo: string;
  canal: string | null;
  plataforma: string | null;
  id: string | null;
  duracion: number;
  subida: string | null;
  vistas: number | null;
  /** «Lo más visto» de YouTube, si lo hay. */
  heatmap: { start_time: number; end_time: number; value: number }[] | null;
  fueDirecto: boolean;
}

export interface Fuente {
  id: string;
  dir: string;
  video: string;
  info: InfoFuente;
  /** Chat descargado (YouTube live_chat), si lo hay. */
  chat: string | null;
}

export function esUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function idFuente(src: string): string {
  const base = esUrl(src) ? src : path.resolve(src);
  return createHash("sha1").update(base).digest("hex").slice(0, 12);
}

export function dirFuentes(): string {
  return path.join(dirDatos(), "_fuentes");
}

/**
 * yt-dlp necesita un runtime de JavaScript para los desafíos del reproductor de YouTube; sin él avisa
 * «some formats may be missing» (y `--no-warnings` lo ocultaba). Sólo trae Deno activado: se le pasa el
 * propio Node de Geeper; en la app, el de Electron como Node (idea de OpenWhispr `urlAudioDownloader.js`).
 */
export function runtimeJsYtdlp(): { args: string[]; env: Record<string, string> } {
  return {
    args: ["--js-runtimes", `node:${process.execPath}`],
    env: ESCRITORIO ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
}

async function ytdlp(args: string[], log?: Registro, signal?: AbortSignal) {
  const js = runtimeJsYtdlp();
  return correr(PYTHON_CLIPS, ["-I", "-m", "yt_dlp", "--no-warnings", "--no-progress", ...js.args, ...args], { log, signal, env: js.env });
}

/** Trae (o reutiliza) la fuente. `maxMinutos` limita lo que se baja de un VOD largo. */
export async function traerFuente(src: string, o: { maxMinutos?: number; log?: Registro; signal?: AbortSignal } = {}): Promise<Fuente> {
  const id = idFuente(src);
  const dir = path.join(dirFuentes(), id);
  await fs.mkdir(dir, { recursive: true });
  const rutaInfo = path.join(dir, "info.json");
  if (!esUrl(src)) {
    const video = path.resolve(src.replace(/^~(?=\/)/, os.homedir()));
    if (!(await existe(video))) throw new Error(`No existe el archivo ${video}`);
    const info: InfoFuente = {
      url: video,
      titulo: path.parse(video).name.replace(/^[a-f0-9]{8}-/, ""),
      canal: null,
      plataforma: "archivo",
      id: null,
      duracion: (await probar(video)).duracion,
      subida: null,
      vistas: null,
      heatmap: null,
      fueDirecto: false,
    };
    await escribirAtomico(rutaInfo, JSON.stringify(info, null, 1));
    return { id, dir, video, info, chat: null };
  }

  let info: InfoFuente;
  if (await existe(rutaInfo)) info = JSON.parse(await fs.readFile(rutaInfo, "utf8")) as InfoFuente;
  else {
    const r = await ytdlp(["-J", "--skip-download", src], undefined, o.signal);
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    if (j.is_live) throw new Error("Es un directo en vivo: Geeper no graba directos. Espera a que quede el VOD publicado.");
    info = {
      url: String(j.webpage_url ?? src),
      titulo: String(j.title ?? ""),
      canal: (j.channel ?? j.uploader ?? null) as string | null,
      plataforma: (j.extractor_key ?? null) as string | null,
      id: (j.id ?? null) as string | null,
      duracion: Number(j.duration ?? 0),
      subida: (j.upload_date ?? null) as string | null,
      vistas: (j.view_count ?? null) as number | null,
      heatmap: (j.heatmap ?? null) as InfoFuente["heatmap"],
      fueDirecto: Boolean(j.was_live),
    };
    await escribirAtomico(rutaInfo, JSON.stringify(info, null, 1));
  }

  const video = path.join(dir, "fuente.mp4");
  if (!(await existe(video))) {
    o.log?.(`Bajando ${info.url} (≤ 1080p)`);
    const args = ["-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b", "--merge-output-format", "mp4", "-o", path.join(dir, ".fuente.%(ext)s")];
    const max = (o.maxMinutos ?? 90) * 60;
    if (info.duracion > max) {
      args.push("--download-sections", `*0-${max}`);
      o.log?.(`El VOD dura ${(info.duracion / 60).toFixed(0)} min: se bajan los primeros ${o.maxMinutos ?? 90} (usa --max-minutos para más)`);
    }
    await ytdlp([...args, info.url], o.log, o.signal);
    await fs.rename(path.join(dir, ".fuente.mp4"), video);
  }

  // Chat de un directo ya terminado (YouTube): sirve como señal de momentos.
  let chat: string | null = null;
  const previo = (await fs.readdir(dir)).find((f) => f.endsWith(".live_chat.json"));
  if (previo) chat = path.join(dir, previo);
  else if (info.fueDirecto && /youtube/i.test(info.plataforma ?? "")) {
    await ytdlp(["--skip-download", "--write-subs", "--sub-langs", "live_chat", "-o", path.join(dir, "chat"), info.url], o.log, o.signal).catch(() => null);
    const nuevo = (await fs.readdir(dir)).find((f) => f.endsWith(".live_chat.json"));
    chat = nuevo ? path.join(dir, nuevo) : null;
  }
  return { id, dir, video, info, chat };
}

export async function leerFuente(id: string): Promise<Fuente> {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error(`Fuente inválida: ${id}`);
  const dir = path.join(dirFuentes(), id);
  const info = JSON.parse(await fs.readFile(path.join(dir, "info.json"), "utf8")) as InfoFuente;
  const video = info.plataforma === "archivo" ? info.url : path.join(dir, "fuente.mp4");
  const chatF = (await fs.readdir(dir)).find((f) => f.endsWith(".live_chat.json"));
  return { id, dir, video, info, chat: chatF ? path.join(dir, chatF) : null };
}

/** Texto de crédito para la descripción del post (el creador siempre se nombra). */
export function credito(info: InfoFuente): string {
  if (info.plataforma === "archivo") return "";
  return `Créditos: ${info.canal ?? "el creador original"} (${info.url})`;
}
