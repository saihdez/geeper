/**
 * Versión de un proyecto en otro idioma (PRODUCTO.md §4, «Localización»). Crea una copia: el original
 * no cambia. Gemma local (Ollama de MPT) traduce el guion completo repartido en las mismas escenas,
 * Kokoro dice la traducción y whisper realinea los subtítulos (regenerar.ts).
 *
 * Ajuste a los tiempos (idea del doblaje de VoiceStudio, reescrita; ver HEREDADO.md «VoiceStudio»): en
 * Geeper cada escena dura lo que dura su voz, así que una frase más larga sólo es un problema cuando el
 * clip de video de la escena se acaba antes que la voz (el compilador lo repetiría desde el principio).
 * Por orden: (1) video hasta 0,8× más lento, casi imperceptible en planos de apoyo; (2) pedir una
 * versión más corta de esa frase y volver a decirla; (3) video hasta 0,67× más lento. Si aun así no
 * alcanza, el clip se repite y la escena queda marcada para revisarla.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { db } from "./db";
import { pista, validarProyecto, type Proyecto } from "./esquema";
import { ErrorLlm, pedirJson, type OpcionesLlm } from "./llm-local";
import { duracionEscenas, escenasEnLinea } from "./linea";
import type { Contexto } from "./pasos";
import { obtenerPlantilla } from "./plantillas";
import { regenerarVoz, textoADecir } from "./regenerar";
import { dirProyecto } from "./rutas";

export const IDIOMAS = {
  es: { nombre: "Español", llm: "Latin American Spanish (neutral)", sufijo: "ES", voces: { f: "ef_dora", m: "em_alex" } },
  en: { nombre: "Inglés", llm: "English (natural, conversational US English)", sufijo: "EN", voces: { f: "af_heart", m: "am_michael" } },
  pt: { nombre: "Portugués (Brasil)", llm: "Brazilian Portuguese", sufijo: "PT", voces: { f: "pf_dora", m: "pm_alex" } },
  fr: { nombre: "Francés", llm: "French", sufijo: "FR", voces: { f: "ff_siwis", m: "ff_siwis" } },
  it: { nombre: "Italiano", llm: "Italian", sufijo: "IT", voces: { f: "if_sara", m: "im_nicola" } },
} as const;
export type IdiomaDestino = keyof typeof IDIOMAS;
/** «Portugués (Brasil)» → «portugués (Brasil)»: sólo la inicial. */
const enMinuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const IdiomaTraduccion = z.enum(["es", "en", "pt", "fr", "it"]);

/** Nombre del idioma de origen para el LLM (el de `p.voz.idioma`). */
export const NOMBRE_ORIGEN: Record<string, string> = { es: "Spanish", en: "English", pt: "Brazilian Portuguese", fr: "French", it: "Italian" };

export const MODELO_TRADUCIR = process.env.GEEPER_LLM_TRADUCIR ?? "gemma4:26b";
/** Caracteres por segundo de Kokoro a velocidad 1 (aprox.): sólo orienta el largo pedido a Gemma. */
export const CPS_DESTINO = 15;
/** Más lento que esto ya se nota en un plano de apoyo; hasta aquí se ajusta sin preguntar. */
export const VEL_SUAVE = 0.8;
/** Lo más lento que se acepta después de acortar la frase. */
export const VEL_MINIMA = 0.67;

/** Voz de Kokoro en el idioma destino, del mismo género que la original (ef_dora → f). */
export function vozDestino(idioma: IdiomaDestino, vozOrigen: string): string {
  // Kokoro: ef_dora, em_alex; MPT antepone el motor («kokoro:em_alex»).
  const genero = /^[a-z]m_/.test(vozOrigen.split(":").pop() ?? "") ? "m" : "f";
  return IDIOMAS[idioma].voces[genero];
}

export interface PiezaATraducir {
  id: string;
  texto: string;
  /** Largo orientativo (caracteres) para que la voz quepa en el tiempo de la escena. */
  max?: number;
}

