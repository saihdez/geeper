/**
 * «Rehacer la toma» de una escena con video (la idea de comfy-openjutsu y comfy-reshoot, con modelos
 * que caben en 16 GB y licencia Apache-2.0, en Wan2GP; decisión del dueño 2026-11-21):
 *  - persona: cambia a la persona del video por un avatar de la biblioteca (Wan2.2 Animate,
 *    «Replace Person»), que copia sus movimientos, sus gestos y su boca. Con reiluminación opcional.
 *  - cámara: vuelve a filmar la misma toma con otro movimiento de cámara (ReCamMaster 1.3B).
 * El resultado entra como el visual de la escena en una versión nueva (se deshace desde «Historial»).
 * Si la escena sigue a su voz (`sincro: "voz"`, un clip de un directo), el video nuevo también: los
 * recortes de palabras siguen cortando la imagen y la boca no se desincroniza.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { sha256Archivo } from "./archivos";
import { leerAvatar, rutaRetrato } from "./avatares";
import { conFocos } from "./caras";
import { reemplazarVisual } from "./ediciones";
import { pista, validarProyecto, type Clip, type Formato, type Proyecto } from "./esquema";
import { escenasEnLinea, type EscenaEnLinea } from "./linea";
import type { Contexto } from "./pasos";
import { LORA_HABLAR } from "./presentador";
import { correr } from "./proceso";
import { FFMPEG, RAIZ_REPO, WAN2GP_DIR, WAN2GP_PYTHON } from "./rutas";
import { generarPlano, instalacionWan2gp, probarWan2gp, type AjustesWan2gp, type Avance } from "./wan2gp";

export const MODELO_PERSONA = "animate";
export const MODELO_CAMARA = "recam_1.3B";
/** Wan2.2 Animate trabaja a 30 cuadros por segundo; ReCamMaster, a 16 y con 81 cuadros justos. */
export const FPS_PERSONA = 30;
export const FPS_CAMARA = 16;
export const CUADROS_CAMARA = 81;
export const SEGUNDOS_CAMARA = CUADROS_CAMARA / FPS_CAMARA;
/** Más que esto, el cambio de persona tarda demasiado: mejor dividir la escena. */
export const MAX_PERSONA = 15;
/** ReCamMaster hace 81 cuadros (5 s): una escena algo más larga se cubre pasándola más lenta. */
export const MAX_CAMARA = SEGUNDOS_CAMARA / 0.6;

export const LICENCIA_PERSONA = "Apache-2.0 (Wan-AI/Wan2.2-Animate-14B + lightx2v); generado con WanGP";
export const LICENCIA_CAMARA = "Apache-2.0 (KlingTeam/ReCamMaster-Wan2.1); generado con WanGP";

export const RESOLUCION: Record<Formato, string> = { "9:16": "480x832", "16:9": "832x480", "1:1": "640x640" };

/** Movimientos de ReCamMaster (`model_mode`), con un nombre simple y cómo se ve (para la vista previa). */
export const MOVIMIENTOS = [
  { id: 1, nombre: "Hacia la derecha", vista: "paneo-der" },
  { id: 2, nombre: "Hacia la izquierda", vista: "paneo-izq" },
  { id: 3, nombre: "Mirar hacia arriba", vista: "arriba" },
  { id: 4, nombre: "Mirar hacia abajo", vista: "abajo" },
  { id: 5, nombre: "Acercarse", vista: "acercar" },
  { id: 6, nombre: "Alejarse", vista: "alejar" },
  { id: 7, nombre: "Subir", vista: "subir" },
  { id: 8, nombre: "Bajar", vista: "bajar" },
  { id: 9, nombre: "Rodear por la izquierda", vista: "arco-izq" },
  { id: 10, nombre: "Rodear por la derecha", vista: "arco-der" },
] as const;

