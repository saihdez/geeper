/**
 * Radar de tendencias: videos recientes de YouTube sobre un tema, ordenados por vistas por hora.
 * Portado de Bodila51/gtavi-claudecode `scripts/trends.py` (MIT). Sirve para elegir de qué VOD o video
 * sacar clips. Usa yt-dlp (sin cuenta ni clave); el resultado se guarda una hora por consulta.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { escribirAtomico, existe } from "./archivos";
import { dirFuentes, PYTHON_CLIPS, runtimeJsYtdlp } from "./fuentes";
import { correr } from "./proceso";

export interface Tendencia {
  url: string;
  titulo: string;
  canal: string;
  vistas: number;
  horas: number;
  vistasPorHora: number;
  minutos: number;
  loMasVisto: boolean;
  fueDirecto: boolean;
}

export interface Radar {
  consulta: string;
  horas: number;
  medido: string;
  videos: Tendencia[];
}

/** YouTube ordenado por fecha de subida. */
const ORDEN_FECHA = "&sp=CAI%253D";
const CACHE_MS = 60 * 60 * 1000;

interface InfoYt {
  webpage_url?: string; title?: string; channel?: string; uploader?: string; view_count?: number; duration?: number;
  timestamp?: number; release_timestamp?: number; is_live?: boolean; was_live?: boolean; heatmap?: unknown[];
}

/** Ordena por vistas por hora (función pura, para probarla). */
export function ordenar(infos: InfoYt[], ahora: number, horasMax: number): Tendencia[] {
  const out: Tendencia[] = [];
  for (const i of infos) {
    const ts = i.timestamp ?? i.release_timestamp;
    if (!ts || i.is_live || !i.webpage_url) continue;
    const horas = Math.max(0.25, (ahora - ts) / 3600);
    if (horas > horasMax) continue;
    const vistas = i.view_count ?? 0;
    out.push({
      url: i.webpage_url, titulo: i.title ?? "", canal: i.channel ?? i.uploader ?? "", vistas, horas: Math.round(horas * 10) / 10,
      vistasPorHora: Math.round(vistas / horas), minutos: Math.round((i.duration ?? 0) / 6) / 10,
      loMasVisto: Array.isArray(i.heatmap) && i.heatmap.length > 0, fueDirecto: Boolean(i.was_live),
    });
  }
  return out.sort((a, b) => b.vistasPorHora - a.vistasPorHora);
}

async function json(args: string[]): Promise<unknown> {
  const js = runtimeJsYtdlp();
  const r = await correr(PYTHON_CLIPS, ["-I", "-m", "yt_dlp", "--no-warnings", "--no-progress", ...js.args, "-J", ...args], { timeout: 90_000, env: js.env });
  return JSON.parse(r.stdout);
}

export async function radar(consulta: string, horas = 24, limite = 30): Promise<Radar> {
  const q = consulta.trim();
  if (!q) throw new Error("Escribe qué buscar");
  const lim = Math.min(50, Math.max(5, Math.floor(limite)));
  const clave = createHash("sha1").update(`${q.toLowerCase()}|${horas}|${lim}`).digest("hex").slice(0, 12);
  const cache = path.join(dirFuentes(), "_radar", `${clave}.json`);
  if (await existe(cache)) {
    const r = JSON.parse(await fs.readFile(cache, "utf8")) as Radar;
    if (Date.now() - Date.parse(r.medido) < CACHE_MS) return r;
  }
  const busqueda = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${ORDEN_FECHA}`;
  const plano = (await json(["--flat-playlist", "--playlist-end", String(lim), busqueda])) as { entries?: { url?: string }[] };
  const urls = (plano.entries ?? []).map((e) => e.url).filter((u): u is string => Boolean(u) && !u!.includes("/shorts/"));
  const infos: InfoYt[] = [];
  // De a 6, como el original: más en paralelo y YouTube empieza a responder 429.
  for (let i = 0; i < urls.length; i += 6) {
    const lote = await Promise.all(urls.slice(i, i + 6).map((u) => json(["--skip-download", u]).catch(() => null)));
    for (const x of lote) if (x) infos.push(x as InfoYt);
  }
  const r: Radar = { consulta: q, horas, medido: new Date().toISOString(), videos: ordenar(infos, Date.now() / 1000, horas) };
  await escribirAtomico(cache, JSON.stringify(r, null, 1));
  return r;
}