/** Prompt de traducción del guion repartido en escenas y de los textos en pantalla (función pura). */
export function promptTraduccion(o: { idioma: IdiomaDestino; de?: string; tema: string; escenas: PiezaATraducir[]; textos: PiezaATraducir[] }): string {
  const destino = IDIOMAS[o.idioma].llm;
  const origen = NOMBRE_ORIGEN[o.de ?? "es"] ?? "Spanish";
  return [
    `You translate the voice-over of a short video from ${origen} into ${destino}.`,
    "The script is split into consecutive scenes; a scene may start or end in the middle of a sentence.",
    "Translate the WHOLE script so it reads naturally when the scenes are spoken one after another, and split",
    "your translation into exactly the same scenes, each carrying the same content as its original scene.",
    "Rules: keep the meaning and the facts; do not add or drop information; spoken style, easy to say aloud;",
    "write numbers as a narrator would say them; no emojis, no stage directions, no quotes around the text;",
    "keep each scene at or under its \"max\" characters when given (the voice must fit the same time).",
    "On-screen texts (\"textos\") are short titles or captions: translate them briefly, same tone.",
    `Video topic: ${o.tema}`,
    "Input:",
    JSON.stringify({ escenas: o.escenas, textos: o.textos }),
    'Answer only JSON: {"escenas": [{"id": "…", "texto": "…"}], "textos": [{"id": "…", "texto": "…"}]}',
  ].join("\n");
}

/** Prompt para acortar frases que no caben (función pura). */
export function promptAcortar(o: { idioma: IdiomaDestino; guion: string; escenas: PiezaATraducir[] }): string {
  return [
    `These ${IDIOMAS[o.idioma].llm} voice-over scenes are too long for their time slot.`,
    "Rewrite each one shorter, at or under its \"max\" characters, keeping the meaning and keeping it",
    "connected to the scenes around it (it may start or end mid-sentence, exactly like the original).",
    "No emojis, no quotes, spoken style.",
    `Whole script, for context: ${o.guion.replace(/\s+/g, " ").slice(0, 4000)}`,
    "Scenes to shorten:",
    JSON.stringify({ escenas: o.escenas }),
    'Answer only JSON: {"escenas": [{"id": "…", "texto": "…"}]}',
  ].join("\n");
}

const limpiarTexto = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, "")
    .trim();

/** Lee `{"escenas": [...], "textos": [...]}` del LLM: un texto no vacío por id pedido (función pura). */
export function leerPiezas(salida: string, ids: { escenas: string[]; textos?: string[] }): { escenas: Record<string, string>; textos: Record<string, string> } {
  // Si el modelo razonó en voz alta, el JSON va después del razonamiento.
  const fin = salida.lastIndexOf("done thinking");
  const cuerpo = fin >= 0 ? salida.slice(fin) : salida;
  const json = cuerpo.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("La IA no devolvió la traducción en el formato esperado.");
  let d: { escenas?: unknown; textos?: unknown };
  try {
    d = JSON.parse(json[0]) as typeof d;
  } catch {
    throw new Error("La IA devolvió una traducción incompleta.");
  }
  const mapa = (lista: unknown, validos: string[]) => {
    const out: Record<string, string> = {};
    if (!Array.isArray(lista)) return out;
    for (const x of lista) {
      if (!x || typeof x !== "object") continue;
      const { id, texto } = x as { id?: unknown; texto?: unknown };
      if (typeof id !== "string" || typeof texto !== "string" || !validos.includes(id)) continue;
      const t = limpiarTexto(texto);
      if (t) out[id] = t;
    }
    return out;
  };
  return { escenas: mapa(d.escenas, ids.escenas), textos: mapa(d.textos, ids.textos ?? []) };
}

/**
 * Como `leerPiezas`, pero exige todas las escenas (una traducción a medias no sirve). Los textos en
 * pantalla que falten se quedan como estaban.
 */
export function leerTraduccion(salida: string, escenas: string[], textos: string[] = []): { escenas: Record<string, string>; textos: Record<string, string> } {
  const r = leerPiezas(salida, { escenas, textos });
  const faltan = escenas.filter((id) => !r.escenas[id]);
  if (faltan.length) throw new Error(`A la traducción le faltan ${faltan.length} de ${escenas.length} escenas (${faltan.slice(0, 5).join(", ")}).`);
  return r;
}

export type EstadoAjuste = "cabe" | "lento" | "falta";