export const PedidoRehacer = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("persona"), avatar: z.string().regex(/^[a-z0-9-]+$/), reiluminar: z.boolean().default(true), semilla: z.number().int().optional() }),
  z.object({ tipo: z.literal("camara"), movimiento: z.number().int().min(1).max(10), descripcion: z.string().max(600).optional(), semilla: z.number().int().optional() }),
]);
export type PedidoRehacer = z.infer<typeof PedidoRehacer>;

/** Qué parte del video de la escena se rehace y cómo vuelve a entrar (función pura). */
export interface Tramo {
  /** Segundos del asset original. */
  desde: number;
  hasta: number;
  /** Velocidad a la que se ve en la escena (se aplica al recortar: el video nuevo va a velocidad 1). */
  velocidad: number;
  /** El clip sigue a la voz: el nuevo también, con este `rango.inicio` sobre el video nuevo. */
  sincro: boolean;
  inicioNuevo: number;
  /** Lo que dura en pantalla. */
  largo: number;
}

export function tramoDeEscena(es: Pick<EscenaEnLinea, "indice" | "inicio" | "duracion" | "visual" | "voz">, duracionAsset: number | undefined): Tramo {
  const v = es.visual;
  const entrada = es.indice === 0 ? es.inicio : 0;
  const fin = duracionAsset ?? Infinity;
  if (v.sincro === "voz") {
    // Lo que se ve es el mismo tramo de la grabación que la voz (y en la primera, lo de antes).
    const desde = Math.max(0, v.rango.inicio - entrada);
    const hasta = Math.min(fin, v.rango.inicio + es.voz.rango.duracion);
    return { desde, hasta, velocidad: 1, sincro: true, inicioNuevo: v.rango.inicio - desde, largo: hasta - desde };
  }
  const velocidad = v.velocidad ?? 1;
  const largo = es.duracion + entrada;
  const desde = v.rango.inicio;
  const hasta = Math.min(fin, desde + largo * velocidad);
  return { desde, hasta, velocidad, sincro: false, inicioNuevo: 0, largo: (hasta - desde) / velocidad };
}

/** Cuadros 4k+1 que cubren `segundos` a `fps` (hacia arriba: el video nuevo no queda más corto que la escena). */
export const cuadros4k1 = (segundos: number, fps: number) => Math.max(1, Math.ceil((segundos * fps - 1) / 4 - 1e-6)) * 4 + 1;

export interface PlanRehacer {
  escena: string;
  numero: number;
  pedido: PedidoRehacer;
  tramo: Tramo;
  cuadros: number;
  fps: number;
  /** Velocidad para que los 81 cuadros de cámara llenen la escena (null: no hace falta). */
  velocidadFinal: number | null;
  notas: string[];
}

function buscarEscena(p: Proyecto, escena: string): EscenaEnLinea {
  const escenas = escenasEnLinea(p);
  const es = /^\d+$/.test(escena) ? escenas[Number(escena) - 1] : escenas.find((x) => x.escena.id === escena);
  if (!es) throw new Error(`No hay escena ${escena} (hay ${escenas.length})`);
  return es;
}

