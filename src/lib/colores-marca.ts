/**
 * Colores de marca sin dependencias (sirve en el servidor y en el navegador): leer `#rgb`, `#rrggbb` y
 * `rgba()`, contraste WCAG 2.x, paleta por *median cut* y una propuesta de qué color va en cada rol de
 * la plantilla. (Los looks y LUT del video están en `color.ts`.)
 *
 * La paleta es el `color.extractTheme` de DesignCraft (`crates/engine/src/cmd/color_theme.rs:71-127`):
 * se parte la caja de mayor rango × peso por su eje más largo, hasta 5 cajas, sin colores transparentes.
 * Diferencia: el corte va donde queda menos varianza, no en la mediana, para no inventar colores.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

export function leerColor(texto: string): Rgba | null {
  const t = texto.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const f = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (f) {
    const c = (x: string) => Math.max(0, Math.min(255, Math.round(Number(x))));
    return { r: c(f[1]!), g: c(f[2]!), b: c(f[3]!), a: f[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(f[4]))) };
  }
  return null;
}

const dos = (n: number) => Math.round(n).toString(16).padStart(2, "0");

export function aHex(c: Pick<Rgba, "r" | "g" | "b">): string {
  return `#${dos(c.r)}${dos(c.g)}${dos(c.b)}`;
}

/** `#rrggbb` si es opaco; `rgba(r, g, b, a)` si no (lo que acepta el esquema de plantillas). */
export function aTexto(c: Rgba): string {
  return c.a >= 1 ? aHex(c) : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Number(c.a.toFixed(2))})`;
}

/** Un color con transparencia pintado sobre un fondo opaco. */
export function sobre(c: Rgba, fondo: Rgba): Rgba {
  const m = (x: number, y: number) => x * c.a + y * (1 - c.a);
  return { r: m(c.r, fondo.r), g: m(c.g, fondo.g), b: m(c.b, fondo.b), a: 1 };
}

/** Luminancia relativa WCAG 2.x (0 = negro, 1 = blanco). */
export function luminancia(c: Pick<Rgba, "r" | "g" | "b">): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contraste(a: Pick<Rgba, "r" | "g" | "b">, b: Pick<Rgba, "r" | "g" | "b">): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const BLANCO: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const NEGRO: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/**
 * Contraste del texto sobre un fondo que puede ser semitransparente. Debajo está el video, que puede
 * ser claro u oscuro: se toma el peor caso entre un cuadro blanco y uno negro.
 */
export function contrastePeor(texto: string, fondo: string): number | null {
  const t = leerColor(texto);
  const f = leerColor(fondo);
  if (!t || !f) return null;
  return Math.min(...[BLANCO, NEGRO].map((v) => contraste(sobre(t, sobre(f, v)), sobre(f, v))));
}

export type Legibilidad = "bien" | "justo" | "mal";

/** Texto grande y grueso (subtítulos, títulos): WCAG pide ≥ 3:1; ≥ 4,5:1 se lee cómodo. */
export function legibilidad(ratio: number): Legibilidad {
  return ratio >= 4.5 ? "bien" : ratio >= 3 ? "justo" : "mal";
}

// ---- Arreglos de un toque (el editor los ofrece cuando algo no se lee).

const OSCURO = "#0b0d12";
const CLARO = "#ffffff";

/**
 * Color del texto sobre un fondo opaco: el preferido si se lee (≥ 3:1), si no, casi negro o blanco,
 * el que más contraste. Lo usa el compilador para las letras del botón final.
 */
export function textoSobre(fondo: string | string[], preferido: string): string {
  const fondos = Array.isArray(fondo) ? fondo : [fondo];
  const peor = (t: string) => Math.min(...fondos.map((f) => contrastePeor(t, f) ?? 21));
  if (peor(preferido) >= 3) return preferido;
  return peor(OSCURO) >= peor(CLARO) ? OSCURO : CLARO;
}

/** Sube la opacidad de un fondo lo justo para que todos los textos lleguen al objetivo (máx. 95 %). */
export function opacidadHasta(fondo: string, textos: string[], objetivo: number): string | null {
  const f = leerColor(fondo);
  if (!f) return null;
  for (let a = Math.round(f.a * 100); a <= 95; a++) {
    const cand = aTexto({ ...f, a: a / 100 });
    if (textos.every((t) => (contrastePeor(t, cand) ?? 0) >= objetivo)) return cand;
  }
  return null;
}

/** Aclara u oscurece un color lo mínimo para que se lea sobre el fondo (o null si no hace falta / no se puede). */
export function ajustarHasta(color: string, fondo: string, objetivo: number): string | null {
  const c = leerColor(color);
  if (!c || (contrastePeor(color, fondo) ?? 0) >= objetivo) return null;
  for (let paso = 1; paso <= 20; paso++) {
    for (const hacia of [BLANCO, NEGRO]) {
      const t = paso / 20;
      const cand = aHex({ r: c.r + (hacia.r - c.r) * t, g: c.g + (hacia.g - c.g) * t, b: c.b + (hacia.b - c.b) * t });
      if ((contrastePeor(cand, fondo) ?? 0) >= objetivo) return cand;
    }
  }
  return null;
}

type RolesPlantilla = "tinta" | "activa" | "acento1" | "acento2" | "fondoPastilla" | "fondoCierre";

/**
 * Lo mismo que los botones «Arreglar» del editor, de una vez: caja de subtítulos y palabra que suena a
 * 4,5:1 y título final a 3:1, cambiando lo mínimo. Para colores que no eligió una persona (los de una
 * página web), así el primer video ya se lee. Si algo no se puede arreglar, se deja como estaba.
 */
export function hacerLegible<T extends Record<RolesPlantilla, string>>(c: T): T {
  const n = { ...c };
  n.fondoPastilla = opacidadHasta(n.fondoPastilla, [n.tinta], 4.5) ?? n.fondoPastilla;
  n.activa = ajustarHasta(n.activa, n.fondoPastilla, 4.5) ?? n.activa;
  const cierre = opacidadHasta(n.fondoCierre, [n.acento1, n.acento2], 3);
  if (cierre) n.fondoCierre = cierre;
  return n;
}

// ---- Paleta desde una imagen.

/** Una muestra: color y su peso (el alfa del píxel; los transparentes no entran). */
export type Muestra = [r: number, g: number, b: number, peso: number];

export interface ColorPaleta {
  hex: string;
  /** Fracción de la imagen (0..1) que representa. */
  parte: number;
}

/** Muestras RGBA (4 bytes por píxel, como `ffmpeg -f rawvideo -pix_fmt rgba`). */
export function muestrasRgba(datos: Uint8Array): Muestra[] {
  const out: Muestra[] = [];
  for (let i = 0; i + 3 < datos.length; i += 4) {
    const a = datos[i + 3]!;
    if (a > 0) out.push([datos[i]!, datos[i + 1]!, datos[i + 2]!, a]);
  }
  return out;
}

/** Median cut ponderado: hasta `max` colores, del más presente al menos; determinista. */
export function paleta(muestras: Muestra[], max = 5): ColorPaleta[] {
  if (!muestras.length) return [];
  const pesoDe = (caja: Muestra[]) => caja.reduce((s, m) => s + m[3], 0);
  const rango = (caja: Muestra[]): [number, number] => {
    let mejor: [number, number] = [0, 0];
    for (let eje = 0; eje < 3; eje++) {
      let lo = 255;
      let hi = 0;
      for (const m of caja) {
        lo = Math.min(lo, m[eje]!);
        hi = Math.max(hi, m[eje]!);
      }
      if (hi - lo > mejor[0]) mejor = [hi - lo, eje];
    }
    return mejor;
  };
  const cajas: Muestra[][] = [muestras];
  while (cajas.length < max) {
    // La caja que más «pesa» por su rango se parte primero (como DesignCraft: rango × peso).
    let elegida = -1;
    let eje = 0;
    let valor = 0;
    cajas.forEach((c, i) => {
      const [r, e] = rango(c);
      const v = r * pesoDe(c);
      if (r > 0 && v > valor) [elegida, eje, valor] = [i, e, v];
    });
    if (elegida < 0) break;
    const caja = cajas.splice(elegida, 1)[0]!.slice().sort((a, b) => a[eje]! - b[eje]!);
    // DesignCraft corta en la mediana ponderada; aquí se corta donde menos varianza queda a cada lado
    // (y sólo entre valores distintos), para no promediar dos colores del logo en uno que no existe.
    const n = caja.length;
    const w = new Float64Array(n + 1);
    const s = new Float64Array(n + 1);
    const s2 = new Float64Array(n + 1);
    caja.forEach((m, i) => {
      const v = m[eje]!;
      w[i + 1] = w[i]! + m[3];
      s[i + 1] = s[i]! + m[3] * v;
      s2[i + 1] = s2[i]! + m[3] * v * v;
    });
    const sse = (i: number, j: number) => {
      const peso = w[j]! - w[i]!;
      return peso ? s2[j]! - s2[i]! - (s[j]! - s[i]!) ** 2 / peso : 0;
    };
    let corte = 1;
    let mejor = Infinity;
    for (let i = 1; i < n; i++) {
      if (caja[i]![eje] === caja[i - 1]![eje]) continue;
      const v = sse(0, i) + sse(i, n);
      if (v < mejor) [mejor, corte] = [v, i];
    }
    cajas.push(caja.slice(0, corte), caja.slice(corte));
  }
  const total = pesoDe(muestras);
  const porHex = new Map<string, number>();
  for (const caja of cajas) {
    const w = pesoDe(caja);
    if (!w) continue;
    const prom = (eje: number) => caja.reduce((s, m) => s + m[eje]! * m[3], 0) / w;
    const hex = aHex({ r: prom(0), g: prom(1), b: prom(2) });
    porHex.set(hex, (porHex.get(hex) ?? 0) + w / total);
  }
  return [...porHex].map(([hex, parte]) => ({ hex, parte })).sort((a, b) => b.parte - a.parte || a.hex.localeCompare(b.hex));
}

// ---- Qué color va en cada rol.

function hsl(c: Pick<Rgba, "r" | "g" | "b">): { h: number; s: number; l: number } {
  const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Qué tan «de marca» es un color: saturado y ni casi blanco ni casi negro. */
function viveza(hex: string): number {
  const c = leerColor(hex)!;
  const { s, l } = hsl(c);
  return s * (1 - Math.abs(2 * l - 1));
}

const distanciaTono = (a: string, b: string) => {
  const d = Math.abs(hsl(leerColor(a)!).h - hsl(leerColor(b)!).h);
  return Math.min(d, 360 - d);
};

export interface Roles {
  acento1?: string;
  acento2?: string;
  activa?: string;
}

/**
 * Propuesta de roles desde una paleta: acento 1 = el color de marca más presente; acento 2 = otro de
 * tono distinto (o una variante del primero); palabra activa = el más vivo que se lea sobre la pastilla.
 * Sólo propone: la persona confirma. Devuelve sólo los roles que pudo llenar.
 */
export function proponerRoles(colores: ColorPaleta[], fondoPastilla = "rgba(8, 8, 18, 0.62)", fondoCierre = "rgba(0, 0, 0, 0.72)"): Roles {
  const vivos = colores.filter((c) => viveza(c.hex) >= 0.18);
  const puntaje = (c: ColorPaleta) => viveza(c.hex) * (0.35 + c.parte);
  const orden = [...vivos].sort((a, b) => puntaje(b) - puntaje(a));
  // El principal es el más característico de la marca, se lea o no (el editor avisa si no se lee).
  // El secundario acompaña al principal en el título final: mejor si se lee sobre el fondo del cierre.
  const enCierre = (c: ColorPaleta) => contrastePeor(c.hex, fondoCierre) ?? 0;
  const out: Roles = {};
  const a1 = orden[0];
  if (!a1) return out;
  out.acento1 = a1.hex;
  const otros = orden.filter((c) => c !== a1);
  const a2 =
    otros.find((c) => distanciaTono(c.hex, a1.hex) >= 25 && enCierre(c) >= 3) ??
    otros.find((c) => enCierre(c) >= 3) ??
    [...otros].sort((x, y) => enCierre(y) - enCierre(x))[0];
  if (a2) out.acento2 = a2.hex;
  const legibles = orden
    .map((c) => ({ c, k: contrastePeor(c.hex, fondoPastilla) ?? 0 }))
    .filter((x) => x.k >= 3)
    .sort((x, y) => viveza(y.c.hex) * Math.min(y.k, 7) - viveza(x.c.hex) * Math.min(x.k, 7));
  if (legibles[0]) out.activa = legibles[0].c.hex;
  return out;
}