/**
 * Velocidad del clip de video para que alcance a cubrir la voz (función pura). `fuente` son los
 * segundos de video que quedan desde donde empieza el clip (sin límite para imágenes). `piso` es la
 * fracción mínima de la velocidad actual que se acepta.
 */
export function ajusteVisual(durVoz: number, fuente: number | undefined, velActual: number, piso: number): { velocidad: number; estado: EstadoAjuste } {
  if (fuente === undefined || !(durVoz > 0)) return { velocidad: velActual, estado: "cabe" };
  const necesaria = fuente / durVoz;
  if (velActual <= necesaria + 1e-6) return { velocidad: velActual, estado: "cabe" };
  const minima = velActual * piso;
  if (necesaria >= minima) return { velocidad: Math.floor(necesaria * 100) / 100, estado: "lento" };
  return { velocidad: Math.round(minima * 100) / 100, estado: "falta" };
}

export interface AjusteEscena {
  escena: string;
  /** acortada: se pidió una frase más corta; lento: el video va más lento; repite: el clip vuelve a empezar. */
  acciones: ("acortada" | "lento" | "repite")[];
  velocidad?: number;
}

export interface InformeTraduccion {
  de: { id: string; nombre: string };
  idioma: IdiomaDestino;
  voz: string;
  modelo: string;
  fecha: string;
  ajustes: AjusteEscena[];
  /** Textos en pantalla que no se pudieron traducir (quedan en español). */
  sinTraducir: string[];
}

/**
 * Pregunta a Gemma (Ollama de MPT) por llm-local.ts (GPU-09) y devuelve el JSON crudo. Espera su turno en la
 * tarjeta; con el candado tomado enciende Ollama si quedó apagado y corta dentro del contenedor al tope.
 * `modelo`: por defecto MODELO_TRADUCIR.
 */
export async function preguntarLlm(prompt: string, etapa: string, ctx: Contexto & { signal?: AbortSignal }, op: { modelo?: string; ejecutar?: OpcionesLlm["ejecutar"]; candado?: OpcionesLlm["candado"]; encender?: OpcionesLlm["encender"] } = {}): Promise<string> {
  const modelo = op.modelo ?? MODELO_TRADUCIR;
  ctx.log(`${etapa}: esperando la tarjeta de video (${modelo})…`);
  try {
    const r = await pedirJson(modelo, prompt, z.unknown(), {
      tarea: `traducir ${path.basename(ctx.dir)}`,
      formato: "json",
      esperarGpu: true,
      // Una traducción larga con el modelo grande, en frío, pasa de los 5 min por defecto.
      timeoutMs: 600_000,
      signal: ctx.signal,
      avisar: (t) => ctx.log(`${etapa}: ${t}`),
      ejecutar: op.ejecutar,
      candado: op.candado,
      encender: op.encender,
    });
    return r.crudo;
  } catch (e) {
    if (e instanceof ErrorLlm && e.causa === "modelo-falta") throw new Error(`Falta el modelo ${modelo} en la IA local.`);
    if (e instanceof ErrorLlm) throw new Error(e.detalle && e.causa === "otro" ? `${e.message} (${e.detalle})` : e.message);
    throw e;
  }
}

