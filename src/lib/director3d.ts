/**
 * Director 3D: el estilo «Todo en 3D» de «Nuevo» (decisión del dueño, 2026-11-27). Después de que MPT hace
 * el guion, las imágenes y la voz, cada escena se rehace en Blender con una pieza probada de Geeper:
 *
 *  - **personaje**: un personaje 3D propio (personaje3d.py) dice la voz de la escena, con la boca sincronizada
 *    (Rhubarb). Abre y cierra el video: es quien lo presenta.
 *  - **datos**: un gráfico 3D con las cifras que dice la escena (barras, un número grande o un anillo).
 *  - **titulo**: la frase clave de la escena en 3D, delante de la imagen que MPT hizo para ella.
 *  - **foto**: la cámara 3D sobre esa imagen (camara3d.ts): paralaje y desenfoque reales.
 *
 * El plan sale de reglas (función pura, `planearDirector`); si el modelo local está y la tarjeta está libre,
 * puede cambiar la pieza o la frase de una escena, pero sólo entre las piezas posibles, con palabras de la
 * propia escena y sin inventar cifras (nunca escribe código). Cada escena entra en una versión nueva del
 * proyecto (se deshace desde «Historial»); una escena que falla queda con su imagen y no tumba el video.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { generarCamara3dEscena } from "./camara3d";
import { aHex, leerColor, luminancia as luminanciaRgb } from "./colores-marca";
import { db } from "./db";
import { cifrasDe, crearEscena3d, Pedido3d, prepararCorrida3d, usarEscena3d, type Dato3d } from "./escenas3d";
import { PALETAS_3D, type Colores3d, type Personaje3d } from "./escenas3d-catalogo";
import type { Proyecto } from "./esquema";
import { tomarGpu } from "./gpu";
import { escenasEnLinea, type EscenaEnLinea } from "./linea";
import { llamaDisponible, preguntarLlama } from "./llama-local";
import type { ContextoPlano } from "./plano";
import { obtenerPlantilla } from "./plantillas";
import { correr } from "./proceso";
import { versionDeProyecto } from "./render";
import { dirProyecto, FFMPEG } from "./rutas";

export const BLOQUES_3D = ["personaje", "datos", "titulo", "foto"] as const;
export type Bloque3d = (typeof BLOQUES_3D)[number];

export interface PlanEscena3d {
  escena: string;
  numero: number;
  bloque: Bloque3d;
  /** Frase corta en pantalla (título o el título del gráfico). */
  frase: string;
  datos: Dato3d[];
  unidad: string;
  tipoDatos: "barras" | "numero" | "pastel";
  /** Segundos que tiene que cubrir el clip (la primera escena incluye lo que hay antes de que empiece). */
  segundos: number;
}

const MAX_FRASE = 40;
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const RELLENO = new Set(["y", "e", "o", "u", "pero", "pues", "entonces", "bueno", "asi", "que", "porque", "es", "son", "de", "del", "la", "el", "los", "las", "un", "una", "en", "a", "al", "por", "para", "con", "se", "lo", "le", "les", "su", "sus", "mas", "muy", "ya", "tambien", "como", "cuando", "donde", "hoy", "te", "tu", "nos", "mi"]);

/**
 * La frase clave de una escena para ponerla en grande (función pura): la primera oración, sin muletillas
 * al principio, cortada en una pausa natural o en hasta 6 palabras sin dejar un conector al final.
 */
export function fraseClave(texto: string, max = MAX_FRASE): string {
  const oracion = (texto.split(/(?<=[.!?¡¿…])\s+/)[0] ?? texto).replace(/^[¡¿"«\s]+|[.!?…"»\s]+$/g, "").trim();
  const tramo = (oracion.split(/[,;:—–]/)[0] ?? oracion).trim();
  let palabras = tramo.split(/\s+/).filter(Boolean);
  while (palabras.length > 2 && RELLENO.has(sinTildes(palabras[0]!))) palabras = palabras.slice(1);
  let out = palabras.slice(0, 6);
  while (out.length > 2 && (out.join(" ").length > max || RELLENO.has(sinTildes(out[out.length - 1]!)))) out = out.slice(0, -1);
  const f = out.join(" ");
  return f ? f[0]!.toUpperCase() + f.slice(1) : "";
}

