/**
 * Revisión medida de una portada ya armada (idea de la validación de lienzo de Avnac Studio, GPL-3.0:
 * reescrita, sin su código; ver docs/HEREDADO.md). Cada aviso sale de una medida sobre la imagen o la
 * plantilla, no de una opinión: el tamaño de la letra cuando la portada se ve chica, el contraste del
 * título contra los píxeles que lo rodean, la esquina donde YouTube pone la duración y los márgenes.
 * Termina en un veredicto (lista, mejorable, conviene cambiarla) y nombra siempre algo que funciona.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contraste, leerColor, legibilidad, type Rgba } from "./colores-marca";
import type { Formato } from "./esquema";
import { ffmpeg } from "./media";

/** [x, y, ancho, alto] en píxeles de la portada. */
export type Caja = [number, number, number, number];

/**
 * Ancho (px) más chico en que se suele ver la portada: la columna «a continuación» de YouTube en la
 * computadora (16:9), el estante de Shorts en el celular (9:16) y la cuadrícula de un perfil (1:1).
 */
export const ANCHO_CHICA: Record<Formato, number> = { "16:9": 168, "9:16": 180, "1:1": 130 };

/** Alto de letra (px) a ese ancho: desde 10 se lee, de 8 a 10 cuesta, menos de 8 no se lee. */
export const LETRA_CHICA = { bien: 10, justo: 8 } as const;

/** Más palabras que esto ya no se leen de un vistazo en una portada. */
export const PALABRAS_MAX = 6;

/** Esquina donde YouTube pone la duración de los videos (fracción del ancho y del alto, desde abajo a la derecha). */
export const ZONA_RELOJ = { x: 0.85, y: 0.86 } as const;

/** Margen mínimo del título al borde, en fracción del lado corto. */
export const MARGEN_MIN = 0.03;

export type Nivel = "justo" | "mal";
export interface AvisoPortada {
  id: "letra-chica" | "muchas-palabras" | "contraste" | "reloj" | "margen" | "no-entra";
  nivel: Nivel;
  /** En palabras simples, con la medida y el arreglo. */
  texto: string;
}
export type Veredicto = "lista" | "mejorable" | "cambiar";
export interface RevisionPortada {
  veredicto: Veredicto;
  avisos: AvisoPortada[];
  /** Lo que funciona (siempre al menos una cosa). */
  bien: string[];
  /** Medidas en bruto, para mostrar o depurar. */
  medidas: { anchoChica: number; letraChica: number | null; palabras: number; contraste: number | null };
}

