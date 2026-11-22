/**
 * «Animar esta escena» (BRECHAS.md G4): la imagen de la escena → un plano de video con Wan2GP, que entra
 * como su clip visual en una versión nueva (se deshace desde «Historial»). Lo usan el trabajo de la cola
 * `plano.generar` (worker/ejecutores.ts), la API de la tarjeta de escena y `scripts/plano.ts`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { sha256Archivo } from "./archivos";
import { reemplazarVisual } from "./ediciones";
import { pista, validarProyecto, type Proyecto } from "./esquema";
import { escenasEnLinea, type EscenaEnLinea } from "./linea";
import type { Contexto } from "./pasos";
import { correr } from "./proceso";
import { promptConCamara, type Camara } from "./prompt-camara";
import { FFMPEG } from "./rutas";
import { ajustesWan2gp, generarPlano, instalacionWan2gp, MODELO_POR_DEFECTO, modeloPlano, probarWan2gp, type AjustesWan2gp, type Avance, type ModeloPlano } from "./wan2gp";

export interface OpcionesPlano {
  modelo?: string;
  /** Qué tiene que pasar en el plano; por defecto, el prompt de la imagen de MPT o el texto de la escena. */
  prompt?: string;
  segundos?: number;
  semilla?: number;
  pasos?: number;
  negativo?: string;
  /** Texto → video, sin partir de la imagen de la escena. */
  sinImagen?: boolean;
  camara?: Camara;
  /** Imagen de inicio en vez de la de la escena (actuar.ts: el avatar ya puesto en el lugar). Ruta absoluta. */
  imagen?: string;
  /** Ajustes de Wan2GP que se suman (p. ej. los aceleradores Lightning de Wan 2.2 I2V). */
  extra?: AjustesWan2gp;
  /** Nota de la versión en «Historial» (por defecto, «Escena N animada»). */
  nota?: string;
}

export interface PlanPlano {
  escena: string;
  numero: number;
  duracionEscena: number;
  modelo: ModeloPlano;
  promptBase: string;
  /** De dónde salió el prompt base (para explicarlo en la UI). */
  origenPrompt: "pedido" | "imagen" | "texto";
  prompt: string;
  segundos: number;
  conImagen: boolean;
  /** Lo que conviene saber (informativo). */
  notas: string[];
  /** Lo que puede salir mal (licencia, el plano se repite). */
  avisos: string[];
  /** Cuánto dura lo que tiene que cubrir el visual (la escena, y en la primera, también la entrada). */
  largo: number;
  /** Si el plano queda un poco más corto, se pasa a esta velocidad para llenar la escena (null: no hace falta o se repite). */
  velocidad: number | null;
}

/**
 * Cuadros que se saltan al comienzo del plano: el cuadro 0 es la imagen de inicio tal cual y desde el 1
 * el modelo la reinterpreta (otra escala, detalles nuevos), así que al entrar la escena se veía un
 * parpadeo (medido con FastWan, 2026-11-20).
 */
export const CUADROS_DESCARTADOS = 1;

/** Hasta dónde se estira un plano en vez de repetirlo (más lento que esto se nota). */
export const VELOCIDAD_MINIMA = 0.6;

/** Velocidad para que `dura` segundos de video llenen `largo`; null si no hace falta o se notaría. */
export function velocidadParaLlenar(dura: number, largo: number): number | null {
  if (dura >= largo - 0.05) return null;
  const v = dura / largo;
  return v >= VELOCIDAD_MINIMA ? Math.round(v * 1000) / 1000 : null;
}

function buscarEscena(p: Proyecto, escena: string): EscenaEnLinea {
  const escenas = escenasEnLinea(p);
  const es = /^\d+$/.test(escena) ? escenas[Number(escena) - 1] : escenas.find((x) => x.escena.id === escena);
  if (!es) throw new Error(`No hay escena ${escena} (hay ${escenas.length})`);
  return es;
}

/** Qué se va a pedir, sin tocar nada (función pura: la UI la muestra antes de animar). */
export function planearPlano(p: Proyecto, escena: string, op: OpcionesPlano = {}): PlanPlano {
  const es = buscarEscena(p, escena);
  const actual = p.assets[es.visual.asset]!;
  const modelo = modeloPlano(op.modelo ?? MODELO_POR_DEFECTO);
  const conImagen = !op.sinImagen;
  if (conImagen && actual.tipo === "audio") throw new Error(`El visual de la escena ${es.indice + 1} es un audio`);
  if (!conImagen && modelo.necesitaImagen) throw new Error(`${modelo.nombre} necesita partir de la imagen de la escena`);
  const avisos: string[] = [];
  const notas: string[] = [];
  let promptBase = op.prompt?.trim() ?? "";
  let origenPrompt: PlanPlano["origenPrompt"] = "pedido";
  if (!promptBase && typeof actual.regenerar.prompt === "string" && actual.regenerar.prompt.trim()) {
    promptBase = actual.regenerar.prompt.trim();
    origenPrompt = "imagen";
  }
  if (!promptBase) {
    promptBase = es.escena.texto.trim();
    origenPrompt = "texto";
    notas.push("Se usa lo que se dice en la escena como descripción. Si el movimiento no es el que quieres, escribe qué tiene que pasar en «Más opciones».");
  }
  if (!promptBase) throw new Error("La escena no tiene texto ni descripción: escribe qué tiene que pasar en el plano");
  const largo = es.duracion + (es.indice === 0 ? es.inicio : 0);
  const segundos = Math.max(0.5, Math.min(op.segundos ?? largo, modelo.maxSegundos));
  const velocidad = velocidadParaLlenar(segundos, largo);
  if (velocidad) notas.push(`El video nuevo dura ${segundos.toFixed(1)} s y la escena ${largo.toFixed(1)} s: se pasa un poco más lento (${Math.round(velocidad * 100)} %) para llenarla.`);
  else if (largo > segundos + 0.05) avisos.push(`El video nuevo dura ${segundos.toFixed(1)} s y la escena ${largo.toFixed(1)} s: se repite desde el comienzo para llenarla. Puedes acortar la escena o elegir más segundos.`);
  if (/^revisar|desconocid/i.test(modelo.licencia)) avisos.push(`${modelo.nombre}: licencia por revisar. Si el proyecto es de uso comercial, el QC no lo deja pasar.`);
  return {
    escena: es.escena.id,
    numero: es.indice + 1,
    duracionEscena: es.duracion,
    modelo,
    promptBase,
    origenPrompt,
    prompt: promptConCamara(promptBase, op.camara ?? {}),
    segundos,
    conImagen,
    notas,
    avisos,
    largo,
    velocidad,
  };
}

