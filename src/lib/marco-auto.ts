/**
 * Esquina «auto» del presentador en burbuja: la que menos tapa las caras de las escenas. La burbuja sólo
 * cabe entre la marca de arriba y los subtítulos (marco.ts); en 9:16 eso es la franja del medio, justo
 * donde suele estar la persona de la escena. Se prueban las cuatro esquinas de esa franja y se queda la que
 * menos se encima con las caras (y, con menos peso, con el cuerpo debajo de cada cara), pesando cada escena
 * por lo que dura y por cuán segura es la detección. Una sola esquina para todo el video: que no salte.
 *
 * Función pura (sirve en el navegador): las zonas las calcula caras-zonas.ts en el servidor; la usan el
 * compilador (render y vista en vivo) y el panel del presentador.
 */
import type { Marco } from "./esquema";
import type { Caja, Metricas } from "./formatos";
import { cajaMarco } from "./marco";

export type Esquina = Exclude<Marco["esquina"], "auto">;

/** En empate, este orden (abajo a la derecha es lo de siempre). */
export const ESQUINAS: Esquina[] = ["abajo-derecha", "abajo-izquierda", "arriba-derecha", "arriba-izquierda"];

/** Una zona a no tapar, en píxeles del cuadro final, con su peso. */
export interface Zona { caja: Caja; peso: number }

const area = (c: Caja) => Math.max(0, c.w) * Math.max(0, c.h);
function encima(a: Caja, b: Caja): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Cuánto tapa la burbuja en cada esquina (0 = nada). Función pura, para las pruebas y el panel. */
export function puntajes(marco: Marco, m: Metricas, zonas: Zona[]): Record<Esquina, number> {
  const out = {} as Record<Esquina, number>;
  for (const esquina of ESQUINAS) {
    const b = cajaMarco({ ...marco, esquina }, m);
    out[esquina] = zonas.reduce((s, z) => s + (area(z.caja) ? (encima(b, z.caja) / area(z.caja)) * z.peso : 0), 0);
  }
  return out;
}

/** Las esquinas que se pueden usar: un recorte de cuerpo entero sin fondo va abajo (arriba quedaría flotando). */
export const esquinasPara = (marco: Marco): Esquina[] =>
  (marco.forma as string) === "recorte" ? ESQUINAS.filter((e) => e.startsWith("abajo")) : ESQUINAS;

export function mejorEsquina(marco: Marco, m: Metricas, zonas: Zona[]): Esquina {
  const pts = puntajes(marco, m, zonas);
  // Diferencias de menos del 2 % de una cara no cuentan: gana el orden de ESQUINAS.
  return esquinasPara(marco).reduce((mejor, e) => (pts[e] < pts[mejor] - 0.02 ? e : mejor));
}

/** Tapar menos que esto (fracción de una cara, ya pesada) cuenta como no tapar. */
export const TOLERANCIA = 0.03;
/** «auto» puede achicar la burbuja hasta acá para no tapar caras (el tamaño «Chica» del panel). */
export const TAMANO_MIN_AUTO = 0.26;

/**
 * El marco con la esquina ya elegida. «auto»: la esquina que menos tapa; si en todas tapa una cara, prueba
 * tamaños un poco menores (hasta TAMANO_MIN_AUTO) y se queda con el más grande que no tapa. Si ninguno
 * alcanza, el tamaño pedido en la mejor esquina. Una esquina elegida a mano se respeta tal cual.
 */
export function resolverMarco(marco: Marco, m: Metricas, zonas: Zona[]): Marco & { esquina: Esquina } {
  if (marco.esquina !== "auto") return marco as Marco & { esquina: Esquina };
  const base = { ...marco, esquina: mejorEsquina(marco, m, zonas) };
  if (!zonas.length || puntajes(base, m, zonas)[base.esquina] <= TOLERANCIA) return base;
  for (let t = Math.round((marco.tamano - 0.02) * 100) / 100; t >= TAMANO_MIN_AUTO - 1e-9; t = Math.round((t - 0.02) * 100) / 100) {
    const chico = { ...marco, tamano: t };
    const e = mejorEsquina(chico, m, zonas);
    if (puntajes(chico, m, zonas)[e] <= TOLERANCIA) return { ...chico, esquina: e };
  }
  return base;
}
