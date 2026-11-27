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
 * Es el único lector de marca de Geeper: lo usan el editor de plantillas, «Nueva plantilla» y Anuncios
 * (que lo muestra como observado / inferido con `aPerfilMarca`). Sólo lee páginas públicas: la dirección
 * pasa por `asegurarPublica` y cada pedido del navegador (también los saltos de redirección) se trae desde
 * aquí con la misma comprobación, así una página no puede llevarlo a localhost ni a la red de la casa. Si
 * no hay navegador (la app de escritorio no siempre lo trae), cae al lector simple de Anuncios
 * (`leerMarca`: HTML y CSS con expresiones regulares, sin logo).
 *
 * La parte pura (`resumirMarca`, `fuenteGoogle`, `normalizarUrl`, `desdePerfil`, `aPerfilMarca`) se
 * prueba sin navegador.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asegurarPublica, leerMarca, type Conteo, type PerfilMarca } from "./anuncios/marca";
import { aHex, leerColor, proponerRoles, type ColorPaleta, type Roles } from "./colores-marca";
import { guardarImagenSubida } from "./imagen-subida";
import { CACHE_HF, dirDatos } from "./rutas";

/** Lo que devuelve la página, sin interpretar. */
export interface CapturaCruda {
  nombre: string;
  colores: { color: string; puntaje: number }[];
  fuentes: { titulos: string; texto: string };
  logos: { src?: string; svg?: string; puntaje: number }[];
  titulo?: string;
  descripcion?: string;
  h1?: string;
  /** Textos de los botones con relleno, en el orden en que aparecen. */
  botones?: string[];
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
  // «mitienda.com:8080» no trae esquema; «javascript:», «file:///» sí (y se rechazan abajo).
  const conEsquema = /^[a-z][a-z0-9+.-]*:(\/\/|(?!\d))/i.test(t) ? t : `https://${t}`;
  let u: URL;
  try {
    u = new URL(conEsquema);
  } catch {
    throw new Error("Ese link no parece una página web. Ejemplo: mitienda.com");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Sólo se pueden leer páginas web (links que empiezan con http o https)");
  if (u.hostname === "localhost" || u.hostname.endsWith(".localhost")) throw new Error("Sólo se pueden leer páginas publicadas en internet");
  if (!u.hostname.includes(".")) throw new Error("Ese link no parece una página web. Ejemplo: mitienda.com");
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
  const corto = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const botones = [];
  for (const el of Array.from(document.querySelectorAll('button, a, [role="button"]'))) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const t = corto(el.textContent);
    if (r.width < 40 || r.height < 20 || t.length < 3 || t.length > 30) continue;
    if (s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent') continue;
    botones.push(t);
    if (botones.length >= 12) break;
  }
  return {
    nombre, colores, logos, botones,
    fuentes: { titulos: pila('h1, h2, [class*="hero" i] [class*="title" i]'), texto: pila('p, body') },
    titulo: corto(document.title).slice(0, 120),
    descripcion: corto(meta('description')).slice(0, 200),
    h1: corto(document.querySelector('h1')?.textContent).slice(0, 160),
  };
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

/** Todo lo que se sacó de la página. */
export interface LecturaWeb {
  url: string;
  fecha: string;
  /** «navegador»: la página abierta de verdad; «simple»: sólo su HTML y CSS (sin logo). */
  motor: "navegador" | "simple";
  marca: MarcaWeb;
  /** El texto del botón principal de la página, para el botón del cierre. */
  cta: string | null;
  titulo: string;
  descripcion: string;
  h1: string;
  botones: string[];
  avisos: string[];
}

/** Verbos de una llamada a la acción; un botón que no suena a eso («Buscar», «Menú», el nombre de la marca) no sirve para el cierre. */
const ACCION = /\b(compr\p{L}*|pid\p{L}*|reserv\p{L}*|descarg\p{L}*|empie\p{L}*|comienz\p{L}*|prueb\p{L}*|reg[ií]str\p{L}*|suscr[ií]b\p{L}*|[úu]nete|cont[aá]ct\p{L}*|obt[eé]n\p{L}*|agend\p{L}*|cotiz\p{L}*|buy|shop|order|download|start|try|sign up|get|join|book|subscribe|contact)\b/iu;

/** El botón de la página que mejor sirve para el cierre del video, o null. */
export function ctaDe(botones: string[]): string | null {
  return botones.find((b) => b.length <= 24 && ACCION.test(b)) ?? null;
}

/** Lectura desde el lector simple de Anuncios (sin navegador). */
export function desdePerfil(p: PerfilMarca): LecturaWeb {
  const o = p.observado;
  const fuente = p.inferido.fuente ?? o.fuentes[0]?.valor ?? "";
  const marca = resumirMarca({
    nombre: p.inferido.marca,
    colores: [...(o.themeColor ? [{ color: o.themeColor, puntaje: 60 }] : []), ...o.colores.map((c) => ({ color: c.valor, puntaje: c.veces * 10 }))],
    fuentes: { titulos: fuente, texto: fuente },
    logos: [],
  });
  return {
    url: p.url, fecha: p.fecha, motor: "simple", marca, cta: p.inferido.cta,
    titulo: o.titulo, descripcion: o.descripcion, h1: o.h1, botones: o.botones.map((b) => b.valor),
    avisos: ["Leímos la página en modo simple (esta instalación no trae el navegador interno): no se pudo traer el logo y los colores pueden ser menos exactos.", ...p.avisos.filter((a) => !a.startsWith("Las fuentes"))],
  };
}

/** Para Anuncios, que muestra lo observado aparte de lo inferido. */
export function aPerfilMarca(l: LecturaWeb): PerfilMarca {
  const m = l.marca;
  const fuentes: Conteo[] = [...new Set([m.tipografia.titulos.original, m.tipografia.texto.original])].map((valor) => ({ valor, veces: 1 }));
  const botones: Conteo[] = [...new Set(l.botones)].slice(0, 6).map((valor) => ({ valor, veces: l.botones.filter((b) => b === valor).length }));
  return {
    url: l.url,
    fecha: l.fecha,
    observado: {
      titulo: l.titulo, descripcion: l.descripcion, sitio: m.nombre, h1: l.h1, themeColor: "",
      colores: m.colores.map((c) => ({ valor: c.hex, veces: Math.max(1, Math.round(c.parte * 100)) })),
      fuentes, botones,
    },
    inferido: { marca: m.nombre, acento1: m.roles.acento1 ?? null, acento2: m.roles.acento2 ?? null, activa: m.roles.activa ?? null, fuente: m.tipografia.titulos.fuente, cta: l.cta },
    avisos: l.avisos,
  };
}

class SinNavegador extends Error {}

/** ¿Se puede pedir esta dirección? (con caché por host para no consultar el DNS en cada imagen). */
function guardia() {
  const cache = new Map<string, Promise<boolean>>();
  return (url: string): Promise<boolean> => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return Promise.resolve(false);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return Promise.resolve(false);
    const clave = `${u.protocol}//${u.host}`;
    if (!cache.has(clave)) cache.set(clave, asegurarPublica(u).then(() => true, () => false));
    return cache.get(clave)!;
  };
}

async function conNavegador(destino: string, signal?: AbortSignal): Promise<{ lectura: LecturaWeb; logo: LogoWeb | null }> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new SinNavegador();
  }
  let nav: import("playwright-core").Browser;
  try {
    nav = await pw.chromium.launch({ executablePath: chrome() });
  } catch {
    throw new SinNavegador();
  }
  const cerrar = () => void nav.close().catch(() => {});
  signal?.addEventListener("abort", cerrar, { once: true });
  const publica = guardia();
  try {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-MX", colorScheme: "light", serviceWorkers: "block" });
    // Cada pedido lo hace este proceso, sin seguir redirecciones: el salto vuelve al navegador, que lo
    // pide de nuevo y pasa otra vez por aquí. Videos, audio y letras no hacen falta para leer la marca.
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      if (["media", "font", "websocket", "eventsource"].includes(req.resourceType())) return route.abort();
      if (req.url().startsWith("data:") || req.url().startsWith("blob:")) return route.continue();
      if (!(await publica(req.url()))) return route.abort("blockedbyclient");
      try {
        return await route.fulfill({ response: await route.fetch({ maxRedirects: 0, timeout: 20_000 }) });
      } catch {
        return route.abort().catch(() => {});
      }
    });
    const page = await ctx.newPage();
    try {
      await page.goto(destino, { waitUntil: "load", timeout: 45_000 });
    } catch (e) {
      throw new Error(`No se pudo abrir ${destino}: revisa que el link esté bien escrito y que la página abra en tu navegador (${e instanceof Error ? e.message.split("\n")[0] : e}).`);
    }
    await page.waitForTimeout(1500);
    const cruda = (await page.evaluate(LEER_PAGINA)) as CapturaCruda;
    const marca = resumirMarca(cruda);
    const botones = cruda.botones ?? [];

    let logo: LogoWeb | null = null;
    for (const l of [...cruda.logos].sort((a, b) => b.puntaje - a.puntaje).slice(0, 4)) {
      if (l.svg) {
        logo = { datos: Buffer.from(l.svg, "utf8"), nombre: "logo.svg" };
        break;
      }
      if (!l.src || !(await publica(l.src))) continue;
      try {
        const r = await page.request.get(l.src, { timeout: 15_000, maxRedirects: 0 });
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
    const lectura: LecturaWeb = {
      url: page.url(), fecha: new Date().toISOString().slice(0, 10), motor: "navegador", marca,
      cta: ctaDe(botones),
      titulo: cruda.titulo ?? "", descripcion: cruda.descripcion ?? "", h1: cruda.h1 ?? "", botones, avisos: [],
    };
    return { lectura, logo };
  } finally {
    cerrar();
  }
}

