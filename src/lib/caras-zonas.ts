/**
 * Dónde están las caras de las escenas en el cuadro final, para que la burbuja del presentador no las tape
 * (marco-auto.ts). Sólo servidor: usa el mismo recorte que el compilador (visibleDe, caras.ts).
 */
import { visibleDe } from "./caras";
import type { Asset, Proyecto } from "./esquema";
import type { Caja } from "./formatos";
import { escenasEnLinea } from "./linea";
import type { Zona } from "./marco-auto";

/** Cuánto pesa tapar el cuerpo frente a tapar la cara. */
const PESO_CUERPO = 0.25;

/**
 * Dónde queda la cara de un asset en el cuadro final (W×H), con el mismo recorte que usa el compilador
 * (visibleDe). Devuelve la cara y el cuerpo debajo; null si el asset no tiene cara detectada.
 */
export function zonasDeAsset(a: Asset, W: number, H: number, peso: number): Zona[] {
  const f = a.foco;
  if (!f || !a.ancho || !a.alto) return [];
  const confianza = f.confianza * Math.max(0.25, f.cobertura);
  if (confianza <= 0) return [];
  // La cara es un poco más alta que ancha.
  const caraW = f.ancho;
  const caraH = Math.min(1, (f.ancho * a.ancho * 1.3) / a.alto);
  const v = visibleDe({}, a, W, H);
  let aCuadro: (x: number, y: number) => { x: number; y: number };
  let ex: number;
  let ey: number;
  if (v.todo) {
    // Contener: el asset entero, centrado, con bandas.
    const s = Math.min(W / a.ancho, H / a.alto);
    const ox = (W - a.ancho * s) / 2;
    const oy = (H - a.alto * s) / 2;
    aCuadro = (x, y) => ({ x: ox + x * a.ancho! * s, y: oy + y * a.alto! * s });
    ex = a.ancho * s;
    ey = a.alto * s;
  } else {
    aCuadro = (x, y) => ({ x: ((x - v.x) / v.w) * W, y: ((y - v.y) / v.h) * H });
    ex = W / v.w;
    ey = H / v.h;
  }
  const c = aCuadro(f.x - caraW / 2, f.y - caraH / 2);
  const cara: Caja = { x: c.x, y: c.y, w: caraW * ex, h: caraH * ey };
  // El cuerpo: debajo de la cara, unas tres caras de ancho, hasta abajo del cuadro.
  const cuerpo: Caja = { x: cara.x - cara.w, y: cara.y + cara.h, w: cara.w * 3, h: Math.max(0, H - (cara.y + cara.h)) };
  return [
    { caja: cara, peso: peso * confianza },
    { caja: cuerpo, peso: peso * confianza * PESO_CUERPO },
  ];
}

/** Las zonas a no tapar de todo el video: la cara (y el cuerpo) del visual de cada escena, por su duración. */
export function zonasDelVideo(p: Proyecto, W: number, H: number): Zona[] {
  const total = escenasEnLinea(p).reduce((s, e) => s + e.duracion, 0) || 1;
  return escenasEnLinea(p).flatMap((e) => {
    const a = p.assets[e.visual.asset];
    // Si la escena fija el encuadre a mano (ancla), visibleDe igual lo respeta vía el clip: se usa el del clip.
    return a && e.visual.ancla === undefined ? zonasDeAsset(a, W, H, e.duracion / total) : [];
  });
}
