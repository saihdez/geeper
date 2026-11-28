/**
 * Media: las apps Craft de storytold (github.com/storytold) con su interfaz original, en su versión
 * web oficial (WebAssembly + WebGPU, sin servidor). Cada una se instala bajo pedido desde su release
 * fijada, verificada con SHA256, en ~/dev/video-tools/<app>-web/<versión>, y Geeper la sirve en
 * /craft/<app>/ para abrirla a pantalla completa. Nada de la app se modifica (sólo se corrige un
 * detalle de empaquetado, ver `prepararWeb`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { apuntar, crearInstalador } from "./instalar-craft";
import { compararVersiones } from "./novedades";
import { ESTUDIO } from "./rutas";

export type GrupoCraft = "Imagen y diseño" | "Video y sonido" | "Documentos" | "3D y técnico";

export interface AppCraft {
  /** Repo en github.com/storytold y carpeta de instalación. */
  app: string;
  nombre: string;
  version: string;
  grupo: GrupoCraft;
  /** Qué es, en palabras simples. */
  que: string;
  /** A qué programa conocido se parece. */
  comoA: string;
  /** Para qué sirve dentro de Geeper. */
  paraGeeper?: string;
  /** Sin versión web: sólo se ofrece el instalador de escritorio. */
  soloEscritorio?: boolean;
}

export const APPS_CRAFT: AppCraft[] = [
  { app: "photocraft", nombre: "PhotoCraft", version: "0.23.1", grupo: "Imagen y diseño", que: "Editor de fotos con capas, máscaras, filtros y archivos PSD.", comoA: "Photoshop", paraGeeper: "Retocar portadas y diseños .psd con capas @titulo/@imagen/@marca." },
  { app: "lightcraft", nombre: "LightCraft", version: "0.21.1", grupo: "Imagen y diseño", que: "Revelado de fotos sin dañar el original: luz, color, recortes.", comoA: "Lightroom", paraGeeper: "Ajustar el color de fotos antes de usarlas en un video." },
  { app: "vectorcraft", nombre: "VectorCraft", version: "0.24.1", grupo: "Imagen y diseño", que: "Dibujo vectorial: logos, íconos, ilustraciones; abre .ai, .pdf y .eps.", comoA: "Illustrator", paraGeeper: "Preparar logos nítidos (SVG) para superposiciones y plantillas." },
  { app: "designcraft", nombre: "DesignCraft", version: "0.20.1", grupo: "Imagen y diseño", que: "Maquetación de páginas: revistas, folletos, afiches.", comoA: "InDesign" },
  { app: "figcraft", nombre: "FigCraft", version: "0.18.1", grupo: "Imagen y diseño", que: "Diseño de interfaces y prototipos.", comoA: "Figma" },
  { app: "filmcraft", nombre: "FilmCraft", version: "0.20.1", grupo: "Video y sonido", que: "Editor de video no lineal con línea de tiempo.", comoA: "Premiere o DaVinci Resolve", paraGeeper: "Terminar un video a mano: «Abrir en FilmCraft» en la página del proyecto lo abre ya cargado." },
  { app: "effectcraft", nombre: "EffectCraft", version: "0.24.1", grupo: "Video y sonido", que: "Gráficos en movimiento y composición por capas.", comoA: "After Effects", paraGeeper: "Las transiciones y efectos de Geeper salen de sus fórmulas." },
  { app: "soundcraft", nombre: "SoundCraft", version: "0.20.1", grupo: "Video y sonido", que: "Estudio de audio multipista: grabar, cortar, mezclar.", comoA: "Audition o Reaper" },
  { app: "anicraft", nombre: "AniCraft", version: "0.2.1", grupo: "Video y sonido", que: "Animación 2D cuadro a cuadro.", comoA: "Animate", soloEscritorio: true },
  { app: "deckcraft", nombre: "DeckCraft", version: "0.18.1", grupo: "Documentos", que: "Presentaciones y diapositivas.", comoA: "PowerPoint o Keynote" },
  { app: "pdfcraft", nombre: "PdfCraft", version: "0.21.1", grupo: "Documentos", que: "Leer, anotar y editar PDF.", comoA: "Acrobat" },
  { app: "wordcraft", nombre: "WordCraft", version: "0.18.1", grupo: "Documentos", que: "Procesador de textos.", comoA: "Word" },
  { app: "gridcraft", nombre: "GridCraft", version: "0.19.1", grupo: "Documentos", que: "Hoja de cálculo.", comoA: "Excel" },
  { app: "cadcraft", nombre: "CADCraft", version: "0.20.1", grupo: "3D y técnico", que: "Dibujo técnico y CAD.", comoA: "AutoCAD" },
  { app: "materialcraft", nombre: "MaterialCraft", version: "0.4.1", grupo: "3D y técnico", que: "Materiales 3D con nodos.", comoA: "Substance Designer" },
  { app: "texturecraft", nombre: "TextureCraft", version: "0.6.1", grupo: "3D y técnico", que: "Pintar texturas sobre modelos 3D.", comoA: "Substance Painter" },
  {
    app: "craft-anything",
    nombre: "Craft Anything",
    version: "0.6.1",
    grupo: "3D y técnico",
    que: "Mira cómo está hecho un sitio web, una app o un juego y arma tu propia versión con ayuda de la IA. Para construir necesita Claude Code instalado y con tu sesión iniciada.",
    comoA: "un taller de sitios y apps",
    paraGeeper: "Arma una página para tu producto y muéstrala con «Nuevo → Desde una página web».",
    soloEscritorio: true,
  },
];