export interface DatosRevision {
  formato: Formato;
  ancho: number;
  alto: number;
  titulo: string;
  /** Caja de la capa del título (null si la plantilla no la tiene). */
  caja: Caja | null;
  /** Tamaño final de la letra del título (ya achicado si no entraba). */
  tamano: number | null;
  /** Contraste medido del título contra lo que lo rodea (null si no se pudo medir). */
  contraste: number | null;
  /** El título no entra ni achicado. */
  desborda: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function seTocan(a: Caja, b: Caja): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** Revisión de una portada a partir de sus medidas (función pura). */
export function revisarPortada(d: DatosRevision): RevisionPortada {
  const avisos: AvisoPortada[] = [];
  const bien: string[] = [];
  const palabras = d.titulo.trim().split(/\s+/).filter(Boolean).length;
  const chica = ANCHO_CHICA[d.formato];
  const letraChica = d.tamano && d.ancho > 0 ? r1((d.tamano * chica) / d.ancho) : null;

  if (d.desborda) avisos.push({ id: "no-entra", nivel: "mal", texto: "El título es muy largo y no entra entero ni con la letra más chica: acórtalo." });

  if (letraChica !== null) {
    if (letraChica < LETRA_CHICA.justo) {
      avisos.push({ id: "letra-chica", nivel: "mal", texto: `Vista chica (${chica} px de ancho, como en el celular), la letra mide ${letraChica} px y no se lee. Usa menos palabras para que la letra quede grande.` });
    } else if (letraChica < LETRA_CHICA.bien) {
      avisos.push({ id: "letra-chica", nivel: "justo", texto: `Vista chica, la letra mide ${letraChica} px: se lee con esfuerzo. Con un título más corto quedaría más grande.` });
    } else {
      bien.push("El título se lee aun cuando la portada se ve chica.");
    }
  }

  if (palabras > PALABRAS_MAX) {
    avisos.push({ id: "muchas-palabras", nivel: "justo", texto: `El título tiene ${palabras} palabras: en una portada se leen de un vistazo hasta ${PALABRAS_MAX}. Deja la idea principal y lo demás va en el título del video.` });
  } else if (palabras > 0) {
    bien.push("El título es corto: se entiende de un vistazo.");
  }

  if (d.contraste !== null) {
    const l = legibilidad(d.contraste);
    if (l === "mal") avisos.push({ id: "contraste", nivel: "mal", texto: `El título casi no se distingue de la imagen (contraste ${r1(d.contraste)}:1; hace falta 3:1 como mínimo). Prueba otra imagen más oscura o el diseño «Título al centro» o «Banda de color».` });
    else if (l === "justo") avisos.push({ id: "contraste", nivel: "justo", texto: `En algunas partes el título se confunde con la imagen (contraste ${r1(d.contraste)}:1; se lee cómodo desde 4,5:1). Una imagen con menos detalle detrás del texto ayuda.` });
    else bien.push("El título resalta bien sobre la imagen.");
  }

  if (d.caja) {
    const [x, y, w, h] = d.caja;
    if (d.formato === "16:9") {
      const reloj: Caja = [d.ancho * ZONA_RELOJ.x, d.alto * ZONA_RELOJ.y, d.ancho * (1 - ZONA_RELOJ.x), d.alto * (1 - ZONA_RELOJ.y)];
      if (seTocan(d.caja, reloj)) avisos.push({ id: "reloj", nivel: "justo", texto: "El título llega a la esquina de abajo a la derecha, donde YouTube pone la duración del video: puede quedar tapado. Súbelo o hazlo más angosto en el diseño." });
    }
    const margen = Math.min(x, y, d.ancho - (x + w), d.alto - (y + h));
    const piso = Math.min(d.ancho, d.alto) * MARGEN_MIN;
    if (margen < piso) avisos.push({ id: "margen", nivel: "justo", texto: `El título queda a ${Math.max(0, Math.round(margen))} px del borde: algunas apps recortan las orillas. Déjale al menos ${Math.round(piso)} px.` });
  }

  const veredicto: Veredicto = avisos.some((a) => a.nivel === "mal") ? "cambiar" : avisos.length ? "mejorable" : "lista";
  if (!bien.length) bien.push("La imagen sale de tu propio video: es la que la gente va a ver al darle play.");
  // Lo más grave primero.
  avisos.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "mal" ? -1 : 1));
  return { veredicto, avisos, bien, medidas: { anchoChica: chica, letraChica, palabras, contraste: d.contraste === null ? null : r1(d.contraste) } };
}

/** Distancia (al cuadrado, en RGB) hasta la que un píxel cuenta como «del color del título». */
const TOLERANCIA_TEXTO = 70 ** 2;
/** Anillo alrededor de las letras que se mide: se saltan `CERCA` px (bordes suavizados) y se mira hasta `LEJOS`. */
const CERCA = 2;
const LEJOS = 10;

/** Suma de una máscara en ventanas cuadradas de radio r (imagen integral), para dilatar. */
function dilatar(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const I = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) {
      fila += m[y * w + x]!;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1]! + fila;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * (w + 1) + x1]! - I[y0 * (w + 1) + x1]! - I[y1 * (w + 1) + x0]! + I[y0 * (w + 1) + x0]!;
      out[y * w + x] = s > 0 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Contraste del título contra lo que tiene alrededor (función pura). Busca los píxeles del color del
 * título, mira un anillo de unos px a su alrededor y devuelve el peor 10 % (el percentil 10 del
 * contraste): así un pedazo de cielo claro detrás de una letra cuenta aunque el resto sea oscuro.
 * `pix` es RGB (3 bytes por píxel). Null si el título no aparece (otro color, o no hay texto).
 */