/** Copia los assets del original (enlaces duros si se puede: no ocupan espacio). */
async function copiarAssets(origen: string, destino: string): Promise<void> {
  const desde = path.join(origen, "assets");
  const hasta = path.join(destino, "assets");
  await fs.mkdir(hasta, { recursive: true });
  for (const e of await fs.readdir(desde, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    const rel = path.relative(desde, abs);
    const dst = path.join(hasta, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    try {
      await fs.link(abs, dst);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      await fs.copyFile(abs, dst);
    }
  }
}

/** Segundos de video que quedan desde el inicio del clip visual de cada escena (undefined = imagen). */
function fuentesVisuales(p: Proyecto): Map<string, { fuente: number | undefined; velocidad: number }> {
  const out = new Map<string, { fuente: number | undefined; velocidad: number }>();
  for (const c of pista(p, "visual").clips) {
    const a = p.assets[c.asset];
    const video = a && a.tipo !== "imagen" && a.duracion !== undefined && c.sincro !== "voz";
    out.set(c.escena ?? "", { fuente: video ? Math.max(0, a.duracion! - c.rango.inicio) : undefined, velocidad: c.velocidad ?? 1 });
  }
  return out;
}

async function actual(proyectoId: string): Promise<Proyecto> {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const v = await db.version.findUniqueOrThrow({ where: { proyectoId_numero: { proyectoId, numero: fila.versionActual } } });
  return validarProyecto(JSON.parse(v.json));
}

export async function traducirProyecto(
  ctx: Contexto & { signal?: AbortSignal; etapa?: (e: string, progreso: number) => Promise<void> },
  destinoId: string,
  origenId: string,
  idioma: IdiomaDestino,
): Promise<{ version: number; ajustes: AjusteEscena[] }> {
  const etapa = ctx.etapa ?? (async () => {});
  const filaOrigen = await db.proyecto.findUniqueOrThrow({ where: { id: origenId } });
  const filaDestino = await db.proyecto.findUniqueOrThrow({ where: { id: destinoId } });
  if (filaOrigen.versionActual < 1) throw new Error("El video original todavía no está armado.");
  const original = await actual(origenId);
  if (original.voz.idioma === idioma) throw new Error("El video ya está en ese idioma.");
  const voz = pista(original, "voz").clips;
  if (voz.some((c) => original.assets[c.asset]?.regenerar.origen === "clip")) {
    throw new Error("Este video es un clip: la voz es la de la persona que lo grabó y no se puede traducir con otra voz.");
  }

  await etapa("Copiando el video original", 0.05);
  await copiarAssets(dirProyecto(filaOrigen.slug), dirProyecto(filaDestino.slug));

  // 1. Traducción del guion completo, repartido en las mismas escenas.
  const orden = escenasEnLinea(original);
  const escenas = orden.map((x) => ({ id: x.escena.id, texto: textoADecir(x.escena).replace(/\s+/g, " ").trim(), max: Math.max(20, Math.round(x.duracion * CPS_DESTINO * original.voz.velocidad)) }));
  const textos = original.textos.map((t) => ({ id: t.id, texto: t.texto }));
  // Sin botón propio, el de la tarjeta final sale de la plantilla (en español): se traduce y queda propio.
  const ctaTexto = original.cta ?? (await obtenerPlantilla(filaOrigen.plantilla).catch(() => null))?.datos.cta;
  if (ctaTexto) textos.push({ id: "cta", texto: ctaTexto });
  await etapa(`Traduciendo al ${enMinuscula(IDIOMAS[idioma].nombre)} con Gemma (tarjeta de video)`, 0.15);
  const t = leerTraduccion(
    await preguntarLlm(promptTraduccion({ idioma, de: original.voz.idioma, tema: original.tema, escenas, textos }), "Traducción", ctx),
    escenas.map((e) => e.id),
    textos.map((x) => x.id),
  );

  const p = structuredClone(original);
  p.id = destinoId;
  p.nombre = filaDestino.nombre;
  const vozNueva = vozDestino(idioma, original.voz.voz);
  p.voz = { motor: "kokoro", voz: vozNueva, velocidad: original.voz.velocidad, idioma };
  p.mostrar = []; // reglas del español: lo que se lee ahora es la traducción
  for (const e of escenas) {
    const esc = p.escenas[e.id]!;
    esc.texto = t.escenas[e.id]!;
    esc.recortes = [];
    esc.correcciones = [];
  }
  const sinTraducir: string[] = [];
  p.textos = p.textos.map((x) => {
    const nuevo = t.textos[x.id];
    if (!nuevo) sinTraducir.push(x.texto);
    return nuevo ? { ...x, texto: nuevo.slice(0, 160) } : x;
  });
  if (ctaTexto) {
    if (t.textos.cta) p.cta = t.textos.cta.slice(0, 60);
    else sinTraducir.push(ctaTexto);
  }
  const informe: InformeTraduccion = {
    de: { id: origenId, nombre: filaOrigen.nombre },
    idioma,
    voz: vozNueva,
    modelo: MODELO_TRADUCIR,
    fecha: new Date().toISOString(),
    ajustes: [],
    sinTraducir,
  };
  p.origen = { ...p.origen, traduccion: informe };

  // 2. Voz nueva del guion completo y subtítulos realineados (Kokoro + whisper, CPU).
  await etapa(`Voz en ${enMinuscula(IDIOMAS[idioma].nombre)} y subtítulos (Kokoro + whisper, CPU)`, 0.35);
  await regenerarVoz(ctx, destinoId, p, null);

  // 3. Ajuste a los tiempos: más lento lo que falte por poco; acortar lo que falte por mucho.
  let q = await actual(destinoId);
  const ajustes = new Map<string, AjusteEscena>();
  const marcar = (escena: string, accion: AjusteEscena["acciones"][number], velocidad?: number) => {
    const a = ajustes.get(escena) ?? { escena, acciones: [] };
    if (!a.acciones.includes(accion)) a.acciones.push(accion);
    if (velocidad !== undefined) a.velocidad = velocidad;
    ajustes.set(escena, a);
  };
  const largas = (pr: Proyecto) => {
    const f = fuentesVisuales(pr);
    return escenasEnLinea(pr)
      .map((x) => ({ x, f: f.get(x.escena.id)! }))
      .filter(({ x, f: fv }) => ajusteVisual(x.duracion, fv.fuente, fv.velocidad, VEL_SUAVE).estado === "falta");
  };
  const aAcortar = largas(q);
  if (aAcortar.length) {
    await etapa(`Acortando ${aAcortar.length} frase(s) que no caben en su escena`, 0.6);
    const piezas = aAcortar.map(({ x, f }) => ({ id: x.escena.id, texto: x.escena.texto, max: Math.max(15, Math.floor((f.fuente! / (f.velocidad * VEL_SUAVE)) * CPS_DESTINO * q.voz.velocidad * 0.95)) }));
    let cortas: Record<string, string> = {};
    try {
      // Acortar es una mejora: si la IA falla, queda la frase larga con el video más lento.
      cortas = leerPiezas(await preguntarLlm(promptAcortar({ idioma, guion: q.guion.texto, escenas: piezas }), "Acortar", ctx), { escenas: piezas.map((x) => x.id) }).escenas;
    } catch (e) {
      ctx.log(`No se pudieron acortar las frases: ${(e as Error).message}`);
    }
    for (const [k, pieza] of piezas.entries()) {
      const nuevo = cortas[pieza.id];
      if (!nuevo || nuevo.length >= pieza.texto.length) continue;
      await etapa(`Voz de la frase acortada ${k + 1} de ${piezas.length}`, 0.65 + (0.2 * k) / piezas.length);
      const base = await actual(destinoId);
      base.escenas[pieza.id]!.texto = nuevo;
      base.escenas[pieza.id]!.recortes = [];
      await regenerarVoz(ctx, destinoId, base, pieza.id);
      marcar(pieza.id, "acortada");
    }
    q = await actual(destinoId);
  }
  const fuentes = fuentesVisuales(q);
  const visual = pista(q, "visual").clips;
  for (const x of escenasEnLinea(q)) {
    const f = fuentes.get(x.escena.id)!;
    const suave = ajusteVisual(x.duracion, f.fuente, f.velocidad, VEL_SUAVE);
    const r = suave.estado === "falta" ? ajusteVisual(x.duracion, f.fuente, f.velocidad, VEL_MINIMA) : suave;
    if (r.estado === "cabe") continue;
    const i = visual.findIndex((c) => c.escena === x.escena.id);
    visual[i] = { ...visual[i]!, velocidad: r.velocidad };
    marcar(x.escena.id, "lento", r.velocidad);
    if (r.estado === "falta") marcar(x.escena.id, "repite");
  }
  // Los textos en pantalla no pueden pasar del final del video nuevo.
  const total = duracionEscenas(q);
  q.textos = q.textos
    .filter((x) => x.inicio < total - 0.3)
    .map((x) => ({ ...x, duracion: Math.max(0.3, Math.min(x.duracion, total - x.inicio)) }));
  informe.ajustes = [...ajustes.values()];
  q.origen = { ...q.origen, traduccion: informe };
  const version = await guardarProyecto(destinoId, validarProyecto(q), `Versión en ${enMinuscula(IDIOMAS[idioma].nombre)}: ajuste de tiempos`);
  await registrarAssetsEnDb(destinoId, q);
  return { version, ajustes: informe.ajustes };
}