export const appCraft = (app: string) => APPS_CRAFT.find((a) => a.app === app && !a.soloEscritorio) ?? null;

/** Carpeta del sitio web instalado (enlace `actual`). */
export const dirWeb = (app: string) => path.join(ESTUDIO, `${app}-web`, "actual");

export const paginaRelease = (a: AppCraft) => `https://github.com/storytold/${a.app}/releases/tag/v${a.version}`;

/** Versión web instalada (la de la carpeta a la que apunta `actual`) o null. */
export async function versionWeb(app: string): Promise<string | null> {
  try {
    const destino = await fs.readlink(dirWeb(app));
    await fs.access(path.join(dirWeb(app), "index.html"));
    return /-web-([\d.]+)$/.exec(destino)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * El zip web trae `snippets/` en la raíz, pero el JS de la app (en `app/`) los importa como
 * `./snippets/…` y el navegador los pide en `app/snippets/…` (404 y la app no arranca). Se copian
 * ahí sin tocar nada más.
 */
export async function prepararWeb(dir: string): Promise<void> {
  const raiz = path.join(dir, "snippets");
  const enApp = path.join(dir, "app", "snippets");
  const existe = (p: string) => fs.access(p).then(() => true, () => false);
  if ((await existe(raiz)) && (await existe(path.join(dir, "app"))) && !(await existe(enApp))) {
    await fs.cp(raiz, enApp, { recursive: true });
  }
}

type Instalador = ReturnType<typeof crearInstalador>;
const g = globalThis as unknown as { __instaladoresWeb?: Map<string, Instalador> };
const instaladores = (g.__instaladoresWeb ??= new Map());

const VERSION = /^\d+\.\d+\.\d+$/;

/** Instalador de la versión web `version` (por defecto, la del catálogo). Uno por app y versión. */
export function instaladorWeb(a: AppCraft, version = a.version): Instalador {
  if (!VERSION.test(version)) throw new Error("Versión inválida");
  const clave = `${a.app}@${version}`;
  let i = instaladores.get(clave);
  if (!i) {
    i = crearInstalador({
      app: a.app,
      version,
      archivo: `${a.app}-web-${version}.zip`,
      carpeta: `${a.app}-web`,
      extraer: "zip",
      raiz: `${a.app}-web-${version}`,
      preparar: prepararWeb,
      verificar: async () => {
        const v = await versionWeb(a.app);
        return v ? `${a.nombre} ${v}` : null;
      },
    });
    instaladores.set(clave, i);
  }
  return i;
}

/** La instalación en curso (o la última) de cualquier versión de la app. */
export function instalacionWeb(a: AppCraft) {
  const propias = [...instaladores.entries()].filter(([k]) => k.startsWith(`${a.app}@`)).map(([, i]) => i.estado());
  return propias.find((e) => ["descargando", "verificando", "descomprimiendo"].includes(e.fase)) ?? propias.find((e) => e.fase === "error") ?? propias.at(-1) ?? null;
}

/** Versiones web que quedaron en disco (la actual y las anteriores, para volver atrás), de la más nueva a la más vieja. */
export async function versionesWeb(app: string): Promise<string[]> {
  const base = path.join(ESTUDIO, `${app}-web`);
  const nombres = await fs.readdir(base).catch(() => [] as string[]);
  const listas: string[] = [];
  for (const v of nombres.filter((n) => VERSION.test(n))) {
    if (await fs.access(path.join(base, v, `${app}-web-${v}`, "index.html")).then(() => true, () => false)) listas.push(v);
  }
  return listas.sort((x, y) => compararVersiones(y, x));
}

/** Vuelve a una versión web ya instalada (sin descargar nada). */
export async function usarVersionWeb(app: string, version: string): Promise<void> {
  if (!(await versionesWeb(app)).includes(version)) throw new Error(`La versión ${version} no está instalada`);
  const base = path.join(ESTUDIO, `${app}-web`);
  await apuntar(base, path.join(base, "actual"), path.join(base, version, `${app}-web-${version}`));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
};

/** Tipo de contenido de un archivo del sitio. Las partes (`.part-aa`) ya vienen en gzip: van tal cual. */
export const tipoDe = (ruta: string) => MIME[path.extname(ruta).toLowerCase()] ?? "application/octet-stream";

/** Archivos que conservan su nombre entre versiones: hay que revalidarlos. El resto lleva hash. */
export const sinCache = (ruta: string) => /(^|\/)(index\.html|parts\.txt|[a-z-]+-web\.js|manifest\.txt)$/.test(ruta) || !/[0-9a-f]{12,}/.test(ruta);

/**
 * Ruta absoluta de un archivo del sitio de `app`, o null si sale de su carpeta (`..`, rutas
 * absolutas o enlaces que apuntan fuera).
 */
export async function archivoWeb(app: string, partes: string[]): Promise<string | null> {
  if (partes.some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return null;
  let raiz: string;
  try {
    raiz = await fs.realpath(dirWeb(app));
  } catch {
    return null;
  }
  try {
    const abs = await fs.realpath(path.join(raiz, ...partes));
    if (abs !== raiz && !abs.startsWith(raiz + path.sep)) return null;
    const st = await fs.stat(abs);
    return st.isFile() ? abs : null;
  } catch {
    return null;
  }
}