export function contrasteAlrededor(pix: Uint8Array, w: number, h: number, color: Pick<Rgba, "r" | "g" | "b">): number | null {
  const n = w * h;
  if (n === 0 || pix.length < n * 3) return null;
  const texto = new Uint8Array(n);
  let cuantos = 0;
  for (let i = 0; i < n; i++) {
    const dr = pix[i * 3]! - color.r, dg = pix[i * 3 + 1]! - color.g, db = pix[i * 3 + 2]! - color.b;
    if (dr * dr + dg * dg + db * db <= TOLERANCIA_TEXTO) {
      texto[i] = 1;
      cuantos++;
    }
  }
  if (cuantos < n * 0.005) return null;
  if (cuantos > n * 0.6) {
    // Casi toda la caja «es del color del título»: el fondo se le parece y la letra se pierde.
    const todos = Array.from({ length: n }, (_, i) => contraste(color, { r: pix[i * 3]!, g: pix[i * 3 + 1]!, b: pix[i * 3 + 2]! })).sort((x, y) => x - y);
    return todos[Math.floor(n / 2)]!;
  }
  const cerca = dilatar(texto, w, h, CERCA);
  const lejos = dilatar(texto, w, h, LEJOS);
  const valores: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!lejos[i] || cerca[i]) continue;
    valores.push(contraste(color, { r: pix[i * 3]!, g: pix[i * 3 + 1]!, b: pix[i * 3 + 2]! }));
  }
  if (!valores.length) return null;
  valores.sort((a, b) => a - b);
  return valores[Math.floor(valores.length * 0.1)]!;
}

/** Mide el contraste del título en la imagen ya exportada (lee sólo la caja del título, en CPU). */
export async function medirContrasteTitulo(imagen: string, caja: Caja, colorTitulo: string, ancho: number, alto: number): Promise<number | null> {
  const color = leerColor(colorTitulo);
  if (!color) return null;
  const x = Math.max(0, Math.floor(caja[0]));
  const y = Math.max(0, Math.floor(caja[1]));
  const w = Math.min(ancho - x, Math.ceil(caja[2]));
  const h = Math.min(alto - y, Math.ceil(caja[3]));
  if (w < 4 || h < 4) return null;
  const salida = path.join(os.tmpdir(), `geeper-revision-${randomUUID()}.rgb`);
  try {
    await ffmpeg(["-v", "error", "-i", imagen, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", salida]);
    return contrasteAlrededor(new Uint8Array(await fs.readFile(salida)), w, h, color);
  } catch {
    return null; // la revisión es una ayuda: si no se puede medir, no frena la portada
  } finally {
    await fs.rm(salida, { force: true });
  }
}

/**
 * Recorte de la imagen a la proporción `w:h` (filtro de ffmpeg, función pura). Sin foco, al centro; con
 * el punto de una cara (0..1), la deja centrada a lo ancho y al 40 % del alto, con aire arriba, sin
 * salirse de la imagen.
 */
export function filtroRecorte(w: number, h: number, foco?: { x: number; y: number } | null): string {
  const tam = `crop='min(iw,ih*${w}/${h})':'min(ih,iw*${h}/${w})'`;
  if (!foco) return tam;
  const fx = Math.min(1, Math.max(0, foco.x)).toFixed(4);
  const fy = Math.min(1, Math.max(0, foco.y)).toFixed(4);
  return `${tam}:'max(0,min(iw-ow,iw*${fx}-ow/2))':'max(0,min(ih-oh,ih*${fy}-oh*0.4))'`;
}
