/**
 * Pulsos de la música y cortes al ritmo (BRECHAS.md G3, PRODUCTO.md §7 «Ritmo»).
 *
 * Los cortes de escena los manda la voz (caen en pausas y fines de frase), así que no se mueven. Lo que
 * se mueve es la música: se elige desde qué segundo empieza (`rango.inicio` del clip de música) para que
 * el mayor número posible de cortes caiga sobre un pulso. Los pulsos los detecta `hyperframes beats`
 * (ffmpeg + seguimiento de pulsos, en CPU); si la pista no tiene un pulso estable no devuelve ninguno
 * y no se toca nada.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256Archivo } from "./archivos";
import type { Proyecto } from "./esquema";
import { duracionEscenas, escenasEnLinea } from "./linea";
import { correrHf } from "./hyperframes";

/** Un corte está «en pulso» si cae a menos de esto de un pulso (s): ~2 fotogramas a 30 fps. */
export const TOLERANCIA = 0.07;
/** Hasta dónde se busca el inicio de la música (s). */
export const MAX_INICIO = 30;

export interface Pulsos {
  bpm: number | null;
  /** En tiempo de la pista de música (s). */
  tiempos: number[];
}

/** Lee la salida de `hyperframes beats --json`; null si no es un objeto JSON (no se sabe nada). */
export function leerPulsos(stdout: string): Pulsos | null {
  let j: unknown;
  try {
    j = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as { bpm?: unknown; beatTimes?: unknown };
  const tiempos = Array.isArray(o.beatTimes) ? o.beatTimes.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];
  return { bpm: typeof o.bpm === "number" && Number.isFinite(o.bpm) ? o.bpm : null, tiempos };
}

/** Pulsos de una pista (cacheados junto al archivo por su sha256). */
export async function detectarPulsos(rutaMusica: string, dirCache: string): Promise<Pulsos> {
  const hash = (await sha256Archivo(rutaMusica)).slice(0, 16);
  const cache = path.join(dirCache, `pulsos-${hash}.json`);
  try {
    return JSON.parse(await fs.readFile(cache, "utf8")) as Pulsos;
  } catch {
    /* se calcula */
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-pulsos-"));
  try {
    const r = await correrHf(["beats", rutaMusica, "--json"], { cwd: tmp, permitirFallo: true });
    const leido = leerPulsos(r.stdout);
    // WRK-12: si el comando falló o no dio JSON no se guarda «sin pulso» (pudo no llegar a correr:
    // npx sin red); se vuelve a preguntar la próxima vez.
    if (!leido) return { bpm: null, tiempos: [] };
    await fs.mkdir(dirCache, { recursive: true });
    await fs.writeFile(cache, JSON.stringify(leido));
    return leido;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Distancia de `t` al pulso más cercano (pulsos ordenados). */
function aPulso(t: number, pulsos: number[]): number {
  let lo = 0;
  let hi = pulsos.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (pulsos[m]! < t) lo = m + 1;
    else hi = m;
  }
  const a = pulsos[lo] ?? Infinity;
  const b = pulsos[lo - 1] ?? Infinity;
  return Math.min(Math.abs(a - t), Math.abs(b - t));
}

export interface Ritmo {
  /** Cortes que caen en pulso / total de cortes. */
  enPulso: number;
  cortes: number;
  /** Distancia media de los cortes a su pulso (s). */
  media: number;
}

/** Cuántos cortes caen en pulso si la música empieza en `inicio` (pulsos en tiempo de la música). */
export function medirRitmo(cortes: number[], pulsosMusica: number[], inicio: number): Ritmo {
  if (!cortes.length || !pulsosMusica.length) return { enPulso: 0, cortes: cortes.length, media: 0 };
  const d = cortes.map((c) => aPulso(c + inicio, pulsosMusica));
  return { enPulso: d.filter((x) => x <= TOLERANCIA).length, cortes: cortes.length, media: d.reduce((s, x) => s + x, 0) / d.length };
}

/**
 * El inicio de la música (s) que pone más cortes en pulso; a igualdad, el de menor distancia media y
 * después el más cercano a 0. Candidatos: 0 y cada «pulso − corte» dentro de [0, máximo].
 */
export function mejorInicio(cortes: number[], pulsosMusica: number[], maximo: number): { inicio: number; ritmo: Ritmo } {
  const candidatos = new Set<number>([0]);
  for (const b of pulsosMusica) {
    for (const c of cortes) {
      const o = Math.round((b - c) * 1000) / 1000;
      if (o >= 0 && o <= maximo) candidatos.add(o);
    }
  }
  let mejor = { inicio: 0, ritmo: medirRitmo(cortes, pulsosMusica, 0) };
  for (const o of candidatos) {
    const r = medirRitmo(cortes, pulsosMusica, o);
    const gana =
      r.enPulso > mejor.ritmo.enPulso ||
      (r.enPulso === mejor.ritmo.enPulso && r.media < mejor.ritmo.media - 1e-6) ||
      (r.enPulso === mejor.ritmo.enPulso && Math.abs(r.media - mejor.ritmo.media) <= 1e-6 && o < mejor.inicio);
    if (gana) mejor = { inicio: o, ritmo: r };
  }
  return mejor;
}

/** Cortes de escena en la línea final (sin el primero, que es el principio del video). */
export function cortesDe(p: Proyecto): number[] {
  return escenasEnLinea(p).slice(1).map((e) => e.inicio);
}

/** Pulsos en la línea final para un inicio de música dado, hasta `total`. */
export function pulsosEnLinea(pulsosMusica: number[], inicio: number, total: number): number[] {
  return pulsosMusica.map((b) => Math.round((b - inicio) * 1000) / 1000).filter((t) => t >= 0 && t <= total);
}

export interface PropuestaMusica {
  /** Edición a aplicar (`fijarMusica`). */
  edicion: { tipo: "fijarMusica"; inicio: number; pulsos: number[] };
  bpm: number | null;
  /** Ritmo con el inicio actual y con el propuesto (null si la pista no tiene pulso estable). */
  antes: Ritmo | null;
  despues: Ritmo | null;
}

/** Propone desde dónde empezar la música para cortar al ritmo (o null si el proyecto no tiene música). */
export async function proponerMusica(p: Proyecto, dirProyecto: string): Promise<PropuestaMusica | null> {
  const m = p.pistas.find((x) => x.id === "musica")?.clips[0];
  if (!m) return null;
  const a = p.assets[m.asset]!;
  const pul = await detectarPulsos(path.join(dirProyecto, a.ruta), path.join(dirProyecto, "assets"));
  const total = duracionEscenas(p);
  if (!pul.tiempos.length) return { edicion: { tipo: "fijarMusica", inicio: m.rango.inicio, pulsos: [] }, bpm: null, antes: null, despues: null };
  const cortes = cortesDe(p);
  const maximo = Math.min(MAX_INICIO, Math.max(0, (a.duracion ?? 0) - total));
  const { inicio, ritmo } = mejorInicio(cortes, pul.tiempos, maximo);
  return {
    edicion: { tipo: "fijarMusica", inicio, pulsos: pulsosEnLinea(pul.tiempos, inicio, total) },
    bpm: pul.bpm,
    antes: medirRitmo(cortes, pul.tiempos, m.rango.inicio),
    despues: ritmo,
  };
}
