/**
 * Escenas 3D con Blender (sección «Escenas 3D» y «Escena 3D» en cada escena del editor). La persona elige una
 * plantilla (escenas3d-catalogo.ts) y la ajusta, o la describe y el modelo local elige la plantilla y sus
 * ajustes (nunca escribe código: decisión del dueño, 2026-11-25). El trabajo `escena3d.crear` arma la escena
 * con py/blender/escena3d.py, la renderiza con Cycles en la GPU (con el candado) y la pasa a MP4.
 *
 * Cada escena es una «corrida» en `<datos>/escenas-3d/<id>/`: corrida.json, entradas/ (la foto o el logo),
 * video.mp4 y portada.jpg.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { asegurarHdri, binBlender, entornoBlender, HDRI, versionBlender } from "./blender";
import { db } from "./db";
import { reemplazarVisual } from "./ediciones";
import {
  COLORES_LOGO, DURACION_3D, ESTILOS_3D, FONDOS_3D, FORMATOS_3D, INFO_PLANTILLAS, MOVIMIENTOS_3D, PALETAS_3D, PLANTILLAS_3D, type Colores3d, type Plantilla3d,
} from "./escenas3d-catalogo";
import { tomarGpu } from "./gpu";
import { llamaDisponible, preguntarLlama } from "./llm-local";
import { correr, type Registro } from "./proceso";
import { versionDeProyecto } from "./render";
import { dirDatos, dirProyecto, FFMPEG, RAIZ_REPO } from "./rutas";

const ids = <T extends readonly { id: string }[]>(xs: T) => xs.map((x) => x.id) as [T[number]["id"], ...T[number]["id"][]];
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Pedido3d = z.object({
  plantilla: z.enum(PLANTILLAS_3D),
  texto: z.string().max(80).default(""),
  colores: z.object({ fondo: Hex, fondo2: Hex.nullable().default(null), principal: Hex, acento: Hex }),
  estilo: z.enum(ids(ESTILOS_3D)).default("brillante"),
  movimiento: z.enum(ids(MOVIMIENTOS_3D)).default("entra"),
  estilo_fondo: z.enum(ids(FONDOS_3D)).default("burbujas"),
  colores_logo: z.enum(ids(COLORES_LOGO)).default("originales"),
  formato: z.enum(ids(FORMATOS_3D)).default("9:16"),
  duracion: z.number().min(DURACION_3D.min).max(DURACION_3D.max).default(DURACION_3D.porDefecto),
  calidad: z.enum(["rapida", "normal", "alta"]).default("normal"),
  /** Nombre del archivo subido (foto o logo) dentro de `entradas/`. */
  archivo: z.string().regex(/^[\w.-]+$/).nullable().default(null),
});
export type Pedido3d = z.infer<typeof Pedido3d>;

export const Corrida3d = z.object({
  id: z.string(),
  titulo: z.string(),
  creada: z.string(),
  estado: z.enum(["preparada", "hecha", "fallida"]),
  pedido: Pedido3d,
  segundos: z.number().optional(),
  dispositivo: z.string().optional(),
  error: z.string().optional(),
});
export type Corrida3d = z.infer<typeof Corrida3d>;

export const dirEscenas3d = () => path.join(dirDatos(), "escenas-3d");
export const dirCorrida3d = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Escena inválida");
  return path.join(dirEscenas3d(), id);
};
/** Rutas relativas a la carpeta de datos (para /api/archivos). */
export const rutaVideo3d = (id: string) => `escenas-3d/${id}/video.mp4`;
export const rutaPortada3d = (id: string) => `escenas-3d/${id}/portada.jpg`;

export function nuevaCorrida3d(plantilla: Plantilla3d) {
  return `${new Date().toISOString().slice(0, 10)}-${plantilla}-${randomBytes(3).toString("hex")}`;
}

/** Nombre corto para la lista (función pura). */
export function tituloDe(p: Pedido3d): string {
  const nombre = INFO_PLANTILLAS[p.plantilla].nombre;
  const t = p.texto.trim().replace(/\s+/g, " ");
  return t ? `${nombre}: «${t.length > 40 ? `${t.slice(0, 39)}…` : t}»` : nombre;
}