/** Lee la marca de una página pública: con el navegador interno si está; si no, en modo simple. */
export async function leerMarcaWeb(url: string, op: { signal?: AbortSignal } = {}): Promise<{ lectura: LecturaWeb; logo: LogoWeb | null }> {
  const destino = normalizarUrl(url);
  await asegurarPublica(new URL(destino)).catch(() => {
    throw new Error("Sólo se pueden leer páginas publicadas en internet (no direcciones de tu casa o tu red).");
  });
  try {
    return await conNavegador(destino, op.signal);
  } catch (e) {
    if (!(e instanceof SinNavegador)) throw e;
    return { lectura: desdePerfil(await leerMarca(destino)), logo: null };
  }
}

/**
 * Lee la marca y guarda el logo en ~/geeper-data/marcas-web/ (validado como uno subido a mano: los SVG
 * pasan por `revisarSvg`). Lo usan las rutas de la API; no cambia ninguna plantilla.
 */
export async function leerYGuardarMarca(url: string, signal?: AbortSignal): Promise<{ lectura: LecturaWeb; logo: { logo: string; ruta: string } | null }> {
  const { lectura, logo } = await leerMarcaWeb(url, { signal });
  let guardado: { logo: string; ruta: string } | null = null;
  if (logo) {
    try {
      const { abs } = await guardarImagenSubida(new File([new Uint8Array(logo.datos)], logo.nombre), path.join(dirDatos(), "marcas-web"), "logo");
      guardado = { logo: abs, ruta: path.relative(dirDatos(), abs) };
    } catch {
      lectura.avisos.push("Encontramos un logo, pero no se puede usar tal cual. Súbelo a mano si lo tienes.");
    }
  } else if (lectura.motor === "navegador") {
    lectura.avisos.push("No encontramos el logo en la página. Si lo tienes, súbelo a mano.");
  }
  return { lectura, logo: guardado };
}

/** Ruta de un logo que dejó `leerYGuardarMarca`; cualquier otra cosa (otra carpeta, `..`) se rechaza. */
export function logoDeMarcaWeb(ruta: string): string {
  const carpeta = path.join(dirDatos(), "marcas-web");
  const abs = path.resolve(dirDatos(), ruta);
  if (path.relative(carpeta, abs).startsWith("..") || path.dirname(abs) !== carpeta || !fs.existsSync(abs)) throw new Error("Ese logo no es uno leído de una página");
  return abs;
}
