/**
 * «Copiar la marca de tu página web»: abre la página en el Chrome headless (el que baja Hyperframes, o
 * el de Playwright) y lee del DOM y del CSS los colores, las letras y el logo, para llenar una plantilla.
 *
 * La lectura es una versión reducida de la captura de marca del clipper de OpenDesign
 * (nexu-io/open-design, Apache-2.0, `clipper/brand-capture.js`, commit a7eb8e9): cada color suma
 * puntos por el área que pinta y por estar en botones y enlaces, más `theme-color` y las variables CSS
 * de color; la letra de títulos sale del `h1`, la de texto de `body`/`p`; el logo, de las imágenes y SVG
 * del encabezado cuyo texto alternativo, clase o id dicen «logo» o el nombre de la marca. Aquí se suma
 * lo que necesita el video: la paleta pasa por `proponerRoles` (los mismos roles que con un logo) y
 * cada letra se cambia por la de Google Fonts más parecida, porque Hyperframes sólo descarga ésas.
 *
 * La parte pura (`resumirMarca`, `fuenteGoogle`, `normalizarUrl`) se prueba sin navegador.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aHex, leerColor, proponerRoles, type ColorPaleta, type Roles } from "./colores-marca";
import { CACHE_HF } from "./rutas";

/** Lo que devuelve la página, sin interpretar. */
export interface CapturaCruda {
  nombre: string;
  colores: { color: string; puntaje: number }[];
  fuentes: { titulos: string; texto: string };
  logos: { src?: string; svg?: string; puntaje: number }[];
}

export interface FuenteParecida {
  fuente: string;
  /** true: la misma letra de la página; false: la de Google Fonts más parecida. */
  exacta: boolean;
  /** Cómo se llama en la página. */
  original: string;
}

export interface MarcaWeb {
  nombre: string;
  colores: ColorPaleta[];
  roles: Roles;
  tipografia: { titulos: FuenteParecida; texto: FuenteParecida };
}

/** El link como lo escribe la persona («mitienda.com») → URL http(s) completa. */
export function normalizarUrl(texto: string): string {
  const t = texto.trim();
  if (!t) throw new Error("Escribe el link de tu página");
  // «localhost:3000» o «mitienda.com:8080» no traen esquema; «javascript:», «file:///» sí (y se rechazan abajo).
  const conEsquema = /^[a-z][a-z0-9+.-]*:(\/\/|(?!\d))/i.test(t) ? t : `https://${t}`;
  let u: URL;
  try {
    u = new URL(conEsquema);
  } catch {
    throw new Error("Ese link no parece una página web. Ejemplo: mitienda.com");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Sólo se pueden leer páginas web (links que empiezan con http o https)");
  if (!u.hostname.includes(".") && u.hostname !== "localhost") throw new Error("Ese link no parece una página web. Ejemplo: mitienda.com");
  return u.toString();
}

// ---- Letras: la de Google Fonts más parecida.

/** Letras de Google Fonts que se reconocen tal cual (además de las del editor y de los estilos). */
const GOOGLE = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway", "Nunito", "Nunito Sans", "Rubik", "Work Sans",
  "DM Sans", "Outfit", "Barlow", "Barlow Condensed", "Oswald", "Anton", "Bebas Neue", "Archivo", "Archivo Black", "Space Grotesk",
  "Manrope", "Plus Jakarta Sans", "Karla", "Mulish", "Figtree", "Sora", "Lexend", "Urbanist", "Red Hat Display", "Josefin Sans",
  "Quicksand", "Cabin", "Fira Sans", "Ubuntu", "PT Sans", "Noto Sans", "Source Sans 3", "IBM Plex Sans", "Public Sans",
  "Libre Franklin", "Hanken Grotesk", "Schibsted Grotesk", "Instrument Sans", "Albert Sans", "Onest", "Geist", "Kanit", "Prompt",
  "Heebo", "Assistant", "Titillium Web", "Exo 2", "Syne", "Unbounded", "Bricolage Grotesque", "Fredoka", "Teko", "Bungee",
  "Righteous", "Lobster", "Pacifico", "Caveat", "Comic Neue", "Playfair Display", "Merriweather", "Lora", "PT Serif",
  "Libre Baskerville", "EB Garamond", "Cormorant Garamond", "Crimson Text", "Noto Serif", "Source Serif 4", "Bitter",
  "Roboto Slab", "DM Serif Display", "Instrument Serif", "Fraunces", "Bodoni Moda", "Abril Fatface", "Alfa Slab One",
  "Shippori Mincho", "IBM Plex Serif", "Roboto Mono", "IBM Plex Mono", "Source Code Pro", "JetBrains Mono", "Fira Code",
  "Space Mono", "Geist Mono", "Courier Prime", "Roboto Condensed",
];
const POR_NOMBRE = new Map(GOOGLE.map((f) => [f.toLowerCase(), f]));

