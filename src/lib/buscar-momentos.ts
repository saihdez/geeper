/**
 * Buscar momentos de una fuente (lo usan `scripts/momentos.ts` y el trabajo `clip.momentos`) y listar
 * las fuentes con sus candidatos para la página Clips.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { escribirAtomico, existe } from "./archivos";
import type { Palabra } from "./esquema";
import { dirFuentes, esUrl, traerFuente, type InfoFuente } from "./fuentes";
import { dirDatos } from "./rutas";
import { ffmpeg } from "./media";
import {
  ajustarBordes, chatTwitch, chatYoutube, contarEmocion, dbPorSegundo, elegirVentanas, OPCIONES_MOMENTOS, puntajeFinal, puntuar,
  type Candidato, type OpcionesMomentos,
} from "./momentos";
import type { Registro } from "./proceso";
import { transcribir } from "./voz";

export interface PedidoMomentos extends Partial<OpcionesMomentos> {
  src: string;
  idioma?: string;
  maxMinutos?: number;
  /** chat.json de TwitchDownloader. */
  chat?: string;
  transcribir?: boolean;
}

export interface ResultadoMomentos {
  fuente: string;
  info: InfoFuente;
  opciones: OpcionesMomentos;
  idioma: string;
  candidatos: Candidato[];
  /** Segundos que se revisaron: menos que la duración si el video pasa del tope (UX-24). */
  revisado?: number;
  creado: string;
}

/** Tope por omisión de lo que se baja y se revisa de un video largo (minutos). */
export const MAX_MINUTOS = 90;

/** Hasta dónde se revisó una fuente: lo guardado o, en análisis viejos, el tope de entonces. */
export function revisadoDe(duracion: number, revisado?: number | null): number {
  return revisado ?? Math.min(duracion, MAX_MINUTOS * 60);
}

/** Aire alrededor de cada momento en la vista previa (s). */
export const AIRE = 10;

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Los pasos que ve la persona mientras se buscan momentos (UX-34); la página Clips los reconoce. */
export const PASOS_MOMENTOS = {
  bajando: "Bajando el video",
  abriendo: "Abriendo tu video",
  midiendo: "Midiendo dónde hay más reacción",
  escuchando: "Escuchando lo que se dice",
  vistas: "Preparando las vistas previas",
} as const;

/** Avisa un paso con su avance (0–1). El worker lo pasa a la etapa del trabajo. */
export type AvanceMomentos = (etapa: string, progreso: number) => void;