/** Imagen de inicio: la de la escena o, si es un video (los de MPT son un zoom sobre la imagen generada), su cuadro donde empieza el clip. */
async function imagenDeInicio(dir: string, p: Proyecto, plan: PlanPlano, corrida: string, propia?: string): Promise<string | undefined> {
  if (!plan.conImagen) return undefined;
  if (propia) return propia;
  const es = buscarEscena(p, plan.escena);
  const a = p.assets[es.visual.asset]!;
  if (a.tipo === "imagen") return path.join(dir, a.ruta);
  await fs.mkdir(corrida, { recursive: true });
  const png = path.join(corrida, "inicio.png");
  await correr(FFMPEG, ["-v", "error", "-y", "-ss", String(es.visual.rango.inicio), "-i", path.join(dir, a.ruta), "-frames:v", "1", png]);
  return png;
}

function ajustesDe(p: Proyecto, plan: PlanPlano, op: OpcionesPlano, imagen: string | undefined) {
  return { ...ajustesWan2gp(plan.modelo, { prompt: plan.prompt, formato: p.formato, segundos: plan.segundos, imagen, negativo: op.negativo, pasos: op.pasos, semilla: op.semilla }), ...(op.extra ?? {}) };
}

const dirCorrida = (dir: string, escena: string) => path.join(dir, "build", "planos", `${escena}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

/** Valida con `wgp.py --dry-run` (sin GPU). */
export async function probarPlanoEscena(dir: string, p: Proyecto, escena: string, op: OpcionesPlano = {}) {
  const plan = planearPlano(p, escena, op);
  const corrida = dirCorrida(dir, plan.escena);
  const ajustes = ajustesDe(p, plan, op, await imagenDeInicio(dir, p, plan, corrida, op.imagen));
  return { plan, ajustes, ...(await probarWan2gp(instalacionWan2gp(), ajustes, corrida)) };
}

export interface ContextoPlano extends Contexto {
  signal?: AbortSignal;
  alAvanzar?: (a: Avance) => void;
}

/** Genera el plano (usa toda la GPU) y lo guarda como el clip visual de la escena, en una versión nueva. */
export async function generarPlanoEscena(ctx: ContextoPlano, proyectoId: string, p: Proyecto, escena: string, op: OpcionesPlano = {}) {
  const plan = planearPlano(p, escena, op);
  const corrida = dirCorrida(ctx.dir, plan.escena);
  const ajustes = ajustesDe(p, plan, op, await imagenDeInicio(ctx.dir, p, plan, corrida, op.imagen));
  ctx.log(`Escena ${plan.numero}: ${plan.modelo.nombre}, ${ajustes.resolution}, ${ajustes.video_length} cuadros. Prompt: ${plan.prompt}`);
  const t0 = Date.now();
  const video = await generarPlano({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: corrida, signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  const hash = await sha256Archivo(video);
  const id = `wan-${hash.slice(0, 12)}`;
  const ruta = `assets/${id}${path.extname(video).toLowerCase() || ".mp4"}`;
  await fs.copyFile(video, path.join(ctx.dir, ruta));
  const segundos = Math.round((Date.now() - t0) / 1000);
  const asset = await describirAsset(ctx.dir, ruta, {
    id,
    tipo: "video",
    source: "wan",
    licencia: `${plan.modelo.licencia}; generado con WanGP (citar a WanGP si se vende el video)`,
    regenerar: { motor: "wan2gp", modelo: plan.modelo.modelType, ajustes, imagenDe: plan.conImagen ? p.assets[buscarEscena(p, plan.escena).visual.asset]!.id : null, segundos },
  });
  const nuevo = structuredClone(reemplazarVisual(p, plan.escena, asset));
  const clip = pista(nuevo, "visual").clips[buscarEscena(nuevo, plan.escena).indice]!;
  const salto = CUADROS_DESCARTADOS / plan.modelo.fps;
  clip.rango = { ...clip.rango, inicio: salto };
  // Un poco más corto que la escena: se pasa más lento en vez de repetirse (se cambia en «Efectos del plano»).
  const v = asset.duracion ? velocidadParaLlenar(asset.duracion - salto, plan.largo) : null;
  if (v) clip.velocidad = v;
  validarProyecto(nuevo);
  const version = await guardarProyecto(proyectoId, nuevo, op.nota ?? `Escena ${plan.numero} animada (${plan.modelo.nombre})`);
  await registrarAssetsEnDb(proyectoId, nuevo);
  return { version, asset: id, ruta, segundos, escena: plan.escena, velocidad: v };
}
