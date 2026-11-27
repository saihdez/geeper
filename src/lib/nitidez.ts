/**
 * Nitidez: cuánto se estira cada imagen o clip con píxeles en la salida. Es el «Image Resolution» del
 * Production Preflight de VectorCraft llevado a video: resolución efectiva en el tamaño final, con
 * cubrir/contener (el mismo `ajusteDe` del compilador) y el zoom máximo del movimiento de cámara.
 * Los SVG escalan sin perder y no cuentan.
 */
import { ajusteDe } from "./caras";
import type { Asset, Proyecto } from "./esquema";
import { escenasEnLinea } from "./linea";
import { esSvg } from "./svg";

/** Cuánto se amplía un clip raster en la salida (1 = píxel a píxel). */
export interface Ampliacion {
  clip: string;
  asset: string;
  /** Para la persona: «Escena 3» o «Superposición a los 4,0 s». */
  donde: string;
  /** Tamaño del asset en píxeles. */
  ancho: number;
  alto: number;
  factor: number;
  /** Imagen PNG/JPG/WebP: se puede vectorizar si es un logo (un video no). */
  imagen: boolean;
}

export function ampliaciones(p: Proyecto, W: number, H: number): Ampliacion[] {
  const out: Ampliacion[] = [];
  const numero = new Map(escenasEnLinea(p).map((e) => [e.escena.id, e.indice + 1]));
  for (const pi of p.pistas) {
    if (pi.tipo !== "video") continue;
    for (const c of pi.clips) {
      const a = p.assets[c.asset];
      if (!a || a.tipo === "audio" || !a.ancho || !a.alto || esSvg(a.ruta)) continue;
      const kx = W / a.ancho;
      const ky = H / a.alto;
      const base = ajusteDe(c, a, W, H) === "cubrir" ? Math.max(kx, ky) : Math.min(kx, ky);
      const zoom = Math.max(1, c.movimiento?.desde.escala ?? 1, c.movimiento?.hasta.escala ?? 1);
      const donde = pi.id === "visual"
        ? `Escena ${numero.get(c.escena ?? "") ?? "?"}`
        : `Superposición a los ${(c.inicio ?? 0).toFixed(1)} s`;
      out.push({ clip: c.id, asset: a.id, donde, ancho: a.ancho, alto: a.alto, factor: base * zoom, imagen: a.tipo === "imagen" });
    }
  }
  return out;
}

/**
 * Pone `nuevo` en lugar del asset `viejo` en todos los clips que lo usan (p. ej. el SVG vectorizado de
 * un logo PNG). Conserva todo lo demás del clip: tiempos, mezcla, transición, movimiento, opacidad.
 */
export function cambiarAsset(original: Proyecto, viejo: string, nuevo: Asset): Proyecto {
  if (!original.assets[viejo]) throw new Error("Esa imagen ya no está en el proyecto");
  const p = structuredClone(original);
  p.assets[nuevo.id] = nuevo;
  let n = 0;
  for (const pi of p.pistas) for (const c of pi.clips) if (c.asset === viejo) { c.asset = nuevo.id; n++; }
  if (!n) throw new Error("Esa imagen no se usa en ningún clip");
  return p;
}