/** Cifras de una escena que sirven para un gráfico: sin años sueltos (1990, 2025) ni números de una lista. */
export function cifrasDeEscena(texto: string): { datos: Dato3d[]; unidad: string } {
  const c = cifrasDe(texto);
  const datos = c.datos.filter((d) => !(Number.isInteger(d.valor) && d.valor >= 1800 && d.valor <= 2100 && !c.unidad));
  return { datos, unidad: datos.length ? c.unidad : "" };
}

/** Qué pieza va en cada escena, sin tocar nada (función pura). */
export function planearDirector(p: Proyecto): PlanEscena3d[] {
  const escenas = escenasEnLinea(p);
  const n = escenas.length;
  let alterna = 0;
  return escenas.map((e, i) => {
    const texto = e.escena.texto;
    const { datos, unidad } = cifrasDeEscena(texto);
    const segundos = Math.max(e.visual.rango.duracion, e.duracion + (i === 0 ? e.inicio : 0));
    const base = { escena: e.escena.id, numero: i + 1, frase: fraseClave(texto), datos: [] as Dato3d[], unidad: "", tipoDatos: "barras" as const, segundos };
    // Abre y cierra el personaje (si el video tiene al menos 3 escenas, cierra; con 1 ó 2, sólo abre).
    if (i === 0 || (i === n - 1 && n >= 3)) return { ...base, bloque: "personaje" as const };
    const util = datos.filter((d) => d.valor > 0);
    if (util.length >= 1) {
      const tipoDatos = util.length === 1 ? "numero" : unidad === "%" && util.reduce((a, d) => a + d.valor, 0) <= 100.5 && util.length <= 4 ? "pastel" : "barras";
      return { ...base, bloque: "datos" as const, datos: util.slice(0, 6), unidad, tipoDatos };
    }
    const tieneImagen = ["imagen", "video"].includes(p.assets[e.visual.asset]?.tipo ?? "");
    if (!tieneImagen) return { ...base, bloque: "titulo" as const };
    return { ...base, bloque: alterna++ % 2 === 0 ? ("foto" as const) : ("titulo" as const) };
  });
}

/** Lo que el modelo local puede cambiar (validado): pieza y frase. */
const Ajuste = z.object({ n: z.number().int(), bloque: z.enum(BLOQUES_3D).optional(), frase: z.string().max(80).optional() });

export function promptDirector(plan: PlanEscena3d[], textos: string[]): string {
  return [
    "Eres el director de un video corto hecho en 3D, para gente que no sabe de video. Escribe en español neutro.",
    "Para cada escena elige UNA pieza y una frase corta para la pantalla. No escribas código.",
    "Piezas: personaje = un personaje 3D dice la escena (ideal al abrir, al cerrar o al hablarle a quien mira);",
    "datos = un gráfico 3D (sólo si la escena dice cifras); titulo = la frase en 3D grande sobre la imagen; foto = la imagen con movimiento de cámara (paisajes, lugares, objetos).",
    "La frase: hasta 6 palabras sacadas de la escena, sin inventar nada.",
    "Devuelve SOLO un JSON: {\"escenas\": [{\"n\": número, \"bloque\": pieza, \"frase\": texto}]}",
    "Escenas (con la propuesta actual):",
    ...plan.map((x, i) => `${x.numero}. [${x.bloque}] «${textos[i]!.slice(0, 300)}»`),
  ].join("\n");
}

/**
 * Aplica lo que propone el modelo sólo donde es válido (función pura): la pieza «datos» sólo si la escena
 * tiene cifras, «foto»/«titulo» como estén, y la frase sólo si sus palabras están en la escena.
 */
