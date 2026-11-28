/**
 * Disco de las invitaciones: `<GEEPER_DATA>/invitaciones/<slug>/` con `invitacion.json`, `foto.webp`,
 * `musica.mp3` y `publicar/` (lo que se sube: index.html, invitacion.ics, portada-og.jpg, qr.svg y el zip).
 * Nada de esto usa la GPU: ffmpeg en CPU para la foto y el audio, Chrome headless para la portada.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { renderSVG } from "uqr";
import { escribirAtomico } from "../archivos";
import { correr } from "../proceso";
import { CACHE_HF, dirDatos, FFMPEG } from "../rutas";
import { TIPOS_INFO } from "./catalogo";
import { estiloDe } from "./estilo";
import { asegurarContraste, Tema } from "./tema";
import { basesDe, compilar, esc, iniciales, retoquesVigentes, titulos } from "./compilar";
import { instanteUTC, textosFecha } from "./calendario";
import { leerEnlaceMusica, resolverEnlaceMusica } from "./enlaces";
import { Entrada, fechaPasada, Invitacion, normalizarUrlPublica, Retoques, Seccion, SLUG, type EstiloId } from "./esquema";
import { z } from "zod";
import { copiarElegida, pngQrBase } from "./imagenes";
import { cambiosDesdeAvnac, disenoAvnac, leerDisenoAvnac, nombreArchivoAvnac } from "./avnac";
import { abrirAvnac } from "../avnac";
import { SISTEMA } from "../plataforma";
import { spawn } from "node:child_process";

export const ARCHIVOS_PUBLICOS = ["index.html", "invitacion.ics", "portada-og.jpg", "qr.svg", "qr.png", "invitacion.zip"] as const;
export const EXT_FOTO = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".avif"]);
export const EXT_AUDIO = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"]);
const MAX_FOTO = 25 * 1024 ** 2;
const MAX_AUDIO = 40 * 1024 ** 2;
/** Límites de peso de la página (docs/INVITACIONES.md §3). */
export const PESO_MAX = { sinAudio: 1.5 * 1024 ** 2, conAudio: 5 * 1024 ** 2 };

export const dirInvitaciones = () => path.join(dirDatos(), "invitaciones");
export function dirInvitacion(slug: string): string {
  if (!SLUG.test(slug)) throw new Error("Invitación no encontrada");
  return path.join(dirInvitaciones(), slug);
}

export function slugNuevo(tipo: string, nombres: string): string {
  const base = `${tipo}-${nombres}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return `${base || "invitacion"}-${randomBytes(3).toString("hex")}`;
}

export async function leerInvitacion(slug: string): Promise<Invitacion> {
  const crudo = await fs.readFile(path.join(dirInvitacion(slug), "invitacion.json"), "utf8").catch(() => {
    throw new Error("Invitación no encontrada");
  });
  return Invitacion.parse(JSON.parse(crudo));
}

export interface ResumenInvitacion {
  slug: string;
  nombres: string;
  tipo: string;
  fecha: string;
  plantilla: EstiloId;
  /** Para la miniatura de la lista. */
  colores: { fondo: string; sello: string };
  tema?: string;
  publicada: boolean;
  actualizada: string;
}

export async function listarInvitaciones(): Promise<ResumenInvitacion[]> {
  const nombres = await fs.readdir(dirInvitaciones()).catch(() => [] as string[]);
  const out: ResumenInvitacion[] = [];
  for (const n of nombres) {
    if (!SLUG.test(n)) continue;
    try {
      const i = await leerInvitacion(n);
      out.push({ slug: i.slug, nombres: i.nombres, tipo: TIPOS_INFO[i.tipo].nombre, fecha: i.fecha, plantilla: i.plantilla, colores: { fondo: estiloDe(i).colores.fondo, sello: estiloDe(i).colores.sello }, tema: i.plantilla === "tema" ? i.tema?.nombre : undefined, publicada: !!i.urlPublica, actualizada: i.actualizada });
    } catch {
      /* carpeta a medias o de otra versión: se ignora */
    }
  }
  return out.sort((a, b) => b.actualizada.localeCompare(a.actualizada));
}

export async function borrarInvitacion(slug: string): Promise<void> {
  await fs.rm(dirInvitacion(slug), { recursive: true, force: true });
}

// ── Letras ───────────────────────────────────────────────────────────────────────────────────────

/** Chrome reciente: Google Fonts sólo manda woff2 a navegadores que lo entienden. */
const UA_WOFF2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** Bloques `@font-face` del subconjunto latino (cubre á, é, ñ, ¿, ¡) de una hoja de Google Fonts. */
export function bloquesLatinos(cssGoogle: string): { css: string; url: string }[] {
  const out: { css: string; url: string }[] = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g;
  for (let m = re.exec(cssGoogle); m; m = re.exec(cssGoogle)) {
    if (m[1] !== "latin") continue;
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(m[2]!)?.[1];
    if (url) out.push({ css: m[2]!, url });
  }
  return out;
}

/** Hoja de Google Fonts de una familia; si no tiene esos pesos o cursivas, se pide más sencilla. */
async function hojaGoogle(familia: string, variantes: string[], signal: AbortSignal): Promise<string> {
  for (const v of variantes) {
    const url = `https://fonts.googleapis.com/css2?family=${familia.replace(/ /g, "+")}${v}&display=swap`;
    const r = await fetch(url, { headers: { "user-agent": UA_WOFF2 }, signal });
    if (r.ok) return r.text();
  }
  throw new Error(`sin la letra ${familia}`);
}