/** Qué falta para poder crearla (función pura; null si está todo). */
export function faltaEnPedido(p: Pedido3d): string | null {
  const info = INFO_PLANTILLAS[p.plantilla];
  if (info.obligatorios.includes("texto") && !p.texto.trim()) return "Escribe el texto.";
  if (info.obligatorios.includes("imagen") && !p.archivo) return "Sube la foto de tu producto.";
  if (info.obligatorios.includes("logo") && !p.archivo) return "Sube tu logo (SVG o PNG).";
  if (p.archivo && p.plantilla !== "logo" && !/\.(png|jpe?g|webp)$/i.test(p.archivo)) return "La foto tiene que ser PNG, JPG o WebP.";
  if (p.archivo && p.plantilla === "logo" && !/\.(svg|png)$/i.test(p.archivo)) return "El logo tiene que ser SVG o PNG.";
  return null;
}

export async function escribirCorrida3d(c: Corrida3d) {
  const dir = dirCorrida3d(c.id);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `corrida.json.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(Corrida3d.parse(c), null, 2));
  await fs.rename(tmp, path.join(dir, "corrida.json"));
}

export async function leerCorrida3d(id: string): Promise<Corrida3d | null> {
  try {
    return Corrida3d.parse(JSON.parse(await fs.readFile(path.join(dirCorrida3d(id), "corrida.json"), "utf8")));
  } catch {
    return null;
  }
}

export async function listarCorridas3d(): Promise<Corrida3d[]> {
  let nombres: string[] = [];
  try {
    nombres = await fs.readdir(dirEscenas3d());
  } catch {
    return [];
  }
  const out: Corrida3d[] = [];
  for (const n of nombres) {
    if (!/^[a-z0-9-]+$/.test(n)) continue;
    const c = await leerCorrida3d(n);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.creada.localeCompare(a.creada));
}

export async function borrarCorrida3d(id: string) {
  await fs.rm(dirCorrida3d(id), { recursive: true, force: true });
}

/** Guarda el pedido (y la foto o logo) como corrida «preparada». El trabajo la renderiza. */
export async function prepararCorrida3d(pedido: Pedido3d, archivo?: { nombre: string; datos: Buffer }): Promise<Corrida3d> {
  const id = nuevaCorrida3d(pedido.plantilla);
  const dir = dirCorrida3d(id);
  let p = pedido;
  if (archivo) {
    const ext = path.extname(archivo.nombre).toLowerCase().replace(/[^.a-z0-9]/g, "");
    const nombre = `entrada${ext}`;
    await fs.mkdir(path.join(dir, "entradas"), { recursive: true });
    await fs.writeFile(path.join(dir, "entradas", nombre), archivo.datos);
    p = { ...p, archivo: nombre };
  }
  const falta = faltaEnPedido(p);
  if (falta) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(falta);
  }
  const c: Corrida3d = { id, titulo: tituloDe(p), creada: new Date().toISOString(), estado: "preparada", pedido: p };
  await escribirCorrida3d(c);
  return c;
}

/** El JSON que lee py/blender/escena3d.py (función pura). */
export function pedidoParaBlender(p: Pedido3d, op: { dir: string; cuadros: string; hdri: string | null; dispositivo: "gpu" | "cpu" }) {
  const entrada = p.archivo ? path.join(op.dir, "entradas", p.archivo) : null;
  return {
    plantilla: p.plantilla,
    texto: p.texto,
    colores: p.colores,
    estilo: p.estilo,
    movimiento: p.movimiento,
    estilo_fondo: p.estilo_fondo,
    colores_logo: p.colores_logo,
    formato: p.formato,
    duracion: p.duracion,
    calidad: p.calidad,
    dispositivo: op.dispositivo,
    imagen: p.plantilla === "logo" ? null : entrada,
    logo: p.plantilla === "logo" ? entrada : null,
    hdri: op.hdri,
    cuadros: op.cuadros,
  };
}

/** «GEEPER_CUADRO 12 150» → {n: 12, total: 150} (función pura). */
export function leerCuadro(linea: string): { n: number; total: number } | null {
  const m = /GEEPER_CUADRO (\d+) (\d+)/.exec(linea);
  return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
}

export interface Avance3d {
  etapa: string;
  avance: number;
}
export interface Contexto3d {
  log: Registro;
  signal?: AbortSignal;
  avanzar?: (a: Avance3d) => void;
}

/** Arma y renderiza la escena. Deja video.mp4 y portada.jpg en la carpeta de la corrida. */
export async function crearEscena3d(ctx: Contexto3d, id: string): Promise<Corrida3d> {
  const c = await leerCorrida3d(id);
  if (!c) throw new Error("Esa escena 3D ya no existe.");
  if (!(await versionBlender())) throw new Error("Falta Blender: instálalo con un clic en la página «Escenas 3D».");
  const dir = dirCorrida3d(id);
  const avanzar = (etapa: string, avance: number) => ctx.avanzar?.({ etapa, avance });
  const t0 = Date.now();
  const cuadros = path.join(dir, "cuadros");
  try {
    avanzar("Preparando la luz de estudio", 0.01);
    const hdri = await asegurarHdri(ctx.log);
    await fs.rm(cuadros, { recursive: true, force: true });
    const archivoPedido = path.join(dir, "blender.json");
    // GEEPER_BLENDER_DISPOSITIVO=cpu y GEEPER_BLENDER_ESCALA (por ciento): pruebas sin tarjeta de video.
    const dispositivoPedido = process.env.GEEPER_BLENDER_DISPOSITIVO === "cpu" ? "cpu" : "gpu";
    const escala = Number(process.env.GEEPER_BLENDER_ESCALA) || undefined;
    await fs.writeFile(archivoPedido, JSON.stringify({ ...pedidoParaBlender(c.pedido, { dir, cuadros, hdri, dispositivo: dispositivoPedido }), ...(escala ? { escala } : {}) }, null, 2));
    avanzar("Esperando la tarjeta de video", 0.02);
    const candado = await tomarGpu(`escena 3D ${id}`, { esperar: true, signal: ctx.signal, alEsperar: (q) => avanzar(`Esperando la tarjeta de video (la usa ${q})`, 0.02) });
    let dispositivo = "";
    let error = "";
    try {
      avanzar("Armando la escena en Blender", 0.04);
      const r = await correr(binBlender(), ["-b", "--factory-startup", "--python", path.join(RAIZ_REPO, "py", "blender", "escena3d.py"), "--", archivoPedido], {
        env: entornoBlender(),
        signal: ctx.signal,
        timeout: 3 * 60 * 60_000,
        permitirFallo: true,
        log: (l) => {
          const q = leerCuadro(l);
          if (q) {
            avanzar(`Dibujando: cuadro ${q.n} de ${q.total}`, 0.05 + 0.85 * (q.n / q.total));
            return;
          }
          if (l.startsWith("GEEPER_DISPOSITIVO ")) dispositivo = l.slice(19).trim();
          if (l.startsWith("GEEPER_ERROR ")) error = l.slice(13).trim();
          if (!/^Fra:|\| (Rendering|Synchronizing|Updating|Sample|Path Tracing)/.test(l)) ctx.log(l);
        },
      });
      if (ctx.signal?.aborted) throw new Error("Cancelado");
      if (error) throw new Error(error);
      if (r.codigo !== 0) throw new Error(/CUDA|OptiX|out of memory/i.test(r.stdout + r.stderr) ? "La tarjeta de video falló al dibujar (¿sin memoria?). Prueba con calidad «Rápida» o vuelve a intentar." : `Blender se cerró con un error (código ${r.codigo}). Mira el registro.`);
    } finally {
      candado?.liberar();
    }
    const pngs = (await fs.readdir(cuadros).catch(() => [])).filter((n) => /^c_\d+\.png$/.test(n)).sort();
    if (!pngs.length) throw new Error("Blender terminó pero no dejó cuadros.");
    avanzar("Guardando el video", 0.93);
    const video = path.join(dir, "video.mp4");
    await correr(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "30", "-start_number", String(Number(pngs[0]!.slice(2, -4))), "-i", path.join(cuadros, "c_%04d.png"),
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${video}.tmp.mp4`], { log: ctx.log, signal: ctx.signal, timeout: 30 * 60_000 });
    await fs.rename(`${video}.tmp.mp4`, video);
    const medio = pngs[Math.floor(pngs.length * 0.6)]!;
    await correr(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(cuadros, medio), "-q:v", "3", path.join(dir, "portada.jpg")], { log: ctx.log, timeout: 60_000 });
    const hecha: Corrida3d = { ...c, estado: "hecha", segundos: Math.round((Date.now() - t0) / 1000), dispositivo: dispositivo || undefined, error: undefined };
    await escribirCorrida3d(hecha);
    return hecha;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await escribirCorrida3d({ ...c, estado: "fallida", error: msg.split("\n")[0]!.slice(0, 300) }).catch(() => {});
    throw e;
  } finally {
    await fs.rm(cuadros, { recursive: true, force: true }).catch(() => {});
  }
}

