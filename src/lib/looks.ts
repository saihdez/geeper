/**
 * Color por canal (docs/PHOTOCRAFT.md §5): un «look» de los que trae PhotoCraft y, si se pide, una mejora
 * automática de tono por clip (niveles por canal calculados del propio clip + algo de intensidad). Todo se
 * hornea en una LUT .cube con PhotoCraft (`file.export.colorLookupTables`) y ffmpeg la aplica a cada clip
 * visual con `lut3d` antes de componer: los textos, subtítulos y la marca no se tocan. Se guarda en caché
 * por hash, así que sólo cuesta la primera vez.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { existe, sha256Texto } from "./archivos";
import type { Asset, Proyecto } from "./esquema";
import { ffmpeg, huellaFfmpeg } from "./media";
import { cli } from "./photocraft";
import { correr, type Registro } from "./proceso";
import { dirDatos, FFMPEG, PHOTOCRAFT_VERSION } from "./rutas";

/** Looks que trae PhotoCraft (`layer.newAdjustmentLayer.colorLookup`), con nombre para cualquiera. */
export const LOOKS = {
  ninguno: { nombre: "Natural", descripcion: "Sin look: los colores como salieron" },
  warm: { nombre: "Cálido", descripcion: "Tonos dorados, de tarde" },
  cool: { nombre: "Frío", descripcion: "Tonos azulados, limpios" },
  tealOrange: { nombre: "Cine", descripcion: "Sombras verdeazuladas y pieles naranjas, como en el cine" },
  fadedFilm: { nombre: "Película antigua", descripcion: "Negros lavados, aire retro" },
  bleachBypass: { nombre: "Dramático", descripcion: "Menos color y más contraste" },
  crossProcess: { nombre: "Revelado cruzado", descripcion: "Colores saturados y raros, estilo artístico" },
  monoContrast: { nombre: "Blanco y negro", descripcion: "Monocromo con contraste" },
  dayForNight: { nombre: "Noche", descripcion: "Convierte el día en noche azulada" },
} as const;
export type IdLook = keyof typeof LOOKS;
export const IdLook = z.enum(Object.keys(LOOKS) as [IdLook, ...IdLook[]]);

export const AjustesColor = z.object({
  look: IdLook.default("ninguno"),
  /** Cuánto se nota el look (0..1). */
  intensidad: z.number().min(0).max(1).default(0.7),
  /** Mejora automática de tono en las imágenes generadas (MPT). */
  mejora: z.boolean().default(false),
});
export type AjustesColor = z.infer<typeof AjustesColor>;
export const COLOR_POR_DEFECTO: AjustesColor = { look: "ninguno", intensidad: 0.7, mejora: false };

/** Si hay algo que aplicar. */
export const conColor = (c: AjustesColor) => (c.look !== "ninguno" && c.intensidad > 0) || c.mejora;

export interface Canal {
  inBlack: number;
  inWhite: number;
}
export interface Niveles {
  red: Canal;
  green: Canal;
  blue: Canal;
}

/**
 * Niveles automáticos (como «Tono automático», pero prudente): por canal, recorta el 0,5 % más oscuro y el
 * 0,5 % más claro; luego acerca cada canal a la media de los tres a la mitad, para no «corregir» de más un
 * atardecer o una escena azul a propósito. Topes: nunca sube el negro de 40 ni baja el blanco de 200, y
 * deja sin tocar un canal casi plano. Función pura: recibe histogramas de 256 valores.
 */
export function nivelesAuto(hist: { r: number[]; g: number[]; b: number[] }, recorte = 0.005): Niveles | null {
  const extremos = (h: number[]) => {
    const total = h.reduce((s, x) => s + x, 0);
    if (!total) return null;
    let acc = 0;
    let lo = 0;
    for (let i = 0; i < 256; i++) {
      acc += h[i] ?? 0;
      if (acc > total * recorte) { lo = i; break; }
    }
    acc = 0;
    let hi = 255;
    for (let i = 255; i >= 0; i--) {
      acc += h[i] ?? 0;
      if (acc > total * recorte) { hi = i; break; }
    }
    return { lo, hi };
  };
  const e = [extremos(hist.r), extremos(hist.g), extremos(hist.b)];
  if (e.some((x) => !x)) return null;
  const mLo = e.reduce((s, x) => s + x!.lo, 0) / 3;
  const mHi = e.reduce((s, x) => s + x!.hi, 0) / 3;
  const canal = (x: { lo: number; hi: number }): Canal => {
    let lo = Math.round((x.lo + mLo) / 2);
    let hi = Math.round((x.hi + mHi) / 2);
    lo = Math.min(Math.max(lo, 0), 40);
    hi = Math.max(Math.min(hi, 255), 200);
    if (hi - lo < 30) return { inBlack: 0, inWhite: 255 };
    return { inBlack: lo, inWhite: hi };
  };
  const n = { red: canal(e[0]!), green: canal(e[1]!), blue: canal(e[2]!) };
  const neutro = [n.red, n.green, n.blue].every((c) => c.inBlack <= 1 && c.inWhite >= 254);
  return neutro ? null : n;
}