export async function buscarMomentos(
  pe: PedidoMomentos,
  log: Registro = () => {},
  signal?: AbortSignal,
  avance: AvanceMomentos = () => {},
): Promise<ResultadoMomentos> {
  const o: OpcionesMomentos = { top: pe.top ?? OPCIONES_MOMENTOS.top, min: pe.min ?? OPCIONES_MOMENTOS.min, max: pe.max ?? OPCIONES_MOMENTOS.max };
  if (!(o.max >= o.min && o.min >= 3)) throw new Error("Duración inválida: min ≥ 3 s y max ≥ min");
  const idioma = pe.idioma ?? "es";
  const maxMinutos = pe.maxMinutos ?? MAX_MINUTOS;
  avance(esUrl(pe.src) ? `${PASOS_MOMENTOS.bajando}…` : `${PASOS_MOMENTOS.abriendo}…`, 0.05);
  const f = await traerFuente(pe.src, { maxMinutos, log, signal });
  avance(`${PASOS_MOMENTOS.midiendo}…`, 0.3);
  log(`Fuente ${f.id}: «${f.info.titulo}» de ${f.info.canal ?? "?"} (${(f.info.duracion / 60).toFixed(1)} min)`);
  const db = await dbPorSegundo(f.video, maxMinutos * 60);
  const n = db.length;
  let chat: number[] | undefined;
  if (pe.chat) chat = chatTwitch(JSON.parse(await fs.readFile(pe.chat, "utf8")), n);
  else if (f.chat) chat = chatYoutube(await fs.readFile(f.chat, "utf8"), n);
  const cands = elegirVentanas(puntuar({ db, heatmap: f.info.heatmap ?? undefined, chat }), n, o);
  log(`Señales: sonoridad${f.info.heatmap ? ", lo más visto" : ""}${chat ? ", chat" : ""}. ${cands.length} candidatos.`);

  if (pe.transcribir !== false) {
    const dir = path.join(f.dir, "candidatos");
    await fs.mkdir(dir, { recursive: true });
    for (const [i, c] of cands.entries()) {
      signal?.throwIfAborted();
      avance(`${PASOS_MOMENTOS.escuchando} (momento ${i + 1} de ${cands.length})…`, 0.4 + (0.4 * i) / Math.max(1, cands.length));
      const a0 = Math.max(0, c.inicio - 2);
      const a1 = Math.min(n, c.fin + 2);
      const wav = path.join(dir, `c${c.n}-${a0.toFixed(0)}.wav`);
      await ffmpeg(["-ss", a0.toFixed(2), "-t", (a1 - a0).toFixed(2), "-i", f.video, "-vn", "-ac", "1", "-ar", "16000", wav]);
      const w = await transcribir(wav, idioma, () => {});
      const palabras: Palabra[] = w.map((x) => ({ texto: x.text.trim(), inicio: x.start + a0, fin: x.end + a0 })).filter((x) => x.texto);
      const b = ajustarBordes(c, palabras, o, n);
      const dentro = palabras.filter((x) => x.inicio >= b.inicio && x.fin <= b.fin + 0.05);
      Object.assign(c, b, { texto: dentro.map((x) => x.texto).join(" ").slice(0, 400), emocion: contarEmocion(dentro) });
      c.puntaje = puntajeFinal(c);
      if (c.emocion) c.motivos.push(`${c.emocion} palabras de emoción`);
      log(`  ${c.n}. ${mmss(c.inicio)}–${mmss(c.fin)} transcrito`);
    }
  }
  // Vistas previas: 10 s de aire a cada lado para poder correr los bordes desde la web.
  const dirVistas = path.join(f.dir, "candidatos");
  await fs.mkdir(dirVistas, { recursive: true });
  for (const [i, c] of cands.entries()) {
    signal?.throwIfAborted();
    avance(`${PASOS_MOMENTOS.vistas} (${i + 1} de ${cands.length})…`, 0.82 + (0.16 * i) / Math.max(1, cands.length));
    const desde = Math.max(0, c.inicio - AIRE);
    const hasta = Math.min(n, c.fin + AIRE);
    const base = `vista-${c.inicio.toFixed(1)}-${c.fin.toFixed(1)}`;
    const video = path.join(dirVistas, `${base}.mp4`);
    const poster = path.join(dirVistas, `${base}.jpg`);
    if (!(await existe(video))) {
      await ffmpeg(["-ss", desde.toFixed(2), "-t", (hasta - desde).toFixed(2), "-i", f.video, "-vf", "scale=-2:480", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "28", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", video]);
    }
    if (!(await existe(poster))) {
      await ffmpeg(["-ss", Math.min(Math.max(c.pico, c.inicio), c.fin - 0.1).toFixed(2), "-i", f.video, "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "4", poster]);
    }
    c.vista = { video: path.relative(dirDatos(), video), poster: path.relative(dirDatos(), poster), desde, hasta };
  }
  log(`Vistas previas listas (${cands.length}).`);

  const r: ResultadoMomentos = {
    fuente: f.id, info: f.info, opciones: o, idioma, revisado: n,
    candidatos: [...cands].sort((a, b) => b.puntaje - a.puntaje),
    creado: new Date().toISOString(),
  };
  await escribirAtomico(path.join(f.dir, "candidatos.json"), JSON.stringify(r, null, 1));
  await escribirAtomico(path.join(f.dir, "candidatos.md"), aMarkdown(r));
  return r;
}

export function aMarkdown(r: ResultadoMomentos): string {
  return [
    `# Candidatos: ${r.info.titulo}`,
    `Fuente: ${r.info.url} · ${r.info.canal ?? "?"} · id \`${r.fuente}\``,
    "",
    ...r.candidatos.flatMap((c) => [
      `## ${c.n}. ${mmss(c.inicio)}–${mmss(c.fin)} (${(c.fin - c.inicio).toFixed(0)} s) · puntaje ${c.puntaje}`,
      `Por qué: ${c.motivos.join(", ")}`,
      ...(c.texto ? [`> ${c.texto}`] : []),
      `\`pnpm tsx scripts/importar-clip.ts ${r.fuente} ${c.inicio} ${c.fin} --encuadre react --idioma ${r.idioma}\``,
      "",
    ]),
  ].join("\n");
}

export interface FuenteListada {
  id: string;
  info: InfoFuente;
  candidatos: Candidato[] | null;
  idioma: string | null;
  /** Segundos revisados (ver `revisadoDe`). */
  revisado: number;
  creado: string | null;
}

/** Fuentes ya traídas, de la más reciente a la más vieja, con sus candidatos si los hay. */
export async function listarFuentes(): Promise<FuenteListada[]> {
  const base = dirFuentes();
  if (!(await existe(base))) return [];
  const out: (FuenteListada & { t: number })[] = [];
  for (const id of await fs.readdir(base)) {
    if (!/^[a-f0-9]{12}$/.test(id)) continue;
    try {
      const info = JSON.parse(await fs.readFile(path.join(base, id, "info.json"), "utf8")) as InfoFuente;
      const rc = path.join(base, id, "candidatos.json");
      const r = (await existe(rc)) ? (JSON.parse(await fs.readFile(rc, "utf8")) as ResultadoMomentos) : null;
      const t = (await fs.stat(r ? rc : path.join(base, id, "info.json"))).mtimeMs;
      out.push({ id, info, candidatos: r?.candidatos ?? null, idioma: r?.idioma ?? null, revisado: revisadoDe(info.duracion, r?.revisado), creado: r?.creado ?? null, t });
    } catch {
      /* fuente a medias: se ignora */
    }
  }
  return out.sort((a, b) => b.t - a.t).map(({ t: _t, ...f }) => f);
}