/** Pone el video de una escena 3D como el visual de una escena de un proyecto. Devuelve la versión nueva. */
export async function usarEscena3d(corrida: string, proyectoId: string, escena: string): Promise<number> {
  const c = await leerCorrida3d(corrida);
  const origen = path.join(dirCorrida3d(corrida), "video.mp4");
  if (!c || c.estado !== "hecha" || !existsSync(origen)) throw new Error("Esa escena 3D todavía no está lista.");
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const dir = dirProyecto(fila.slug);
  const datos = await fs.readFile(origen);
  const assetId = `escena3d-${createHash("sha256").update(datos).digest("hex").slice(0, 12)}`;
  const ruta = `assets/${assetId}.mp4`;
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.writeFile(path.join(dir, `${ruta}.tmp`), datos);
  await fs.rename(path.join(dir, `${ruta}.tmp`), path.join(dir, ruta));
  const asset = await describirAsset(dir, ruta, {
    id: assetId,
    tipo: "video",
    source: "archivo",
    licencia: `Hecho en esta PC con Blender (plantilla de Geeper «${INFO_PLANTILLAS[c.pedido.plantilla].nombre}»); luz de estudio ${HDRI.licencia}. Las fotos o logos que subiste son tuyos.`,
    regenerar: { escena3d: c.id },
  });
  const { p } = await versionDeProyecto(proyectoId);
  if (!p.escenas[escena]) throw new Error("Esa escena ya no existe en el video.");
  const nuevo = reemplazarVisual(p, escena, asset);
  const n = await guardarProyecto(proyectoId, nuevo, `Escena 3D «${c.titulo}» en ${escena}`);
  await registrarAssetsEnDb(proyectoId, nuevo);
  return n;
}