/** Qué se va a hacer, sin tocar nada (la UI lo muestra antes). */
export function planearRehacer(p: Proyecto, escena: string, pedido: PedidoRehacer): PlanRehacer {
  const es = buscarEscena(p, escena);
  const a = p.assets[es.visual.asset]!;
  if (a.tipo !== "video") throw new Error(`La escena ${es.indice + 1} no tiene video: primero anímala o pon un video tuyo.`);
  const tramo = tramoDeEscena(es, a.duracion);
  if (tramo.hasta - tramo.desde < 0.5) throw new Error("El video de la escena es demasiado corto.");
  const notas: string[] = [];
  if (pedido.tipo === "persona") {
    if (tramo.largo > MAX_PERSONA + 0.05) throw new Error(`La escena ${es.indice + 1} dura ${tramo.largo.toFixed(1)} s y el cambio de persona sirve hasta ${MAX_PERSONA} s: divídela o acórtala primero.`);
    notas.push("Funciona mejor con una sola persona bien visible. Se conservan sus movimientos, sus gestos y su boca.");
    if (tramo.sincro) notas.push("La escena sigue a su voz: el video nuevo también, así que la boca no se desincroniza.");
    return { escena: es.escena.id, numero: es.indice + 1, pedido, tramo, cuadros: cuadros4k1(tramo.largo, FPS_PERSONA), fps: FPS_PERSONA, velocidadFinal: null, notas };
  }
  if (tramo.sincro) throw new Error("Esta escena es una grabación que sigue a su voz: si se mueve la cámara, la boca deja de coincidir. Usa «Cambiar la persona» o una escena sin voz en cámara.");
  if (tramo.largo > MAX_CAMARA + 0.05) throw new Error(`La escena ${es.indice + 1} dura ${tramo.largo.toFixed(1)} s y mover la cámara sirve hasta ${MAX_CAMARA.toFixed(0)} s: divídela o acórtala primero.`);
  const velocidadFinal = tramo.largo > SEGUNDOS_CAMARA + 0.05 ? Math.round((SEGUNDOS_CAMARA / tramo.largo) * 1000) / 1000 : null;
  if (velocidadFinal) notas.push(`La toma nueva dura ${SEGUNDOS_CAMARA.toFixed(1)} s y la escena ${tramo.largo.toFixed(1)} s: se pasa un poco más lenta (${Math.round(velocidadFinal * 100)} %) para llenarla.`);
  notas.push("Funciona mejor con tomas de cosas o lugares que se mueven poco.");
  return { escena: es.escena.id, numero: es.indice + 1, pedido, tramo, cuadros: CUADROS_CAMARA, fps: FPS_CAMARA, velocidadFinal, notas };
}