/** Histograma RGB de 3 fotogramas (20 %, 50 % y 80 %) de un video, o de una imagen. */
async function histograma(ruta: string, duracion: number | undefined): Promise<{ r: number[]; g: number[]; b: number[] }> {
  const instantes = duracion && duracion > 0.5 ? [0.2, 0.5, 0.8].map((k) => k * duracion) : [0];
  const h = { r: new Array<number>(256).fill(0), g: new Array<number>(256).fill(0), b: new Array<number>(256).fill(0) };
  for (const t of instantes) {
    const r = await new Promise<Buffer>((ok, mal) => {
      // ffmpeg directo (stdout binario): `correr` lo trata como texto.
      import("node:child_process").then(({ spawn }) => {
        const p = spawn(FFMPEG, ["-v", "error", "-ss", t.toFixed(3), "-i", ruta, "-frames:v", "1", "-vf", "scale=160:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
        const partes: Buffer[] = [];
        p.stdout.on("data", (d: Buffer) => partes.push(d));
        p.on("error", mal);
        p.on("close", (c) => (c === 0 ? ok(Buffer.concat(partes)) : mal(new Error(`ffmpeg no pudo leer ${path.basename(ruta)} en ${t.toFixed(1)} s`))));
      }, mal);
    });
    for (let i = 0; i + 2 < r.length; i += 3) {
      h.r[r[i]!]!++;
      h.g[r[i + 1]!]!++;
      h.b[r[i + 2]!]!++;
    }
  }
  return h;
}

/** Pasos de PhotoCraft que arman la pila de ajustes (función pura, en orden de abajo hacia arriba). */
export function pasosLut(c: AjustesColor, niveles: Niveles | null): { cmd: string; params: Record<string, unknown> }[] {
  const pasos: { cmd: string; params: Record<string, unknown> }[] = [];
  if (c.mejora) {
    if (niveles) pasos.push({ cmd: "layer.newAdjustmentLayer.levels", params: { ...niveles } });
    pasos.push({ cmd: "layer.newAdjustmentLayer.vibrance", params: { vibrance: 12 } });
  }
  if (c.look !== "ninguno" && c.intensidad > 0) {
    pasos.push({ cmd: "layer.newAdjustmentLayer.colorLookup", params: { lut: c.look, opacity: c.intensidad } });
  }
  return pasos;
}

const VERSION_COLOR = 1;

/** Hornea la LUT (.cube de 33³) en la caché compartida; devuelve su ruta. */
export async function lutDe(c: AjustesColor, niveles: Niveles | null, log?: Registro): Promise<string> {
  const pasos = pasosLut(c, niveles);
  const clave = sha256Texto(JSON.stringify({ VERSION_COLOR, PHOTOCRAFT_VERSION, pasos })).slice(0, 16);
  const dir = path.join(dirDatos(), "color", "luts");
  const destino = path.join(dir, `${clave}.cube`);
  if (await existe(destino)) return destino;
  await fs.mkdir(dir, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(dir, ".tmp-"));
  try {
    const salida = path.join(tmp, "look.cube");
    const args = ["run", "--new", JSON.stringify({ width: 8, height: 8 }), "--no-gpu"];
    for (const p of pasos) args.push("--cmd", p.cmd, "--params", JSON.stringify(p.params));
    args.push("--cmd", "file.export.colorLookupTables", "--params", JSON.stringify({ size: 33, path: salida }));
    await cli(args, log);
    await fs.rename(salida, destino);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return destino;
}

/**
 * Filtro lut3d y carpeta desde la que correr ffmpeg (ESC-09). La ruta absoluta no va dentro del filtro:
 * en Windows lleva «C:» y barras invertidas, que el analizador de filtros de ffmpeg toma como
 * separador y como escape. ffmpeg corre en la carpeta de la LUT y el filtro nombra sólo el archivo
 * (`<hash>.cube`, letras y números).
 */
export function filtroLut(lut: string): { filtro: string; cwd: string } {
  const corte = Math.max(lut.lastIndexOf("/"), lut.lastIndexOf("\\"));
  const nombre = lut.slice(corte + 1);
  if (!/^[\w.-]+$/.test(nombre)) throw new Error(`Nombre de LUT inesperado: ${nombre}`);
  return { filtro: `lut3d=file=${nombre}`, cwd: corte >= 0 ? lut.slice(0, corte) || lut.slice(0, 1) : "." };
}

/** Niveles automáticos de un asset, guardados por su hash (leer 3 fotogramas cuesta ~0,3 s por clip). */
async function nivelesDe(a: Asset, origen: string, dirProyecto: string): Promise<Niveles | null> {
  const cache = path.join(dirProyecto, "assets", "color", `niveles-${a.hash.slice(0, 16)}-v${VERSION_COLOR}.json`);
  try {
    return JSON.parse(await fs.readFile(cache, "utf8")) as Niveles | null;
  } catch {
    const n = nivelesAuto(await histograma(origen, a.duracion));
    await fs.mkdir(path.dirname(cache), { recursive: true });
    await fs.writeFile(cache, JSON.stringify(n));
    return n;
  }
}

/** Assets a los que se aplica el color: los visuales de la pista «visual» (video o imagen raster). */
export function assetsConColor(p: Proyecto): Asset[] {
  const ids = new Set(p.pistas.filter((x) => x.id === "visual").flatMap((x) => x.clips.map((c) => c.asset)));
  return [...ids].map((id) => p.assets[id]).filter((a): a is Asset => !!a && (a.tipo === "video" || (a.tipo === "imagen" && !/\.svg$/i.test(a.ruta))));
}

/**
 * Prepara las versiones con color de los clips y devuelve id de asset → ruta absoluta (para `compilar`).
 * La mejora automática sólo toca las imágenes generadas (source «mpt»); el look, todos los visuales.
 */
export async function prepararColor(p: Proyecto, dirProyecto: string, c: AjustesColor, log?: Registro): Promise<Record<string, string>> {
  if (!conColor(c)) return {};
  const huella = await huellaFfmpeg();
  const sustitutos: Record<string, string> = {};
  for (const a of assetsConColor(p)) {
    const ajustes: AjustesColor = { ...c, mejora: c.mejora && a.source === "mpt" };
    if (!conColor(ajustes)) continue;
    const origen = path.join(dirProyecto, a.ruta);
    const niveles = ajustes.mejora ? await nivelesDe(a, origen, dirProyecto) : null;
    const lut = await lutDe(ajustes, niveles, log);
    const ext = a.tipo === "video" ? ".mp4" : ".png";
    const clave = sha256Texto(JSON.stringify({ a: a.hash, lut: path.basename(lut), huella, v: VERSION_COLOR })).slice(0, 12);
    const destino = path.join(dirProyecto, "assets", "color", `${a.id}-${clave}${ext}`);
    if (!(await existe(destino))) {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      // Temporal único: el render y la vista previa pueden preparar el mismo clip a la vez.
      const tmp = `${destino}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const { filtro, cwd } = filtroLut(lut);
      try {
        if (a.tipo === "video") {
          // CPU (libx264): la GPU es de un trabajo a la vez. Un keyframe por segundo, como pide la vista previa.
          await correr(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-i", path.resolve(origen), "-map", "0:v:0", "-map", "0:a?", "-vf", filtro, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "copy", "-movflags", "+faststart", path.resolve(tmp)], { log, cwd });
        } else {
          await correr(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-i", path.resolve(origen), "-vf", filtro, "-frames:v", "1", path.resolve(tmp)], { log, cwd });
        }
        await fs.rename(tmp, destino);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    sustitutos[a.id] = destino;
  }
  return sustitutos;
}

/** Vista previa de un look sobre una imagen (para elegirlo en Plantillas): JPG en caché. */
export async function muestraLook(imagen: string, c: AjustesColor, salida: string): Promise<void> {
  if (!conColor(c)) {
    await ffmpeg(["-v", "error", "-i", imagen, "-vf", "scale=360:-2", "-frames:v", "1", "-q:v", "4", salida]);
    return;
  }
  const { filtro, cwd } = filtroLut(await lutDe(c, null));
  await correr(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-i", path.resolve(imagen), "-vf", `scale=360:-2,${filtro}`, "-frames:v", "1", "-q:v", "4", path.resolve(salida)], { cwd });
}