// ---------------------------------------------------------------- «Descríbelo y lo armo»

export interface Sugerencia3d {
  plantilla: Plantilla3d;
  texto: string;
  estilo: Pedido3d["estilo"];
  movimiento: Pedido3d["movimiento"];
  estilo_fondo: Pedido3d["estilo_fondo"];
  colores: Colores3d;
  /** Qué entendió, en una frase, para mostrar a la persona. */
  explicacion: string;
  /** Quién la armó: el modelo local o las palabras clave. */
  origen: "ia" | "palabras";
}

const COLORES_NOMBRE: Record<string, string> = {
  rojo: "#e63946", roja: "#e63946", azul: "#1d4ed8", celeste: "#38bdf8", turquesa: "#14b8a6", verde: "#16a34a", amarillo: "#facc15", amarilla: "#facc15",
  naranja: "#f97316", morado: "#7c3aed", morada: "#7c3aed", violeta: "#8b5cf6", lila: "#c084fc", rosa: "#ec4899", rosado: "#f472b6", fucsia: "#d946ef",
  negro: "#0a0a0a", negra: "#0a0a0a", blanco: "#ffffff", blanca: "#ffffff", gris: "#6b7280", dorado: "#d4a017", dorada: "#d4a017", plateado: "#c0c0c0",
  plateada: "#c0c0c0", cafe: "#7c4a1e", marron: "#7c4a1e", beige: "#e8d5b7",
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Saca el texto entre comillas o después de «que diga…» (función pura). */
export function textoCitado(d: string): string {
  const comillas = /[«"“']([^»"”']{1,80})[»"”']/.exec(d);
  if (comillas) return comillas[1]!.trim();
  const diga = /(?:que diga|que dice|con el texto|con la frase|diciendo)\s*:?\s*(.{1,80})$/i.exec(d.trim());
  return diga ? diga[1]!.replace(/[.\s]+$/, "").trim() : "";
}

/**
 * Elige plantilla y ajustes por palabras clave (función pura). Es lo que se usa sin el modelo local y la
 * base que el modelo puede mejorar.
 */
export function adivinarEscena(descripcion: string): Sugerencia3d {
  const d = sinTildes(descripcion);
  const tiene = (...ps: string[]) => ps.some((p) => new RegExp(`\\b${p}`).test(d));
  const plantilla: Plantilla3d = tiene("logo", "marca", "isotipo")
    ? "logo"
    : tiene("caja", "regalo", "sorpresa", "revel", "unboxing", "abre")
      ? "caja"
      : tiene("producto", "pedestal", "precio", "foto de", "botella", "zapat", "perfume", "articulo")
        ? "producto"
        : tiene("fondo", "burbuja", "particula", "abstracto", "loop", "bucle", "lava")
          ? "fondo"
          : "texto";
  const paleta = tiene("neon", "gamer", "cyber") ? "neon" : tiene("pastel", "suave", "tierno") ? "pastel" : tiene("fuego", "intenso", "picante") ? "fuego" : tiene("limpio", "minimal", "blanco y negro") ? "limpio" : tiene("fresco", "natural", "verde") ? "fresco" : "noche";
  const colores = { ...PALETAS_3D.find((p) => p.id === paleta)!.colores };
  const nombres = [...d.matchAll(/\b(fondo\s+)?([a-z]+)\b/g)].filter((m) => COLORES_NOMBRE[m[2]!]);
  for (const m of nombres) {
    if (m[1]) colores.fondo = COLORES_NOMBRE[m[2]!]!;
    else if (colores.principal === PALETAS_3D.find((p) => p.id === paleta)!.colores.principal) colores.principal = COLORES_NOMBRE[m[2]!]!;
    else colores.acento = COLORES_NOMBRE[m[2]!]!;
  }
  if (nombres.some((m) => m[1])) colores.fondo2 = null;
  const estilo = tiene("metal", "cromad", "dorad", "platead", "oro") ? "metal" : tiene("mate", "suave") ? "mate" : "brillante";
  const movimiento = tiene("rebot", "cae", "salta") ? "rebota" : tiene("balance", "suave", "tranquil", "flota") ? "gira" : "entra";
  const estilo_fondo = tiene("particula", "luces", "brillo", "estrella", "polvo") ? "particulas" : "burbujas";
  const texto = textoCitado(descripcion);
  const nombre = INFO_PLANTILLAS[plantilla].nombre;
  const material = ESTILOS_3D.find((x) => x.id === estilo)!.titulo.toLowerCase();
  return {
    plantilla, texto, estilo, movimiento, estilo_fondo, colores, origen: "palabras",
    explicacion: `Entendí: «${nombre}»${texto ? ` que dice «${texto}»` : ""}, ${material}.`,
  };
}

export function promptEscena(descripcion: string): string {
  const plantillas = PLANTILLAS_3D.map((id) => `- ${id}: ${INFO_PLANTILLAS[id].para}`).join("\n");
  return [
    "Eres asistente de una app de video para gente sin conocimientos de 3D. Escribe en español neutro.",
    "La persona describió la escena 3D que quiere. Elige UNA plantilla y sus ajustes. No escribas código.",
    "Plantillas:",
    plantillas,
    "Devuelve SOLO un JSON con estas claves:",
    `{"plantilla": una de [${PLANTILLAS_3D.join(", ")}], "texto": texto en pantalla de hasta 40 letras (vacío si no corresponde),`,
    ` "estilo": una de [${ESTILOS_3D.map((e) => e.id).join(", ")}], "movimiento": una de [${MOVIMIENTOS_3D.map((e) => e.id).join(", ")}],`,
    ` "estilo_fondo": una de [${FONDOS_3D.map((e) => e.id).join(", ")}],`,
    ' "colores": {"fondo": "#RRGGBB", "fondo2": "#RRGGBB" o null, "principal": "#RRGGBB", "acento": "#RRGGBB"},',
    ' "explicacion": una frase corta que empiece con «Entendí:» y diga qué vas a hacer}',
    "Reglas: el texto sólo lo que la persona pidió que diga (no inventes precios ni datos); colores con buen contraste entre fondo y principal.",
    `Descripción: """${descripcion.slice(0, 600)}"""`,
  ].join("\n");
}

/** Toma la respuesta del modelo y la deja válida; lo que falte o no sirva sale de las palabras clave (función pura). */
export function normalizarSugerencia(crudo: string, base: Sugerencia3d): Sugerencia3d {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(crudo.slice(crudo.indexOf("{"), crudo.lastIndexOf("}") + 1)) as Record<string, unknown>;
  } catch {
    return base;
  }
  const de = <T extends string>(v: unknown, validos: readonly T[], porDefecto: T): T => (validos.includes(v as T) ? (v as T) : porDefecto);
  const hex = (v: unknown, porDefecto: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : porDefecto);
  const c = (j.colores ?? {}) as Record<string, unknown>;
  const texto = typeof j.texto === "string" ? j.texto.trim().slice(0, 80) : base.texto;
  return {
    plantilla: de(j.plantilla, PLANTILLAS_3D, base.plantilla),
    // Lo que la persona puso entre comillas manda sobre lo que proponga el modelo.
    texto: base.texto || texto,
    estilo: de(j.estilo, ESTILOS_3D.map((e) => e.id), base.estilo),
    movimiento: de(j.movimiento, MOVIMIENTOS_3D.map((e) => e.id), base.movimiento),
    estilo_fondo: de(j.estilo_fondo, FONDOS_3D.map((e) => e.id), base.estilo_fondo),
    colores: {
      fondo: hex(c.fondo, base.colores.fondo),
      fondo2: c.fondo2 === null ? null : hex(c.fondo2, base.colores.fondo2 ?? base.colores.fondo),
      principal: hex(c.principal, base.colores.principal),
      acento: hex(c.acento, base.colores.acento),
    },
    explicacion: typeof j.explicacion === "string" && j.explicacion.trim() ? j.explicacion.trim().slice(0, 200) : base.explicacion,
    origen: "ia",
  };
}

/**
 * «Descríbelo y lo armo»: el modelo local (llama.cpp) si está y la tarjeta está libre; si no, las palabras
 * clave. Nunca bloquea: si el modelo no responde, sigue con lo que ya entendió.
 */
export async function interpretarDescripcion(descripcion: string, log: Registro = () => {}): Promise<Sugerencia3d> {
  const base = adivinarEscena(descripcion);
  if (!llamaDisponible()) return base;
  const candado = await tomarGpu("escena 3D: entender la descripción", { esperar: false }).catch(() => null);
  if (!candado) return base;
  try {
    const r = await preguntarLlama(promptEscena(descripcion), { timeout: 120_000, log });
    return r ? normalizarSugerencia(r, base) : base;
  } catch (e) {
    log(`El modelo local no respondió (${e instanceof Error ? e.message : String(e)}); uso las palabras clave.`);
    return base;
  } finally {
    candado.liberar();
  }
}