/** Argumentos de ffmpeg para sacar el tramo a rehacer (función pura). */
export function argsTramo(entrada: string, salida: string, plan: Pick<PlanRehacer, "tramo" | "fps" | "cuadros" | "pedido" | "velocidadFinal">): string[] {
  const t = plan.tramo;
  // Cámara: una escena más larga que 81 cuadros se mete acelerada y después se pasa más lenta.
  const factor = t.velocidad / (plan.velocidadFinal ?? 1);
  const filtros = [
    ...(Math.abs(factor - 1) > 1e-3 ? [`setpts=PTS/${Math.round(factor * 10000) / 10000}`] : []),
    `fps=${plan.fps}`,
    // Cuadros justos (81 en cámara; 4k+1 en persona): si falta video, se repite el último cuadro.
    `tpad=stop_mode=clone:stop=${plan.cuadros}`,
  ];
  return ["-v", "error", "-y", "-ss", t.desde.toFixed(3), "-t", (t.hasta - t.desde).toFixed(3), "-i", entrada, "-an", "-vf", filtros.join(","), "-frames:v", String(plan.cuadros), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", salida];
}

export function ajustesRehacer(plan: PlanRehacer, formato: Formato, video: string, retrato: string | null, prompt: string, mascara: string | null = null): AjustesWan2gp {
  const seed = plan.pedido.semilla ?? Math.floor(Math.random() * 2147483647);
  if (plan.pedido.tipo === "persona") {
    return {
      model_type: MODELO_PERSONA,
      prompt: prompt || "The person moves naturally.",
      resolution: RESOLUCION[formato],
      video_guide: video,
      ...(mascara ? { video_mask: mascara } : {}),
      image_refs: [retrato!],
      // «Replace Person in Control Video by Person in Ref Image» (+ reiluminación).
      video_prompt_type: plan.pedido.reiluminar ? "PVBAIH#1" : "PVBAIH#",
      audio_prompt_type: "",
      force_fps: "control",
      video_length: plan.cuadros,
      sliding_window_size: 81,
      sliding_window_overlap: 5,
      mask_expand: 20,
      remove_background_images_ref: 0,
      activated_loras: [LORA_HABLAR],
      loras_multipliers: "1",
      num_inference_steps: 4,
      guidance_scale: 1,
      seed,
    };
  }
  return {
    model_type: MODELO_CAMARA,
    prompt,
    resolution: RESOLUCION[formato],
    video_guide: video,
    video_prompt_type: "UV",
    image_prompt_type: "",
    model_mode: plan.pedido.movimiento,
    video_length: CUADROS_CAMARA,
    seed,
  };
}

function promptDe(p: Proyecto, es: EscenaEnLinea, pedido: PedidoRehacer): string {
  if (pedido.tipo === "camara" && pedido.descripcion?.trim()) return pedido.descripcion.trim();
  const a = p.assets[es.visual.asset]!;
  const r = typeof a.regenerar.prompt === "string" ? a.regenerar.prompt.trim() : "";
  return r || es.escena.texto.trim() || "A cinematic shot.";
}

/** El clip nuevo de la escena (función pura): misma posición, sigue a la voz si la original lo hacía. */
export function clipNuevo(viejo: Clip, plan: PlanRehacer, assetId: string): Clip {
  const c: Clip = { ...structuredClone(viejo), asset: assetId };
  delete c.velocidad;
  if (plan.tramo.sincro) {
    c.sincro = "voz";
    c.rango = { inicio: plan.tramo.inicioNuevo, duracion: viejo.rango.duracion };
  } else {
    delete c.sincro;
    c.rango = { inicio: 0, duracion: viejo.rango.duracion };
    if (plan.velocidadFinal) c.velocidad = plan.velocidadFinal;
  }
  return c;
}

const carpeta = (dir: string, escena: string) => path.join(dir, "build", "rehacer", `${escena}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

/** Máscara de la persona (SAM 3.1 vía Wan2GP, py/mascara_persona.py): blanco = la persona a cambiar. */
async function mascaraPersona(video: string, salida: string, log?: (l: string) => void, signal?: AbortSignal) {
  const r = await correr(WAN2GP_PYTHON, ["-I", path.join(RAIZ_REPO, "py", "mascara_persona.py"), WAN2GP_DIR, video, salida, FFMPEG], { cwd: WAN2GP_DIR, log, signal, timeout: 30 * 60_000 });
  const linea = r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1);
  const m = linea ? (JSON.parse(linea) as { cobertura: number; area: number }) : null;
  if (!m || m.cobertura < 0.3 || m.area < 0.005) throw new Error("No encontré a una persona en el video de esta escena (o se ve muy poco). Prueba con una escena donde se vea bien a alguien.");
  return m;
}

/** Para la prueba sin GPU: una máscara blanca del mismo tamaño y largo que la toma. */
async function mascaraDePrueba(video: string, salida: string) {
  await correr(FFMPEG, ["-v", "error", "-y", "-i", video, "-vf", "lutyuv=y=255:u=128:v=128", "-c:v", "libx264", "-pix_fmt", "yuv420p", salida]);
}

async function preparar(dir: string, p: Proyecto, plan: PlanRehacer, corrida: string, op: { prueba?: boolean; log?: (l: string) => void; signal?: AbortSignal } = {}) {
  const es = buscarEscena(p, plan.escena);
  const a = p.assets[es.visual.asset]!;
  await fs.mkdir(corrida, { recursive: true });
  const video = path.join(corrida, "toma.mp4");
  await correr(FFMPEG, argsTramo(path.join(dir, a.ruta), video, plan), { timeout: 10 * 60_000 });
  let retrato: string | null = null;
  let mascara: string | null = null;
  if (plan.pedido.tipo === "persona") {
    await leerAvatar(plan.pedido.avatar);
    retrato = path.join(corrida, "retrato.png");
    await fs.copyFile(rutaRetrato(plan.pedido.avatar), retrato);
    mascara = path.join(corrida, "mascara.mp4");
    if (op.prueba) await mascaraDePrueba(video, mascara);
    else {
      op.log?.("Buscando a la persona en cada cuadro (SAM 3.1)…");
      const m = await mascaraPersona(video, mascara, op.log, op.signal);
      op.log?.(`Persona en el ${Math.round(m.cobertura * 100)} % de los cuadros (${Math.round(m.area * 100)} % de la imagen).`);
    }
  }
  return ajustesRehacer(plan, p.formato, video, retrato, promptDe(p, es, plan.pedido), mascara);
}

/** Valida con `wgp.py --dry-run` (sin GPU). */
export async function probarRehacer(dir: string, p: Proyecto, escena: string, pedido: PedidoRehacer) {
  const plan = planearRehacer(p, escena, pedido);
  const corrida = carpeta(dir, plan.escena);
  const ajustes = await preparar(dir, p, plan, corrida, { prueba: true });
  return { plan, ajustes, ...(await probarWan2gp(instalacionWan2gp(), ajustes, corrida)) };
}

export interface ContextoRehacer extends Contexto {
  signal?: AbortSignal;
  alAvanzar?: (a: Avance) => void;
}

/** Rehace la toma (usa toda la GPU) y la pone en la escena, en una versión nueva. */
export async function rehacerEscena(ctx: ContextoRehacer, proyectoId: string, p: Proyecto, escena: string, pedido: PedidoRehacer) {
  const plan = planearRehacer(p, escena, pedido);
  const corrida = carpeta(ctx.dir, plan.escena);
  const ajustes = await preparar(ctx.dir, p, plan, corrida, { log: ctx.log, signal: ctx.signal });
  ctx.log(`Escena ${plan.numero}: ${pedido.tipo === "persona" ? `cambiar la persona por ${pedido.avatar}` : `cámara «${MOVIMIENTOS.find((m) => m.id === pedido.movimiento)!.nombre}»`}, ${plan.cuadros} cuadros a ${plan.fps} fps.`);
  const t0 = Date.now();
  const salida = await generarPlano({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: corrida, signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  const hash = await sha256Archivo(salida);
  const id = `${pedido.tipo === "persona" ? "persona" : "camara"}-${hash.slice(0, 12)}`;
  const ruta = `assets/${id}.mp4`;
  await fs.copyFile(salida, path.join(ctx.dir, ruta));
  const segundos = Math.round((Date.now() - t0) / 1000);
  const viejo = p.assets[buscarEscena(p, plan.escena).visual.asset]!;
  const asset = await describirAsset(ctx.dir, ruta, {
    id,
    tipo: "video",
    source: "wan",
    licencia: pedido.tipo === "persona" ? LICENCIA_PERSONA : LICENCIA_CAMARA,
    regenerar: {
      motor: "wan2gp",
      modelo: ajustes.model_type,
      rehacer: pedido,
      de: viejo.id,
      ajustes: { ...ajustes, video_guide: "toma.mp4", ...(ajustes.image_refs ? { image_refs: ["retrato.png"], video_mask: "mascara.mp4" } : {}) },
      segundos,
    },
  });
  let nuevo = structuredClone(reemplazarVisual(p, plan.escena, asset));
  const visual = pista(nuevo, "visual");
  const i = buscarEscena(nuevo, plan.escena).indice;
  visual.clips[i] = clipNuevo(pista(p, "visual").clips[i]!, plan, id);
  validarProyecto(nuevo);
  if (pedido.tipo === "persona") nuevo = (await conFocos({ dir: ctx.dir, log: ctx.log }, nuevo, { ids: [id], signal: ctx.signal })).p;
  const nombre = pedido.tipo === "persona" ? `persona cambiada por ${(await leerAvatar(pedido.avatar)).nombre}` : `cámara: ${MOVIMIENTOS.find((m) => m.id === pedido.movimiento)!.nombre.toLowerCase()}`;
  const version = await guardarProyecto(proyectoId, nuevo, `Escena ${plan.numero}: ${nombre}`);
  await registrarAssetsEnDb(proyectoId, nuevo);
  return { version, asset: id, segundos, escena: plan.escena };
}
