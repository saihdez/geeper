/** Medidas por formato: lienzo, banda segura y caja de cada elemento (las usa el compilador y el QC). */
import type { Formato, Plataforma } from "./esquema";

export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Metricas {
  W: number;
  H: number;
  perfil: "shorts-9x16" | "youtube-16x9" | "cuadrado-1x1";
  /** Banda segura para texto y logo. */
  segura: Caja;
  marcaTop: number;
  marcaFs: number;
  subs: Caja;
  subsFs: number;
  pastillaMax: number;
  tituloFs: number;
  ctaFs: number;
}

const M: Record<Formato, Metricas> = {
  // Shorts: la interfaz de YouTube tapa arriba y abajo; el texto va entre 168 y 1330 px.
  "9:16": {
    W: 1080, H: 1920, perfil: "shorts-9x16",
    segura: { x: 60, y: 168, w: 960, h: 1162 },
    marcaTop: 190, marcaFs: 44,
    subs: { x: 70, y: 1010, w: 940, h: 300 }, subsFs: 60, pastillaMax: 940,
    tituloFs: 120, ctaFs: 54,
  },
  // 16:9: zona segura de títulos del 90 %.
  "16:9": {
    W: 1920, H: 1080, perfil: "youtube-16x9",
    segura: { x: 96, y: 54, w: 1728, h: 972 },
    marcaTop: 64, marcaFs: 40,
    subs: { x: 210, y: 760, w: 1500, h: 230 }, subsFs: 68, pastillaMax: 1500,
    tituloFs: 132, ctaFs: 48,
  },
  "1:1": {
    W: 1080, H: 1080, perfil: "cuadrado-1x1",
    segura: { x: 54, y: 54, w: 972, h: 972 },
    marcaTop: 70, marcaFs: 38,
    subs: { x: 70, y: 770, w: 940, h: 220 }, subsFs: 58, pastillaMax: 940,
    tituloFs: 104, ctaFs: 46,
  },
};

/**
 * Lo que tapa la interfaz de cada plataforma en 9:16, en fracciones del cuadro (arriba, derecha, abajo,
 * izquierda). Fuente: vincentsch/explainroo `src/project.js:33-35` (MIT), ver HEREDADO.md. Facebook usa
 * la misma interfaz de Reels que Instagram.
 */
export const ZONAS_9X16: Record<Plataforma, { arriba: number; derecha: number; abajo: number; izquierda: number }> = {
  tiktok: { arriba: 0.125, derecha: 0.2, abajo: 0.34, izquierda: 0.11 },
  youtube: { arriba: 0.15, derecha: 0.12, abajo: 0.35, izquierda: 0.06 },
  instagram: { arriba: 0.14, derecha: 0.11, abajo: 0.35, izquierda: 0.06 },
  facebook: { arriba: 0.14, derecha: 0.11, abajo: 0.35, izquierda: 0.06 },
};

export interface OpcionesFormato {
  plataformas?: readonly Plataforma[];
  /**
   * La burbuja del presentador en una esquina de abajo (su caja, de `cajaMarco`): los subtítulos se corren
   * a su lado, en un bloque más angosto, para que no se tapen (`opcionesDe` en linea.ts).
   */
  burbuja?: Caja;
}

/** Espacio entre la burbuja y los subtítulos que se corren a su lado. */
export const SEPARACION_BURBUJA = 24;

/** Los subtítulos al lado de la burbuja si se encima con ellos; si no, igual. */
function subsAlLado(m: Metricas, b: Caja): Metricas {
  const s = m.subs;
  if (b.y >= s.y + s.h || b.y + b.h <= s.y || b.w <= 0) return m;
  const izquierda = b.x + b.w / 2 < m.W / 2;
  const x = izquierda ? Math.max(s.x, b.x + b.w + SEPARACION_BURBUJA) : s.x;
  const fin = izquierda ? s.x + s.w : Math.min(s.x + s.w, b.x - SEPARACION_BURBUJA);
  const subs = { ...s, x, w: Math.max(0, fin - x) };
  return { ...m, subs, pastillaMax: Math.min(m.pastillaMax, subs.w) };
}

function interseccion(a: Caja, b: Caja): Caja {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

/** Banda segura de una plataforma en 9:16 (en píxeles). */
export function zonaPlataforma(pl: Plataforma, W = 1080, H = 1920): Caja {
  const z = ZONAS_9X16[pl];
  return { x: z.izquierda * W, y: z.arriba * H, w: W * (1 - z.izquierda - z.derecha), h: H * (1 - z.arriba - z.abajo) };
}

/**
 * Medidas del formato. En 9:16 con plataformas de destino, la banda segura es la intersección de la base
 * con lo que deja libre cada interfaz, y marca, subtítulos y tarjeta final se acomodan dentro.
 */
export function metricas(f: Formato, o: OpcionesFormato = {}): Metricas {
  const m = metricasBanda(f, o.plataformas ?? []);
  return o.burbuja ? subsAlLado(m, o.burbuja) : m;
}

function metricasBanda(f: Formato, pls: readonly Plataforma[]): Metricas {
  const base = M[f];
  if (f !== "9:16" || pls.length === 0) return base;
  let segura = base.segura;
  for (const pl of pls) segura = interseccion(segura, zonaPlataforma(pl, base.W, base.H));
  const r = (n: number) => Math.round(n);
  segura = { x: r(segura.x), y: r(segura.y), w: Math.floor(segura.w), h: Math.floor(segura.h) };
  const subs = { x: segura.x + 6, y: segura.y + segura.h - base.subs.h - 20, w: segura.w - 12, h: base.subs.h };
  return { ...base, segura, marcaTop: Math.max(base.marcaTop, segura.y + 22), subs, pastillaMax: subs.w };
}

/** Ancho medio de un carácter en las tipografías gruesas de las plantillas (fracción del cuerpo). */
export const ANCHO_CARACTER = 0.6;
export const PADDING_PASTILLA = 36;

/** Caracteres que caben en una línea de subtítulo en este formato. */
export function caracteresPorLinea(f: Formato, o: OpcionesFormato = {}): number {
  const m = metricas(f, o);
  return Math.floor((m.pastillaMax - 2 * PADDING_PASTILLA) / (m.subsFs * ANCHO_CARACTER));
}

export function dentro(c: Caja, s: Caja): boolean {
  return c.x >= s.x - 0.5 && c.y >= s.y - 0.5 && c.x + c.w <= s.x + s.w + 0.5 && c.y + c.h <= s.y + s.h + 0.5;
}