/** `@font-face` de una familia con sus woff2 en base64, guardado en caché por familia. */
async function fuenteFamilia(familia: string, variantes: string[], signal: AbortSignal): Promise<string> {
  const cache = path.join(dirDatos(), "_cache", "fuentes-invitaciones", `${familia.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.css`);
  const guardada = await fs.readFile(cache, "utf8").catch(() => null);
  if (guardada) return guardada;
  const bloques = bloquesLatinos(await hojaGoogle(familia, variantes, signal));
  if (!bloques.length) throw new Error("sin letras");
  let css = "";
  for (const b of bloques) {
    const r = await fetch(b.url, { signal });
    if (!r.ok) throw new Error(`letra ${r.status}`);
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    css += b.css.replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${b64}) format('woff2');`);
  }
  await escribirAtomico(cache, css);
  return css;
}

/** Las dos letras del estilo en base64. "" si no hay internet (quedan las del sistema, con aviso). */
export async function fuentesDe(letras: { titulos: string; texto: string }, op: { signal?: AbortSignal } = {}): Promise<{ css: string; aviso?: string }> {
  if (process.env.VITEST && !process.env.GEEPER_INVITACIONES_FUENTES) return { css: "" };
  const signal = op.signal ?? AbortSignal.timeout(30_000);
  try {
    const titulos = await fuenteFamilia(letras.titulos, [""], signal);
    const texto = letras.texto === letras.titulos ? "" : await fuenteFamilia(letras.texto, [":ital,wght@0,400;0,600;1,400", ":wght@400;600", ""], signal);
    return { css: titulos + texto };
  } catch {
    return { css: "", aviso: "No se pudieron bajar las letras del estilo (¿sin internet?): se usaron las del sistema. Vuelve a guardar con internet para tenerlas." };
  }
}

// ── Foto y música ────────────────────────────────────────────────────────────────────────────────

async function guardarSubida(archivo: File, permitidas: Set<string>, max: number, que: string): Promise<string> {
  const ext = path.extname(archivo.name).toLowerCase();
  if (!permitidas.has(ext)) throw new Error(`Formato de ${que} no admitido (${ext || "sin extensión"}).`);
  if (!archivo.size) throw new Error(`El archivo de ${que} está vacío.`);
  if (archivo.size > max) throw new Error(`El archivo de ${que} pasa de ${Math.round(max / 1024 ** 2)} MB.`);
  const tmp = path.join(os.tmpdir(), `geeper-inv-${randomBytes(6).toString("hex")}${ext}`);
  await fs.writeFile(tmp, Buffer.from(await archivo.arrayBuffer()));
  return tmp;
}

/** Foto de portada: hasta 1080 px de ancho, WebP. */
export async function procesarFoto(archivo: File, destino: string): Promise<void> {
  const tmp = await guardarSubida(archivo, EXT_FOTO, MAX_FOTO, "foto");
  try {
    const r = await correr(FFMPEG, ["-y", "-v", "error", "-i", tmp, "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", "-c:v", "libwebp", "-quality", "80", destino], { timeout: 60_000, permitirFallo: true });
    if (r.codigo !== 0) throw new Error("No se pudo leer la foto. Prueba con un JPG o PNG.");
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Canción propia: 90 s desde `inicio`, mp3 96 kbps con fundido de entrada y salida. */
export async function procesarAudio(archivo: File, destino: string, inicio = 0): Promise<void> {
  const tmp = await guardarSubida(archivo, EXT_AUDIO, MAX_AUDIO, "audio");
  try {
    const r = await correr(FFMPEG, ["-y", "-v", "error", "-ss", String(Math.max(0, inicio)), "-i", tmp, "-vn", "-t", "90", "-af", "afade=t=in:d=1.5,afade=t=out:st=87:d=3", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", destino], { timeout: 120_000, permitirFallo: true });
    if (r.codigo !== 0) throw new Error("No se pudo leer el audio. Prueba con un MP3.");
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

// ── Guardar y construir ──────────────────────────────────────────────────────────────────────────

export interface Subidas {
  foto?: File | null;
  audio?: File | null;
  audioInicio?: number;
  quitarFoto?: boolean;
  quitarAudio?: boolean;
  permisoAudio?: boolean;
}

/** Crea (sin `slug`) o actualiza una invitación y la vuelve a construir. */
export async function guardarInvitacion(entrada: unknown, subidas: Subidas, slug?: string, extra: { formulario?: string } = {}): Promise<{ inv: Invitacion; avisos: string[] }> {
  const e = Entrada.parse(entrada);
  const previa = slug ? await leerInvitacion(slug) : null;
  if (!previa && fechaPasada(e.fecha, e.zona)) throw new Error("La fecha del evento ya pasó.");
  const id = previa?.slug ?? slugNuevo(e.tipo, e.nombres);
  const dir = dirInvitacion(id);
  await fs.mkdir(dir, { recursive: true });

  let musica: Invitacion["musica"] = previa?.musica.tipo === "archivo" && !subidas.quitarAudio ? previa.musica : { tipo: "ninguna" };
  if (subidas.audio) {
    if (!subidas.permisoAudio) throw new Error("Marca que tienes permiso para usar ese audio (música propia, libre o con licencia).");
    await procesarAudio(subidas.audio, path.join(dir, "musica.mp3"), subidas.audioInicio);
    musica = { tipo: "archivo", archivo: "musica.mp3" };
  } else if (e.musicaEnlace && musica.tipo !== "archivo") {
    const m = await resolverEnlaceMusica(e.musicaEnlace);
    if (!m) throw new Error("No reconozco ese enlace de música. Pega el enlace de una canción de Spotify (Compartir → Copiar enlace) o de un video de YouTube.");
    musica = m;
  }
  if (musica.tipo !== "archivo") await fs.rm(path.join(dir, "musica.mp3"), { force: true });

  let foto = previa?.foto && !subidas.quitarFoto ? previa.foto : undefined;
  if (subidas.foto) {
    await procesarFoto(subidas.foto, path.join(dir, "foto.webp"));
    foto = "foto.webp";
  }
  if (!foto) await fs.rm(path.join(dir, "foto.webp"), { force: true });

  const ahora = new Date().toISOString();
  const { plantilla, musicaEnlace, tema, ...resto } = e;
  if (plantilla === "tema" && !tema) throw new Error("Falta diseñar el tema: escribe tu idea y toca «Diseñar mi tema», o elige uno de los estilos.");
  const armada = Invitacion.parse({
    ...resto,
    version: 1,
    slug: id,
    creada: previa?.creada ?? ahora,
    actualizada: ahora,
    plantilla: plantilla ?? TIPOS_INFO[e.tipo].plantilla,
    tema: plantilla === "tema" && tema ? { ...tema, colores: asegurarContraste(tema.colores) } : undefined,
    musica,
    musicaEnlace: musica.tipo === "spotify" || musica.tipo === "youtube" ? musicaEnlace : undefined,
    foto,
    urlPublica: previa?.urlPublica,
    qrArte: previa?.qrArte,
    retoques: previa?.retoques,
    ocultas: previa?.ocultas,
    formulario: extra.formulario ?? previa?.formulario,
  });
  // Los textos corregidos a mano siguen, salvo los de un dato que acaba de cambiar.
  const { vigentes, viejos } = retoquesVigentes(armada);
  const inv = Invitacion.parse({ ...armada, retoques: Object.keys(vigentes).length ? vigentes : undefined });
  await escribirAtomico(path.join(dir, "invitacion.json"), JSON.stringify(inv, null, 2));
  const avisos = await construir(inv);
  if (viejos.length) avisos.unshift(`Cambiaste datos que habías corregido a mano (${viejos.length === 1 ? "1 texto" : `${viejos.length} textos`}): ahí quedó el texto nuevo. Si quieres, vuelve a «Corregir a mano».`);
  return { inv, avisos };
}

/** Datos de ejemplo para la vista previa mientras el formulario está a medio llenar. */
function borradorConDefectos(entrada: unknown): Record<string, unknown> {
  const d = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const lleno = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null);
  const dentroDe30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const lugar = (d.lugar && typeof d.lugar === "object" ? d.lugar : {}) as Record<string, unknown>;
  return {
    ...Object.fromEntries(Object.entries(d).filter(([, v]) => lleno(v))),
    tipo: lleno(d.tipo) ? d.tipo : "boda",
    nombres: lleno(d.nombres) ? d.nombres : "Tus nombres",
    fecha: lleno(d.fecha) ? d.fecha : dentroDe30,
    hora: lleno(d.hora) ? d.hora : "18:00",
    zona: lleno(d.zona) ? d.zona : "America/Mexico_City",
    lugar: { ...lugar, nombre: lleno(lugar.nombre) ? lugar.nombre : "Tu lugar", mapa: lleno(lugar.mapa) ? lugar.mapa : undefined },
    whatsapp: typeof d.whatsapp === "string" && d.whatsapp.replace(/\D/g, "").length >= 8 ? d.whatsapp : "520000000000",
  };
}

/** HTML de la invitación tal como va, sin guardar nada (sin foto ni audio propio). */
export async function vistaPrevia(entrada: unknown): Promise<string> {
  const e = Entrada.parse(borradorConDefectos(entrada));
  const { plantilla, musicaEnlace, tema, ...resto } = e;
  const musica = (musicaEnlace && leerEnlaceMusica(musicaEnlace)) || { tipo: "ninguna" as const };
  const usaTema = plantilla === "tema" && !!tema;
  const inv = Invitacion.parse({
    ...resto, version: 1, slug: "vista-previa", creada: "", actualizada: "",
    plantilla: usaTema ? "tema" : plantilla && plantilla !== "tema" ? plantilla : TIPOS_INFO[e.tipo].plantilla,
    tema: usaTema ? { ...tema, colores: asegurarContraste(tema.colores) } : undefined,
    musica,
  });
  const fuentes = await fuentesDe(estiloDe(inv).letras);
  return compilar(inv, { fuentesCss: fuentes.css }).html;
}

/** Guarda la dirección donde quedó publicada y reconstruye (QR y vista previa con la URL absoluta). */
export async function ponerUrlPublica(slug: string, url: string | null): Promise<{ inv: Invitacion; avisos: string[] }> {
  const previa = await leerInvitacion(slug);
  const limpia = url ? normalizarUrlPublica(url) : undefined;
  const avisos: string[] = [];
  if (url && limpia !== url.trim()) avisos.push(`Corregí la dirección: la que pegaste era la del panel de Netlify. Tu invitación está en ${limpia}`);
  // Un QR con dibujo lleva la dirección vieja adentro: con otra dirección ya no sirve.
  const qrArte = previa.qrArte && previa.qrArte.url === limpia ? previa.qrArte : undefined;
  if (previa.qrArte && !qrArte) {
    await fs.rm(path.join(dirInvitacion(slug), "qr-arte.png"), { force: true });
    avisos.push("Cambió la dirección: el QR con dibujo llevaba la anterior. Crea uno nuevo.");
  }
  const inv = Invitacion.parse({ ...previa, urlPublica: limpia, qrArte, actualizada: new Date().toISOString() });
  await escribirAtomico(path.join(dirInvitacion(slug), "invitacion.json"), JSON.stringify(inv, null, 2));
  return { inv, avisos: [...avisos, ...(await construir(inv))] };
}

/** Usa una propuesta de IA: la foto del sobre o el QR con dibujo. */
export async function usarPropuesta(slug: string, archivo: string): Promise<{ inv: Invitacion; avisos: string[] }> {
  const previa = await leerInvitacion(slug);
  const que = archivo.startsWith("qr-") ? "qr" : "foto";
  if (que === "qr" && !previa.urlPublica) throw new Error("Primero guarda la dirección donde quedó publicada.");
  await copiarElegida(dirInvitacion(slug), archivo, que);
  const inv = Invitacion.parse({
    ...previa,
    ...(que === "foto" ? { foto: "foto.webp" } : { qrArte: { archivo: "qr-arte.png", url: previa.urlPublica! } }),
    actualizada: new Date().toISOString(),
  });
  await escribirAtomico(path.join(dirInvitacion(slug), "invitacion.json"), JSON.stringify(inv, null, 2));
  return { inv, avisos: await construir(inv) };
}

export const CambiosMano = z.object({
  /** clave → texto escrito a mano. Un texto vacío o igual al de Geeper quita el retoque. */
  textos: z.record(z.string(), z.string().max(1200)),
  ocultas: z.array(Seccion),
});

/** Guarda lo corregido a mano sobre la página terminada y la vuelve a construir. */
export async function guardarCambiosMano(slug: string, cambios: z.input<typeof CambiosMano>): Promise<{ inv: Invitacion; avisos: string[] }> {
  const c = CambiosMano.parse(cambios);
  const previa = await leerInvitacion(slug);
  const bases = basesDe(previa);
  const retoques: Retoques = { ...retoquesVigentes(previa).vigentes };
  for (const [clave, texto] of Object.entries(c.textos)) {
    const base = bases[clave];
    if (base === undefined) continue; // un texto que ya no está en la página
    const limpio = texto.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!limpio || limpio === base) delete retoques[clave];
    else retoques[clave] = { texto: limpio, base };
  }
  const inv = Invitacion.parse({
    ...previa,
    retoques: Object.keys(Retoques.parse(retoques)).length ? retoques : undefined,
    ocultas: c.ocultas.length ? [...new Set(c.ocultas)] : undefined,
    actualizada: new Date().toISOString(),
  });
  await escribirAtomico(path.join(dirInvitacion(slug), "invitacion.json"), JSON.stringify(inv, null, 2));
  return { inv, avisos: await construir(inv) };
}

/** Letras, foto y audio de la invitación, listos para `compilar`. */
async function recursosDe(inv: Invitacion) {
  const dir = dirInvitacion(inv.slug);
  const fuentes = await fuentesDe(estiloDe(inv).letras);
  const fotoB64 = inv.foto ? (await fs.readFile(path.join(dir, inv.foto))).toString("base64") : undefined;
  const musicaB64 = inv.musica.tipo === "archivo" ? (await fs.readFile(path.join(dir, "musica.mp3"))).toString("base64") : undefined;
  return { fuentes, fotoB64, musicaB64 };
}

/** La página en modo «Corregir a mano» (sin audio: no hace falta para escribir). */
export async function htmlEditor(slug: string): Promise<string> {
  const inv = await leerInvitacion(slug);
  const { fuentes, fotoB64 } = await recursosDe(inv);
  return compilar(inv, { fuentesCss: fuentes.css, fotoB64 }, Date.now(), { editor: true }).html;
}

/** La invitación como diseño de Avnac Studio, con la foto y el QR adentro (avnac.ts). */
export async function archivoAvnac(slug: string): Promise<{ nombre: string; contenido: string }> {
  const inv = await leerInvitacion(slug);
  const dir = dirInvitacion(slug);
  const fotoB64 = inv.foto ? (await fs.readFile(path.join(dir, inv.foto))).toString("base64") : undefined;
  const qr = path.join(dir, "publicar", "qr.png");
  const qrB64 = inv.urlPublica && existsSync(qr) ? (await fs.readFile(qr)).toString("base64") : undefined;
  return { nombre: nombreArchivoAvnac(inv), contenido: JSON.stringify(disenoAvnac(inv, { fotoB64, qrB64 })) };
}

/**
 * Deja el diseño en la carpeta «Avnac» de los datos de Geeper (fácil de encontrar desde «Import» de Avnac),
 * abre Avnac Studio si está instalada y muestra el archivo en el explorador. Devuelve qué se pudo hacer.
 */
export async function abrirEnAvnac(slug: string): Promise<{ archivo: string; abierta: boolean; motivo?: string }> {
  const { nombre, contenido } = await archivoAvnac(slug);
  const carpeta = path.join(dirDatos(), "Avnac");
  await fs.mkdir(carpeta, { recursive: true });
  const ruta = path.join(carpeta, nombre);
  await escribirAtomico(ruta, contenido);
  mostrarEnCarpeta(ruta);
  try {
    await abrirAvnac();
    return { archivo: nombre, abierta: true };
  } catch (e) {
    return { archivo: nombre, abierta: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** Carpeta donde Avnac guarda sus diseños: `<UserConfigDir>/avnac-studio/documents` (os.UserConfigDir de Go). */
export function dirDocumentosAvnac(): string {
  const base = SISTEMA === "windows" ? (process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
    : SISTEMA === "mac" ? path.join(os.homedir(), "Library", "Application Support")
    : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  return path.join(base, "avnac-studio", "documents");
}

const comparable = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * El diseño de esta invitación tal como quedó en Avnac: el de su lista con el nombre del archivo que armó
 * Geeper (Avnac lo nombra así al importarlo), el más reciente. Lee `pages.json` (todas las páginas; es lo
 * que Avnac toma como cierto) y, si no está, la página de `document.json`.
 */
export async function buscarEnAvnac(inv: Invitacion): Promise<unknown> {
  const raiz = dirDocumentosAvnac();
  const buscado = comparable(nombreArchivoAvnac(inv).replace(/\.workspace\.avnac$/, ""));
  let mejor: { dir: string; cuando: number } | null = null;
  for (const id of await fs.readdir(raiz).catch(() => [] as string[])) {
    const meta = await fs.readFile(path.join(raiz, id, "meta.json"), "utf8").then((t) => JSON.parse(t) as { name?: string; updatedAt?: number }, () => null);
    const nombre = comparable(meta?.name ?? "");
    if (!nombre || !(nombre === buscado || nombre.startsWith(`${buscado} `) || nombre.startsWith(`${buscado}-`))) continue;
    const cuando = meta?.updatedAt ?? 0;
    if (!mejor || cuando > mejor.cuando) mejor = { dir: path.join(raiz, id), cuando };
  }
  if (!mejor) throw new Error(`No encontré «${nombreArchivoAvnac(inv).replace(/\.workspace\.avnac$/, "")}» en Avnac Studio. Si ya lo importaste y le cambiaste el nombre, expórtalo desde Avnac (Export, como .avnac) y súbelo aquí.`);
  const paginas = await fs.readFile(path.join(mejor.dir, "pages.json"), "utf8").catch(() => "");
  if (paginas.trim()) return JSON.parse(paginas);
  const registro = JSON.parse(await fs.readFile(path.join(mejor.dir, "document.json"), "utf8")) as { document?: unknown };
  return registro.document;
}

/** Qué se trajo de Avnac, en palabras para la persona. */
export interface ResultadoAvnac {
  cambios: string[];
  avisos: string[];
}

/**
 * Pasa a la página interactiva lo que se cambió en Avnac: textos, partes borradas, colores, letras y la foto
 * del sobre. Sin `raw`, lo lee de la carpeta de Avnac (`buscarEnAvnac`). Colores y letras quedan en el tema
 * de la invitación (si tenía un estilo fijo, se vuelve un tema con esos colores).
 */
export async function traerDeAvnac(slug: string, raw?: unknown): Promise<ResultadoAvnac> {
  const previa = await leerInvitacion(slug);
  const dir = dirInvitacion(slug);
  const paginas = leerDisenoAvnac(raw === undefined ? await buscarEnAvnac(previa) : raw);
  if (!paginas?.length) throw new Error("Ese archivo no es un diseño de Avnac Studio. Expórtalo desde Avnac (Export, como .avnac) y vuelve a intentar.");
  const fotoActual = previa.foto ? (await fs.readFile(path.join(dir, previa.foto))).toString("base64") : undefined;
  const c = cambiosDesdeAvnac(previa, paginas, fotoActual);
  const cambios: string[] = [];
  let inv = previa;

  if (Object.keys(c.colores).length || c.letras.titulos || c.letras.texto) {
    const e = estiloDe(inv);
    const base = inv.plantilla === "tema" && inv.tema ? inv.tema
      : Tema.parse({ idea: "", nombre: "Mi diseño", colores: e.colores, letras: e.letras, adorno: e.adorno, particulas: e.particulas, fondo: e.fondo, textos: {} });
    const colores = { ...base.colores, ...c.colores, ...(c.colores.fondo ? { fondo2: c.colores.fondo } : {}) };
    const tema = Tema.parse({ ...base, colores: asegurarContraste(colores), letras: { ...base.letras, ...c.letras } });
    inv = Invitacion.parse({ ...inv, plantilla: "tema", tema });
    if (Object.keys(c.colores).length) cambios.push("los colores");
    if (c.letras.titulos) cambios.push(`la letra de los títulos (${c.letras.titulos})`);
    if (c.letras.texto) cambios.push(`la letra del texto (${c.letras.texto})`);
  }
  if (c.foto) {
    const [, tipo, datos] = /^data:image\/([a-z]+);base64,(.*)$/s.exec(c.foto)!;
    await procesarFoto(new File([Buffer.from(datos!, "base64")], `avnac.${tipo === "jpeg" ? "jpg" : tipo}`), path.join(dir, "foto.webp"));
    inv = Invitacion.parse({ ...inv, foto: "foto.webp" });
    cambios.push("la foto del sobre");
  }
  if (inv !== previa) await escribirAtomico(path.join(dir, "invitacion.json"), JSON.stringify({ ...inv, actualizada: new Date().toISOString() }, null, 2));

  const ocultas = [...new Set([...(inv.ocultas ?? []), ...c.ocultas])] as z.infer<typeof Seccion>[];
  const nTextos = Object.keys(c.textos).length;
  if (nTextos) cambios.unshift(nTextos === 1 ? "1 texto" : `${nTextos} textos`);
  if (c.ocultas.length) cambios.push(`se ocultó: ${c.ocultas.map((o) => NOMBRE_PARTE[o] ?? o).join(", ")}`);
  const { avisos } = await guardarCambiosMano(slug, { textos: c.textos, ocultas });
  return { cambios, avisos: [...c.avisos, ...avisos] };
}

const NOMBRE_PARTE: Record<string, string> = { mensaje: "el mensaje", fecha: "la fecha", cuenta: "la cuenta atrás", lugar: "la ubicación", dress: "el código de vestimenta", rsvp: "la confirmación", regalos: "los regalos", comparte: "el hashtag" };

/** Abre la carpeta del archivo con el archivo marcado (Windows) o la carpeta (Linux/macOS), sin esperar. */
function mostrarEnCarpeta(ruta: string) {
  const [cmd, args] = SISTEMA === "windows" ? ["explorer.exe", [`/select,${ruta}`]] : SISTEMA === "mac" ? ["open", ["-R", ruta]] : ["xdg-open", [path.dirname(ruta)]];
  try {
    const h = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false });
    h.on("error", () => {});
    h.unref();
  } catch {
    /* sin explorador (servidor sin escritorio): queda el archivo */
  }
}

/** Rehace `publicar/` desde el json. Devuelve avisos para la persona (nunca falla por la portada o las letras). */
export async function construir(inv: Invitacion, op: { portada?: boolean } = {}): Promise<string[]> {
  const dir = dirInvitacion(inv.slug);
  const pub = path.join(dir, "publicar");
  await fs.mkdir(pub, { recursive: true });
  const avisos: string[] = [];
  const { fuentes, fotoB64, musicaB64 } = await recursosDe(inv);
  if (fuentes.aviso) avisos.push(fuentes.aviso);
  const { html, ics } = compilar(inv, { fuentesCss: fuentes.css, fotoB64, musicaB64 });

  const peso = Buffer.byteLength(html);
  const max = musicaB64 ? PESO_MAX.conAudio : PESO_MAX.sinAudio;
  if (peso > max) avisos.push(`La invitación pesa ${(peso / 1024 ** 2).toFixed(1)} MB (lo ideal es menos de ${max / 1024 ** 2} MB): puede tardar en abrir con datos móviles.`);

  await escribirAtomico(path.join(pub, "index.html"), html);
  await escribirAtomico(path.join(pub, "invitacion.ics"), ics);
  if (inv.urlPublica) await escribirAtomico(path.join(pub, "qr.svg"), renderSVG(inv.urlPublica, { border: 2, ecc: "M" }));
  else await fs.rm(path.join(pub, "qr.svg"), { force: true });
  // qr.png: el QR con dibujo elegido si lleva esta dirección; si no, uno limpio para imprimir.
  if (inv.urlPublica) {
    const arte = path.join(dirInvitacion(inv.slug), "qr-arte.png");
    try {
      if (inv.qrArte?.url === inv.urlPublica && existsSync(arte)) await fs.copyFile(arte, path.join(pub, "qr.png"));
      else await pngQrBase(inv.urlPublica, path.join(pub, "qr.png"), 1024);
    } catch {
      avisos.push("No se pudo hacer la imagen del QR (PNG). El QR de la página sigue funcionando.");
    }
  } else await fs.rm(path.join(pub, "qr.png"), { force: true });

  if (op.portada ?? !process.env.VITEST) {
    try {
      await hacerPortada(inv, fuentes.css, fotoB64, path.join(pub, "portada-og.jpg"));
    } catch {
      avisos.push("No se pudo hacer la imagen de vista previa para WhatsApp (falta el navegador interno). La invitación funciona igual.");
    }
  }
  await armarZip(pub);
  return avisos;
}

/** Zip con lo que se sube a internet. Sin `invitacion.json`: tiene datos que no hacen falta en público. */
export async function armarZip(pub: string): Promise<void> {
  const archivos: Record<string, Uint8Array> = {};
  for (const n of ["index.html", "invitacion.ics", "portada-og.jpg", "qr.png"]) {
    const ruta = path.join(pub, n);
    if (existsSync(ruta)) archivos[n] = new Uint8Array(await fs.readFile(ruta));
  }
  await escribirAtomico(path.join(pub, "invitacion.zip"), Buffer.from(zipSync(archivos, { level: 6 })));
}

// ── Portada 1200×630 para la vista previa de WhatsApp ────────────────────────────────────────────

/** El Chrome headless que baja Hyperframes (el mismo que usa marca-web.ts); si no, el de Playwright. */
function chrome(): string | undefined {
  for (const base of [path.join(os.homedir(), ".cache", "hyperframes"), CACHE_HF]) {
    try {
      const raiz = path.join(base, "chrome", "chrome-headless-shell");
      const v = readdirSync(raiz).sort().pop()!;
      for (const sub of ["chrome-headless-shell-linux64", "chrome-headless-shell-win64", "chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
        for (const exe of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
          const ruta = path.join(raiz, v, sub, exe);
          if (existsSync(ruta)) return ruta;
        }
      }
    } catch {
      /* no está en esta carpeta */
    }
  }
  return undefined;
}

export function htmlPortada(inv: Invitacion, fuentesCss: string, fotoB64?: string): string {
  const p = estiloDe(inv);
  const c = p.colores;
  const f = textosFecha(instanteUTC(inv.fecha, inv.hora, inv.zona), inv.zona);
  const { corto } = titulos(inv);
  const foto = fotoB64
    ? `<div class="foto" style="background-image:url(data:image/webp;base64,${fotoB64})"></div>`
    : `<div class="foto sello"><span>${esc(iniciales(inv.nombres))}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fuentesCss}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;display:flex;align-items:center;gap:60px;padding:0 80px;background:radial-gradient(120% 120% at 30% 20%,${c.fondo2},${c.fondo});color:${c.claro};font-family:'${p.letras.texto}',Georgia,serif}