/** Nombres viejos o de archivo de letras que hoy tienen otro nombre en Google Fonts. */
const ALIAS: Record<string, string> = { "source sans pro": "Source Sans 3", "source serif pro": "Source Serif 4", "sourcesanspro": "Source Sans 3" };

/** «__Inter_a1b2c3» (next/font), «Inter Variable», «"Inter var"», «SourceSansProBold» → «inter», «source sans pro». */
function limpiarFamilia(f: string): string {
  return f
    .replace(/["']/g, "")
    .replace(/(Regular|Bold|Light|Medium|Semi[Bb]old|Thin|Italic)$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^_+/, "")
    .replace(/_Fallback_[0-9a-f]+$/i, "")
    .replace(/_[0-9a-f]{5,}$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+(variable|var|vf)$/i, "")
    .trim()
    .toLowerCase();
}

/** La primera letra de la pila que sea de Google Fonts; si ninguna, la de Google más parecida por tipo. */
export function fuenteGoogle(pila: string, uso: "titulos" | "texto"): FuenteParecida {
  const familias = pila.split(",").map((f) => f.trim()).filter(Boolean);
  const original = familias[0]?.replace(/["']/g, "") || "la del sistema";
  for (const f of familias) {
    const g = POR_NOMBRE.get(limpiarFamilia(f)) ?? ALIAS[limpiarFamilia(f)];
    if (g) return { fuente: g, exacta: limpiarFamilia(f) === limpiarFamilia(familias[0]!), original };
  }
  const p = pila.toLowerCase();
  let fuente: string;
  if (/mono|courier|consolas|menlo/.test(p)) fuente = "IBM Plex Mono";
  else if (/impact|arial black|heavy|black\b/.test(p)) fuente = uso === "titulos" ? "Archivo Black" : "Archivo";
  else if (/didot|bodoni/.test(p)) fuente = uso === "titulos" ? "Bodoni Moda" : "Lato";
  else if (/garamond|baskerville|georgia|times|mincho|canela|tiempos|serif/.test(p.replace(/sans-serif/g, ""))) fuente = uso === "titulos" ? "Playfair Display" : "Merriweather";
  else if (/rounded|comic|nunito/.test(p)) fuente = "Nunito";
  else fuente = "Inter";
  return { fuente, exacta: false, original };
}

// ---- Colores.

/** Colores que pone el navegador cuando la página no elige (enlaces sin estilo): no son de la marca. */
const PREDETERMINADOS = new Set(["#0000ee", "#551a8b", "#ee0000"]);

/** Paleta de la página: colores opacos, sin repetir casi iguales, con su parte del total (como `paleta()`). */
export function resumirMarca(c: CapturaCruda): MarcaWeb {
  const puntos = new Map<string, number>();
  for (const { color, puntaje } of c.colores) {
    const rgba = leerColor(color);
    if (!rgba || rgba.a < 0.5 || !(puntaje > 0)) continue;
    const hex = aHex(rgba);
    if (PREDETERMINADOS.has(hex)) continue;
    puntos.set(hex, (puntos.get(hex) ?? 0) + puntaje);
  }
  const orden = [...puntos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const distintos: [string, number][] = [];
  for (const [hex, p] of orden) {
    const c1 = leerColor(hex)!;
    const cerca = distintos.find(([h]) => {
      const c2 = leerColor(h)!;
      return Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b) < 44;
    });
    if (cerca) cerca[1] += p;
    else if (distintos.length < 8) distintos.push([hex, p]);
  }
  const total = distintos.reduce((s, [, p]) => s + p, 0) || 1;
  const colores = distintos.map(([hex, p]) => ({ hex, parte: p / total })).sort((a, b) => b.parte - a.parte || a.hex.localeCompare(b.hex));
  return {
    nombre: c.nombre.trim().slice(0, 40),
    colores,
    roles: proponerRoles(colores),
    tipografia: { titulos: fuenteGoogle(c.fuentes.titulos, "titulos"), texto: fuenteGoogle(c.fuentes.texto, "texto") },
  };
}

// ---- La página (corre dentro de Chrome: JavaScript plano, sin depender de cómo se compile este archivo).

const LEER_PAGINA = `(() => {
  const meta = (n) => document.querySelector('meta[name="' + n + '"], meta[property="og:' + n + '"]')?.getAttribute('content') || '';
  const colores = [];
  const sumar = (color, puntaje) => { if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') colores.push({ color: String(color).trim(), puntaje }); };
  sumar(meta('theme-color'), 60);
  const raiz = getComputedStyle(document.documentElement);
  sumar(raiz.backgroundColor, 25);
  sumar(getComputedStyle(document.body).backgroundColor, 40);
  sumar(getComputedStyle(document.body).color, 40);
  for (let i = 0; i < raiz.length; i++) {
    const p = raiz[i];
    if (p && p.startsWith('--') && /(color|bg|background|accent|brand|primary|secondary)/i.test(p)) sumar(raiz.getPropertyValue(p), 16);
  }
  const todos = document.body.getElementsByTagName('*');
  for (let i = 0, n = 0; i < todos.length && n < 1400; i++) {
    const el = todos[i];
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    n++;
    const area = Math.min(40, Math.max(1, (r.width * r.height) / 6000));
    const control = /^(a|button)$/i.test(el.tagName) || el.getAttribute('role') === 'button';
    sumar(s.backgroundColor, area + (control ? 24 : 0));
    sumar(s.color, Math.min(18, (el.textContent || '').trim().length / 12) + (control ? 18 : 2));
    if (el instanceof SVGElement) sumar(s.fill, 4);
  }
  const pila = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : getComputedStyle(document.body).fontFamily; };
  const nombre = meta('site_name') || document.title.split(/\\s[|\\-–—·:]\\s/)[0] || location.hostname;
  const marca = nombre.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const logos = [];
  const pareceLogo = (el) => {
    const h = ((el.getAttribute('alt') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('class') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    return { logo: /(logo|brand|marca|wordmark)/.test(h) || !!el.closest('header, nav, [class*="header" i], [class*="logo" i]'), nombre: marca.length > 2 && h.replace(/[^a-z0-9]+/g, ' ').includes(marca) };
  };
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    const r = img.getBoundingClientRect();
    if (!src || src.startsWith('data:') || r.width < 24 || r.height < 12) continue;
    const p = pareceLogo(img);
    if (!p.logo) continue;
    logos.push({ src, puntaje: 75 + Math.min(20, (r.width * r.height) / 2000) + (p.nombre ? 30 : 0) - (r.top > innerHeight ? 40 : 0) });
  }
  for (const svg of Array.from(document.querySelectorAll('svg'))) {
    const r = svg.getBoundingClientRect();
    if (r.width < 40 || r.height < 12 || r.top > innerHeight) continue;
    const p = pareceLogo(svg);
    const enlaceInicio = svg.closest('a[href="/"], a[href="./"], a[href="' + location.origin + '/"]');
    if (!p.logo && !enlaceInicio) continue;
    const copia = svg.cloneNode(true);
    if (!copia.getAttribute('viewBox')) copia.setAttribute('viewBox', '0 0 ' + Math.round(r.width) + ' ' + Math.round(r.height));
    copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const color = getComputedStyle(svg).color;
    const texto = copia.outerHTML.replace(/currentColor/g, color);
    if (texto.length < 200000) logos.push({ svg: texto, puntaje: 80 + Math.min(20, (r.width * r.height) / 2000) + (p.nombre ? 30 : 0) + (enlaceInicio ? 15 : 0) });
  }
  for (const l of Array.from(document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]'))) {
    const href = l.href;
    if (href && !/\\.ico(\\?|$)/i.test(href)) logos.push({ src: href, puntaje: /apple-touch/.test(l.rel) ? 50 : 30 });
  }
  return { nombre, colores, fuentes: { titulos: pila('h1, h2, [class*="hero" i] [class*="title" i]'), texto: pila('p, body') }, logos };
})()`;

/** El Chrome headless que ya baja Hyperframes (en desarrollo o en la app de escritorio); si no, el de Playwright. */
function chrome(): string | undefined {
  for (const base of [path.join(os.homedir(), ".cache", "hyperframes"), CACHE_HF]) {
    try {
      const raiz = path.join(base, "chrome", "chrome-headless-shell");
      const v = fs.readdirSync(raiz).sort().pop()!;
      for (const sub of ["chrome-headless-shell-linux64", "chrome-headless-shell-win64", "chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
        for (const exe of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
          const ruta = path.join(raiz, v, sub, exe);
          if (fs.existsSync(ruta)) return ruta;
        }
      }
    } catch {
      /* no está en esta carpeta */
    }
  }
  return undefined;
}

const EXT_POR_TIPO: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg" };
const MAX_LOGO = 5 * 1024 ** 2;

export interface LogoWeb {
  datos: Buffer;
  /** Nombre con la extensión que corresponde a su formato (para `guardarImagenSubida`). */
  nombre: string;
}

/** Abre la página y devuelve su marca y, si encontró uno que se pueda usar, su logo. */
export async function capturarMarcaWeb(url: string, op: { signal?: AbortSignal } = {}): Promise<{ marca: MarcaWeb; logo: LogoWeb | null; url: string }> {
  const destino = normalizarUrl(url);
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("Esta instalación no trae el navegador para leer páginas web. En la versión de desarrollo sí funciona.");
  }
  let nav: import("playwright-core").Browser;
  try {
    nav = await pw.chromium.launch({ executablePath: chrome() });
  } catch {
    throw new Error("No se pudo abrir el navegador interno. Abre una vez «Demo de tu página» o un render para que se descargue, y vuelve a probar.");
  }
  const cerrar = () => void nav.close().catch(() => {});
  op.signal?.addEventListener("abort", cerrar, { once: true });
  try {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-MX", colorScheme: "light" });
    const page = await ctx.newPage();
    try {
      await page.goto(destino, { waitUntil: "load", timeout: 45_000 });
    } catch (e) {
      throw new Error(`No se pudo abrir ${destino}: revisa que el link esté bien escrito y que la página abra en tu navegador (${e instanceof Error ? e.message.split("\n")[0] : e}).`);
    }
    await page.waitForTimeout(1500);
    const cruda = (await page.evaluate(LEER_PAGINA)) as CapturaCruda;
    const marca = resumirMarca(cruda);

    let logo: LogoWeb | null = null;
    for (const l of [...cruda.logos].sort((a, b) => b.puntaje - a.puntaje).slice(0, 4)) {
      if (l.svg) {
        logo = { datos: Buffer.from(l.svg, "utf8"), nombre: "logo.svg" };
        break;
      }
      if (!l.src || !/^https?:/i.test(l.src)) continue;
      try {
        const r = await page.request.get(l.src, { timeout: 15_000 });
        const tipo = (r.headers()["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        const ext = EXT_POR_TIPO[tipo];
        if (!r.ok() || !ext) continue;
        const datos = await r.body();
        if (!datos.length || datos.length > MAX_LOGO) continue;
        logo = { datos, nombre: `logo${ext}` };
        break;
      } catch {
        /* se prueba el siguiente */
      }
    }
    return { marca, logo, url: page.url() };
  } finally {
    cerrar();
  }
}