export function aplicarAjustes(plan: PlanEscena3d[], textos: string[], crudo: string): PlanEscena3d[] {
  let j: unknown;
  try {
    j = JSON.parse(crudo.slice(crudo.indexOf("{"), crudo.lastIndexOf("}") + 1));
  } catch {
    return plan;
  }
  const lista = z.object({ escenas: z.array(z.unknown()) }).safeParse(j);
  if (!lista.success) return plan;
  const ajustes = lista.data.escenas.flatMap((x) => {
    const r = Ajuste.safeParse(x);
    return r.success ? [r.data] : [];
  });
  return plan.map((x, i) => {
    const a = ajustes.find((y) => y.n === x.numero);
    if (!a) return x;
    let out = x;
    if (a.bloque && a.bloque !== x.bloque) {
      if (a.bloque === "datos") {
        if (x.datos.length) out = { ...out, bloque: "datos" };
      } else out = { ...out, bloque: a.bloque };
    }
    if (a.frase) {
      const palabras = sinTildes(textos[i]!).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const propias = sinTildes(a.frase).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const f = a.frase.trim().replace(/^[¡¿"«\s]+|[.!?"»\s]+$/g, "");
      if (propias.length && propias.length <= 7 && f.length <= MAX_FRASE && propias.every((w) => palabras.includes(w))) out = { ...out, frase: f[0]!.toUpperCase() + f.slice(1) };
    }
    return out;
  });
}

/** Colores del video: los de la plantilla del canal (acentos sobre fondo oscuro); si no se pueden leer, «Noche». */
export function coloresDeMarca(c: { acento1: string; acento2: string; activa: string } | null): Colores3d {
  const base = PALETAS_3D[0]!.colores;
  if (!c) return { ...base };
  const a1 = leerColor(c.acento1);
  const a2 = leerColor(c.acento2) ?? leerColor(c.activa);
  if (!a1) return { ...base };
  return { fondo: "#10121a", fondo2: "#05060a", principal: aHex(a1), acento: a2 && luminanciaRgb(a2) > 0.05 ? aHex(a2) : "#ffffff" };
}