.foto{flex:0 0 400px;height:400px;border-radius:50%;background:center/cover;border:10px solid ${c.tarjeta};box-shadow:0 20px 50px rgba(0,0,0,.35)}
.sello{display:flex;align-items:center;justify-content:center;background:${c.sello};font-family:'${p.letras.titulos}',cursive;font-size:120px;color:${c.tarjeta}}
.pre{letter-spacing:.3em;text-transform:uppercase;font-size:26px;opacity:.9}h1{font-family:'${p.letras.titulos}',cursive;font-weight:400;font-size:96px;line-height:1.05;margin:18px 0}
.fecha{font-size:32px}.linea{width:120px;height:3px;background:${c.acento};margin:22px 0}</style></head>
<body>${foto}<div><p class="pre">${esc(corto)}</p><h1>${esc(inv.nombres)}</h1><div class="linea"></div><p class="fecha">${esc(f.fecha)}</p><p class="fecha">${esc(inv.lugar.nombre)}</p></div></body></html>`;
}

async function hacerPortada(inv: Invitacion, fuentesCss: string, fotoB64: string | undefined, destino: string): Promise<void> {
  const pw = await import("playwright-core");
  const nav = await pw.chromium.launch({ executablePath: chrome() });
  try {
    const page = await nav.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(htmlPortada(inv, fuentesCss, fotoB64), { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const jpg = await page.screenshot({ type: "jpeg", quality: 86 });
    await escribirAtomico(destino, jpg);
  } finally {
    await nav.close().catch(() => {});
  }
}
