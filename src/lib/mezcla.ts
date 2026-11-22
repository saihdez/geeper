/**
 * Mezcla de audio (compilador geeper.json → ffmpeg): la voz por escenas y por tramos (lo que queda tras
 * los recortes de la edición por texto), en el orden de la línea de tiempo, con fundidos de 15 ms en
 * cada corte; la música en bucle desde su punto de inicio, bajando cuando habla la voz
 * (sidechaincompress) y con salida suave al final; los efectos de sonido de las pistas libres, cada uno
 * en su momento y fuera del ducking.
 */
import path from "node:path";
import { pista, pistasLibres, type Proyecto } from "./esquema";
import { ENTRADA, escenasEnLinea } from "./linea";
import { ffmpeg } from "./media";
import type { Registro } from "./proceso";

export const FUNDIDO = 0.015;

export interface PlanMezcla {
  entradas: string[];
  /** Índice de la entrada de música (se lee en bucle), o -1. */
  musica: number;
  filtro: string;
  total: number;
}

const FORMATO = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

export function planMezcla(p: Proyecto, dir: string, total: number, ducking: boolean): PlanMezcla {
  const musica = p.pistas.find((x) => x.id === "musica")?.clips[0];
  const entradas: string[] = [];
  const indice = new Map<string, number>();
  const entrada = (asset: string) => {
    if (!indice.has(asset)) {
      indice.set(asset, entradas.length);
      entradas.push(path.join(dir, p.assets[asset]!.ruta));
    }
    return indice.get(asset)!;
  };
  for (const c of pista(p, "voz").clips) entrada(c.asset);

  const partes: string[] = [];
  const voces: string[] = [];
  for (const e of escenasEnLinea(p)) {
    const k = indice.get(e.voz.asset)!;
    e.tramos.forEach((t, j) => {
      const d = t.fin - t.inicio;
      const etiqueta = `s${e.indice}t${j}`;
      partes.push(
        `[${k}:a]atrim=start=${t.inicio.toFixed(4)}:duration=${d.toFixed(4)},asetpts=PTS-STARTPTS,${FORMATO},` +
          `afade=t=in:d=${FUNDIDO},afade=t=out:st=${Math.max(0, d - FUNDIDO).toFixed(4)}:d=${FUNDIDO}[${etiqueta}]`,
      );
      voces.push(`[${etiqueta}]`);
    });
  }
  partes.push(`${voces.join("")}concat=n=${voces.length}:v=0:a=1,adelay=delays=${Math.round(ENTRADA * 1000)}:all=1,apad=whole_dur=${total.toFixed(4)}[voz]`);

  // Efectos de sonido (pistas libres de audio): cada clip en su `inicio`, con su volumen.
  const efectos: string[] = [];
  for (const pi of pistasLibres(p).filter((x) => x.tipo === "audio")) {
    for (const c of pi.clips) {
      const k = entrada(c.asset);
      const ini = c.inicio ?? 0;
      if (ini >= total) continue;
      const d = Math.min(c.rango.duracion, total - ini);
      const etiqueta = `fx${efectos.length}`;
      partes.push(
        `[${k}:a]atrim=start=${c.rango.inicio.toFixed(4)}:duration=${d.toFixed(4)},asetpts=PTS-STARTPTS,${FORMATO},` +
          `volume=${(c.volumen ?? 1).toFixed(3)},afade=t=out:st=${Math.max(0, d - FUNDIDO).toFixed(4)}:d=${FUNDIDO},` +
          `adelay=delays=${Math.round(ini * 1000)}:all=1,apad=whole_dur=${total.toFixed(4)}[${etiqueta}]`,
      );
      efectos.push(`[${etiqueta}]`);
    }
  }

  let km = -1;
  let base: string;
  if (musica) {
    km = entradas.length;
    entradas.push(path.join(dir, p.assets[musica.asset]!.ruta));
    partes.push(
      `[${km}:a]${FORMATO},atrim=start=${musica.rango.inicio.toFixed(4)}:duration=${total.toFixed(4)},` +
        `asetpts=PTS-STARTPTS,volume=${(musica.volumen ?? 0.15).toFixed(3)}[mus]`,
    );
    if (ducking) {
      partes.push(`[voz]asplit=2[voz1][llave]`);
      partes.push(`[mus][llave]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]`);
    } else {
      partes.push(`[voz]anull[voz1]`, `[mus]anull[duck]`);
    }
    partes.push(`[duck]afade=t=out:st=${Math.max(0, total - 1.5).toFixed(4)}:d=1.5[mf]`);
    partes.push(`[voz1][mf]amix=inputs=2:normalize=0:duration=first[base]`);
    base = "[base]";
  } else {
    partes.push(`[voz]anull[base]`);
    base = "[base]";
  }
  if (efectos.length) partes.push(`${base}${efectos.join("")}amix=inputs=${efectos.length + 1}:normalize=0:duration=first[out]`);
  else partes.push(`${base}anull[out]`);
  return { entradas, musica: km, filtro: partes.join(";"), total };
}

export async function mezclar(p: Proyecto, dir: string, total: number, ducking: boolean, salida: string, log: Registro) {
  const plan = planMezcla(p, dir, total, ducking);
  const args: string[] = [];
  plan.entradas.forEach((ent, i) => {
    if (i === plan.musica) args.push("-stream_loop", "-1");
    args.push("-i", ent);
  });
  await ffmpeg(
    ["-v", "error", ...args, "-filter_complex", plan.filtro, "-map", "[out]", "-t", total.toFixed(4), "-c:a", "pcm_s16le", "-ar", "48000", "-f", "wav", salida],
    log,
  );
  return plan;
}