/** La voz de una escena tal como suena en el video (con los recortes) y, en la primera, el silencio de antes. */
async function vozDeEscena(dirP: string, p: Proyecto, e: EscenaEnLinea, salida: string, signal?: AbortSignal) {
  const a = p.assets[e.voz.asset];
  if (!a) throw new Error("La escena no tiene voz");
  const entrada = path.join(dirP, a.ruta);
  const partes = e.tramos.map((t, k) => `[0:a]atrim=start=${t.inicio.toFixed(3)}:end=${t.fin.toFixed(3)},asetpts=PTS-STARTPTS[t${k}]`);
  const silencio = e.indice === 0 ? Math.round(e.inicio * 1000) : 0;
  const unir = `${e.tramos.map((_, k) => `[t${k}]`).join("")}concat=n=${e.tramos.length}:v=0:a=1,adelay=${silencio}|${silencio}[a]`;
  await correr(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", entrada, "-filter_complex", [...partes, unir].join(";"), "-map", "[a]", "-ac", "1", "-ar", "24000", salida], { signal, timeout: 120_000 });
}

export interface OpcionesDirector {
  personaje?: Personaje3d;
  /** «normal» por defecto (lista para publicar). */
  calidad?: "rapida" | "normal" | "alta";
}

/**
 * Arma todas las escenas que siguen con la imagen de MPT. Devuelve los números de las que quedaron en 3D.
 * `alEmpezar` avisa cada escena (para la barra de avance del trabajo).
 */
export async function dirigir3d(
  ctx: ContextoPlano,
  proyectoId: string,
  slug: string,
  alEmpezar: (a: { numero: number; indice: number; total: number }) => void | Promise<void>,
  op: OpcionesDirector = {},
): Promise<number[]> {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  let { p } = await versionDeProyecto(proyectoId);
  const dirP = dirProyecto(slug);
  // Sólo las escenas que siguen siendo de MPT (las que ya rehízo el avatar no se tocan).
  const deMpt = new Set(escenasEnLinea(p).filter((e) => p.assets[e.visual.asset]?.source === "mpt").map((e) => e.escena.id));
  let plan = planearDirector(p).filter((x) => deMpt.has(x.escena));
  const textos = () => plan.map((x) => escenasEnLinea(p).find((e) => e.escena.id === x.escena)?.escena.texto ?? "");
  if (plan.length && llamaDisponible()) {
    const candado = await tomarGpu("Todo en 3D: elegir las piezas", { esperar: false }).catch(() => null);
    if (candado) {
      try {
        const r = await preguntarLlama(promptDirector(plan, textos()), { timeout: 180_000, log: ctx.log, signal: ctx.signal });
        if (r) plan = aplicarAjustes(plan, textos(), r);
      } catch (e) {
        ctx.log(`El modelo local no respondió (${e instanceof Error ? e.message : String(e)}); sigo con el plan por reglas.`);
      } finally {
        candado.liberar();
      }
    }
  }
  ctx.log(`Todo en 3D: ${plan.map((x) => `${x.numero}=${x.bloque}`).join(", ")}`);
  const plantilla = await obtenerPlantilla(fila.plantilla).catch(() => null);
  const colores = coloresDeMarca(plantilla?.datos.colores ?? null);
  const personaje = op.personaje ?? "bolita";
  const calidad = op.calidad ?? "normal";
  const formato = (["9:16", "16:9", "1:1"] as const).find((f) => f === p.formato) ?? "9:16";
  const hechas: number[] = [];
  const movimientos = ["entra", "rebota", "gira"] as const;
  for (const [i, x] of plan.entries()) {
    await alEmpezar({ numero: x.numero, indice: i, total: plan.length });
    try {
      if (x.bloque === "foto") {
        await generarCamara3dEscena({ ...ctx, avanzar: undefined }, proyectoId, p, x.escena, { calidad, nota: `Escena ${x.numero} en 3D (cámara 3D)` });
      } else {
        const e = escenasEnLinea(p).find((y) => y.escena.id === x.escena)!;
        const imagen = p.assets[e.visual.asset];
        const tmp = await fs.mkdtemp(path.join(dirP, "build", "director3d-"));
        try {
          let fondo: { nombre: string; datos: Buffer } | undefined;
          let voz: { nombre: string; datos: Buffer } | undefined;
          if (x.bloque === "titulo" && imagen && existsSync(path.join(dirP, imagen.ruta))) {
            const foto = path.join(tmp, "fondo.png");
            const desde = imagen.tipo === "video" ? ["-ss", String(e.visual.rango.inicio)] : [];
            await correr(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...desde, "-i", path.join(dirP, imagen.ruta), "-frames:v", "1", foto], { signal: ctx.signal, timeout: 60_000 });
            fondo = { nombre: "fondo.png", datos: await fs.readFile(foto) };
          }
          if (x.bloque === "personaje") {
            const wav = path.join(tmp, "voz.wav");
            await vozDeEscena(dirP, p, e, wav, ctx.signal);
            voz = { nombre: "voz.wav", datos: await fs.readFile(wav) };
          }
          const pedido = Pedido3d.parse({
            plantilla: x.bloque === "personaje" ? "personaje" : x.bloque === "datos" ? "datos" : "texto",
            texto: x.bloque === "personaje" ? "" : x.frase.slice(0, 80),
            colores,
            estilo: "brillante",
            movimiento: movimientos[i % movimientos.length],
            formato,
            duracion: Math.min(60, Math.max(3, Math.ceil(x.segundos * 10) / 10 + 0.2)),
            calidad,
            tipo_datos: x.tipoDatos,
            datos: x.datos,
            unidad: x.unidad,
            fondo_salida: fondo ? "foto" : "color",
            personaje,
          });
          const c = await prepararCorrida3d(pedido, undefined, fondo, voz, { deVideo: proyectoId });
          await crearEscena3d({ log: ctx.log, signal: ctx.signal }, c.id);
          await usarEscena3d(c.id, proyectoId, x.escena);
        } finally {
          await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
        }
      }
      hechas.push(x.numero);
      ({ p } = await versionDeProyecto(proyectoId));
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      ctx.log(`Escena ${x.numero} (${x.bloque}): no salió en 3D (${err instanceof Error ? err.message.split("\n")[0] : err}); queda con su imagen.`);
    }
  }
  return hechas;
}
