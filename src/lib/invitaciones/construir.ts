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
import { PLANTILLAS_INFO, TIPOS_INFO } from "./catalogo";
import { compilar, esc, iniciales, titulos } from "./compilar";
import { instanteUTC, textosFecha } from "./calendario";
import { resolverEnlaceMusica } from "./enlaces";
import { Entrada, fechaPasada, Invitacion, SLUG, type PlantillaId } from "./esquema";

export const ARCHIVOS_PUBLICOS = ["index.html", "invitacion.ics", "portada-og.jpg", "qr.svg", "invitacion.zip"] as const;
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
  plantilla: PlantillaId;
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
      out.push({ slug: i.slug, nombres: i.nombres, tipo: TIPOS_INFO[i.tipo].nombre, fecha: i.fecha, plantilla: i.plantilla, publicada: !!i.urlPublica, actualizada: i.actualizada });
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

/** `@font-face` con las letras de la plantilla en base64, guardado en caché. "" si no hay internet. */
export async function fuentesPlantilla(id: PlantillaId, op: { signal?: AbortSignal } = {}): Promise<{ css: string; aviso?: string }> {
  const cache = path.join(dirDatos(), "_cache", "fuentes-invitaciones", `${id}.css`);
  const guardada = await fs.readFile(cache, "utf8").catch(() => null);
  if (guardada) return { css: guardada };
  if (process.env.VITEST && !process.env.GEEPER_INVITACIONES_FUENTES) return { css: "" };
  const { titulos: tit, texto } = PLANTILLAS_INFO[id].letras;
  const fam = (f: string, pesos: string) => `family=${f.replace(/ /g, "+")}${pesos}`;
  const url = `https://fonts.googleapis.com/css2?${fam(tit, "")}&${fam(texto, ":ital,wght@0,400;0,600;1,400")}&display=swap`;
  try {
    const sig = op.signal ?? AbortSignal.timeout(20_000);
    const hoja = await (await fetch(url, { headers: { "user-agent": UA_WOFF2 }, signal: sig })).text();
    const bloques = bloquesLatinos(hoja);
    if (!bloques.length) throw new Error("sin letras");
    let css = "";
    for (const b of bloques) {
      const r = await fetch(b.url, { signal: sig });
      if (!r.ok) throw new Error(`letra ${r.status}`);
      const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
      css += b.css.replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${b64}) format('woff2');`);
    }
    await escribirAtomico(cache, css);
    return { css };
  } catch {
    return { css: "", aviso: "No se pudieron bajar las letras de la plantilla (¿sin internet?): se usaron las del sistema. Vuelve a guardar con internet para tenerlas." };
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
export async function guardarInvitacion(entrada: unknown, subidas: Subidas, slug?: string): Promise<{ inv: Invitacion; avisos: string[] }> {
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
  const { plantilla, musicaEnlace, ...resto } = e;
  const inv = Invitacion.parse({
    ...resto,
    version: 1,
    slug: id,
    creada: previa?.creada ?? ahora,
    actualizada: ahora,
    plantilla: plantilla ?? TIPOS_INFO[e.tipo].plantilla,
    musica,
    musicaEnlace: musica.tipo === "spotify" || musica.tipo === "youtube" ? musicaEnlace : undefined,
    foto,
    urlPublica: previa?.urlPublica,
  });
  await escribirAtomico(path.join(dir, "invitacion.json"), JSON.stringify(inv, null, 2));
  const avisos = await construir(inv);
  return { inv, avisos };
}

/** Guarda la dirección donde quedó publicada y reconstruye (QR y vista previa con la URL absoluta). */
export async function ponerUrlPublica(slug: string, url: string | null): Promise<{ inv: Invitacion; avisos: string[] }> {
  const previa = await leerInvitacion(slug);
  const inv = Invitacion.parse({ ...previa, urlPublica: url ?? undefined, actualizada: new Date().toISOString() });
  await escribirAtomico(path.join(dirInvitacion(slug), "invitacion.json"), JSON.stringify(inv, null, 2));
  return { inv, avisos: await construir(inv) };
}

/** Rehace `publicar/` desde el json. Devuelve avisos para la persona (nunca falla por la portada o las letras). */
export async function construir(inv: Invitacion, op: { portada?: boolean } = {}): Promise<string[]> {
  const dir = dirInvitacion(inv.slug);
  const pub = path.join(dir, "publicar");
  await fs.mkdir(pub, { recursive: true });
  const avisos: string[] = [];
  const fuentes = await fuentesPlantilla(inv.plantilla);
  if (fuentes.aviso) avisos.push(fuentes.aviso);
  const fotoB64 = inv.foto ? (await fs.readFile(path.join(dir, inv.foto))).toString("base64") : undefined;
  const musicaB64 = inv.musica.tipo === "archivo" ? (await fs.readFile(path.join(dir, "musica.mp3"))).toString("base64") : undefined;
  const { html, ics } = compilar(inv, { fuentesCss: fuentes.css, fotoB64, musicaB64 });

  const peso = Buffer.byteLength(html);
  const max = musicaB64 ? PESO_MAX.conAudio : PESO_MAX.sinAudio;
  if (peso > max) avisos.push(`La invitación pesa ${(peso / 1024 ** 2).toFixed(1)} MB (lo ideal es menos de ${max / 1024 ** 2} MB): puede tardar en abrir con datos móviles.`);

  await escribirAtomico(path.join(pub, "index.html"), html);
  await escribirAtomico(path.join(pub, "invitacion.ics"), ics);
  if (inv.urlPublica) await escribirAtomico(path.join(pub, "qr.svg"), renderSVG(inv.urlPublica, { border: 2, ecc: "M" }));
  else await fs.rm(path.join(pub, "qr.svg"), { force: true });

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
  for (const n of ["index.html", "invitacion.ics", "portada-og.jpg"]) {
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
  const p = PLANTILLAS_INFO[inv.plantilla];
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
