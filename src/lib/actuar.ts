/**
 * «Tu avatar en el video»: el avatar de la biblioteca actúa en las escenas como una persona real
 * (decisiones del dueño, 2026-11-21: Geeper propone dónde sale y la persona ajusta; streamer sobre el
 * gameplay primero; en promociones, con la foto del producto). Todo en Wan2GP, licencias Apache-2.0:
 *
 *  - **Encuadres** (`poseAvatar`): cara, medio cuerpo o cuerpo completo, sobre fondo neutro o verde
 *    (para recortarlo). Se hacen una vez con Qwen Image Edit desde el retrato y se guardan en
 *    `~/geeper-data/avatares/<id>/poses/`, atados a la versión del retrato (un retoque los rehace).
 *  - **Primer cuadro** (`componerCuadro`): Qwen Image Edit pone al avatar en el lugar (la imagen de la
 *    escena o uno descrito), con el producto si hay, en el encuadre pedido.
 *  - **Habla a cámara**: InfiniteTalk sobre ese cuadro con la voz de la escena (presentador.ts, pantalla).
 *  - **Hace algo**: Wan 2.2 Image-to-Video 14B con los aceleradores Lightning (4 pasos) desde ese cuadro
 *    (plano.ts), con la acción como prompt.
 *  - **Streamer**: el avatar sobre verde habla todo el video y se recorta (presentador.ts, marco «recorte»).
 *  - **Dentro del juego**: «Cambiar la persona» de rehacer.ts (Wan2.2 Animate) sobre la grabación.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ajustesEdicion, ESTILOS, leerAvatar, rutaRetrato, type Avatar } from "./avatares";
import type { Formato, Proyecto } from "./esquema";
import { escenasEnLinea, type EscenaEnLinea } from "./linea";
import type { Contexto } from "./pasos";
import { generarPlanoEscena } from "./plano";
import { generarPresentador } from "./presentador";
import { correr } from "./proceso";
import { dirProyecto, FFMPEG } from "./rutas";
import { generarImagenes, instalacionWan2gp, type AjustesWan2gp, type Avance } from "./wan2gp";

export const ENCUADRES = {
  cara: { nombre: "Solo la cara", prompt: "head and shoulders shot, the face fills most of the frame" },
  medio: { nombre: "Medio cuerpo", prompt: "medium shot from the waist up, both arms and hands visible" },
  completo: { nombre: "Cuerpo completo", prompt: "full body shot, the whole person visible from head to feet, shoes visible" },
} as const;
export type Encuadre = keyof typeof ENCUADRES;
export const EncuadreZ = z.enum(Object.keys(ENCUADRES) as [Encuadre, ...Encuadre[]]);

export const FONDOS_POSE = {
  neutro: "plain light gray seamless studio background, soft even light",
  verde: "solid flat pure chroma key green background (#00FF00), evenly lit, no shadows, no gradients, nothing else in the background",
} as const;
export type FondoPose = keyof typeof FONDOS_POSE;

/** Ejemplos para quien no sabe qué escribir (la acción se describe en español; se pasa tal cual). */
export const EJEMPLOS_ACCION = [
  "camina hacia la cámara sonriendo",
  "toma un café y mira por la ventana",
  "juega con un control de videojuegos, emocionada",
  "levanta el producto y lo muestra a la cámara",
  "señala algo a su derecha, sorprendida",
  "aplaude y celebra",
] as const;

/** Lightning 4 pasos para Wan 2.2 I2V A14B (perfil «Lightning i2v v2025-10-14 2 Phases» de Wan2GP). */
export const LIGHTNING_I2V: AjustesWan2gp = {
  num_inference_steps: 4,
  guidance_scale: 1,
  guidance2_scale: 1,
  switch_threshold: 876,
  model_switch_phase: 1,
  guidance_phases: 2,
  flow_shift: 5,
  sample_solver: "euler",
  loras_multipliers: "1;0 0;1",
  activated_loras: [
    "https://huggingface.co/DeepBeepMeep/Wan2.2/resolve/main/loras_accelerators/Wan2.2_I2V_A14B_HIGH_lightx2v_MoE_distill_lora_rank_64_bf16.safetensors",
    "https://huggingface.co/DeepBeepMeep/Wan2.2/resolve/main/loras_accelerators/Wan2.2_I2V_A14B_LOW_4steps_lora_rank64_Seko_V1_forKJ.safetensors",
  ],
};

/** Tamaño de las imágenes que arma Qwen Edit según el formato del video (o vertical para un encuadre). */
export const RESOLUCION_CUADRO: Record<Formato, string> = { "9:16": "720x1280", "16:9": "1280x720", "1:1": "1024x1024" };

export const PedidoActuar = z.object({
  avatar: z.string().regex(/^[a-z0-9-]+$/),
  tipo: z.enum(["habla", "accion"]),
  encuadre: EncuadreZ.default("medio"),
  /** Qué hace (sólo «accion»; también sirve de actitud al hablar). */
  que: z.string().trim().max(400).default(""),
  /** escena: en el lugar de la imagen de la escena · estudio: fondo neutro · describir: el lugar de `donde`. */
  lugar: z.enum(["escena", "estudio", "describir"]).default("escena"),
  donde: z.string().trim().max(300).default(""),
  /** Foto del producto ya subida al proyecto (ruta relativa a la carpeta del proyecto). */
  producto: z.string().regex(/^assets\/[\w.-]+$/).optional(),
  semilla: z.number().int().min(0).max(2147483647).optional(),
});
export type PedidoActuar = z.infer<typeof PedidoActuar>;

const estiloDe = (a: Pick<Avatar, "estilo">) => (a.estilo === "realista" ? "photorealistic" : ESTILOS[a.estilo].prompt);

/** Instrucción para el encuadre del avatar (función pura). */
export function promptPose(a: Pick<Avatar, "estilo">, encuadre: Encuadre, fondo: FondoPose): string {
  return [
    `Show the same person from the image as a ${ENCUADRES[encuadre].prompt}`,
    "standing naturally, relaxed posture, facing the camera",
    "keep exactly the same face, identity, hairstyle, skin tone and clothing style; invent coherent clothing below if it was not visible",
    `${estiloDe(a)}, same art style as the reference`,
    `Background: ${FONDOS_POSE[fondo]}`,
  ].join(". ");
}

/** Instrucción para poner al avatar en el lugar (función pura). Imagen 1: el avatar; 2: la escena; 3: el producto. */
export function promptComponer(a: Pick<Avatar, "estilo">, p: Pick<PedidoActuar, "tipo" | "encuadre" | "que" | "lugar" | "donde">, refs: { escena: boolean; producto: boolean }): string {
  const n = { escena: refs.escena ? 2 : 0, producto: refs.producto ? (refs.escena ? 3 : 2) : 0 };
  const partes = [`The person from image 1 as a ${ENCUADRES[p.encuadre].prompt}`];
  if (p.lugar === "escena" && refs.escena) partes.push(`placed naturally inside the place shown in image ${n.escena}, matching its lighting, perspective and colors, keeping that place recognizable`);
  else if (p.lugar === "describir" && p.donde) partes.push(`in this place: ${p.donde}`);
  else partes.push(`in a ${FONDOS_POSE.neutro}`);
  if (refs.producto) partes.push(`holding the product from image ${n.producto} clearly visible, keeping the product exactly as it is`);
  partes.push(p.tipo === "habla" ? "looking at the camera as if about to talk, mouth closed, natural expression" : p.que ? `about to do this: ${p.que}` : "natural pose");
  partes.push(`keep exactly the same face and identity as image 1, ${estiloDe(a)}`);
  return partes.join(", ") + ".";
}

/** Prompt del movimiento para Wan 2.2 I2V (función pura). */
export function promptAccion(p: Pick<PedidoActuar, "que" | "encuadre">): string {
  const que = p.que || "moves naturally, breathing, small natural gestures";
  return `The person ${que}. Natural, realistic human motion, consistent face and identity, ${ENCUADRES[p.encuadre].prompt}, steady cinematic camera.`;
}

// ---------------------------------------------------------------------------------------------------

export interface ContextoActuar extends Contexto {
  signal?: AbortSignal;
  alAvanzar?: (a: Avance) => void;
}

/** El encuadre del avatar (se hace una vez por versión del retrato y se guarda). Devuelve la ruta. */
export async function poseAvatar(ctx: ContextoActuar, avatarId: string, encuadre: Encuadre, fondo: FondoPose): Promise<string> {
  const a = await leerAvatar(avatarId);
  if (encuadre === "cara" && fondo === "neutro") return rutaRetrato(avatarId);
  const dir = path.join(path.dirname(rutaRetrato(avatarId)), "poses");
  const destino = path.join(dir, `${encuadre}-${fondo}-v${a.versiones.length}.png`);
  if (existsSync(destino)) return destino;
  const corrida = path.join(dir, "_corridas", new Date().toISOString().replace(/[:.]/g, "-"));
  ctx.log(`Preparando a «${a.nombre}» (${ENCUADRES[encuadre].nombre.toLowerCase()}${fondo === "verde" ? ", fondo verde" : ""})…`);
  const ajustes = { ...ajustesEdicion(promptPose(a, encuadre, fondo), [rutaRetrato(avatarId)]), resolution: encuadre === "cara" ? "832x1216" : "720x1280" };
  const [img] = await generarImagenes({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: corrida, signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  if (!img) throw new Error("Wan2GP no devolvió la imagen del encuadre.");
  await fs.mkdir(dir, { recursive: true });
  await correr(FFMPEG, ["-v", "error", "-y", "-i", img, destino]);
  return destino;
}

function buscarEscena(p: Proyecto, escena: string): EscenaEnLinea {
  const escenas = escenasEnLinea(p);
  const es = /^\d+$/.test(escena) ? escenas[Number(escena) - 1] : escenas.find((x) => x.escena.id === escena);
  if (!es) throw new Error(`No hay escena ${escena} (hay ${escenas.length})`);
  return es;
}

/** Un cuadro de la escena como imagen (la imagen tal cual o, si es video, su cuadro del medio). */
async function cuadroDeEscena(dir: string, p: Proyecto, es: EscenaEnLinea, destino: string): Promise<string> {
  const a = p.assets[es.visual.asset]!;
  if (a.tipo === "imagen") return path.join(dir, a.ruta);
  const t = es.visual.rango.inicio + Math.min(es.visual.rango.duracion, a.duracion ?? 1) / 2;
  await correr(FFMPEG, ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", path.join(dir, a.ruta), "-frames:v", "1", destino]);
  return destino;
}

/** Pone al avatar en el lugar (y con el producto), en el encuadre pedido. Devuelve la imagen. */
export async function componerCuadro(ctx: ContextoActuar, p: Proyecto, escena: string, pedido: PedidoActuar, corrida: string): Promise<string> {
  const a = await leerAvatar(pedido.avatar);
  const es = buscarEscena(p, escena);
  await fs.mkdir(corrida, { recursive: true });
  const pose = await poseAvatar(ctx, pedido.avatar, pedido.encuadre, "neutro");
  if (pedido.lugar === "estudio" && !pedido.producto) return pose;
  const refs = [pose];
  const conEscena = pedido.lugar === "escena" && p.assets[es.visual.asset]?.tipo !== "audio";
  if (conEscena) refs.push(await cuadroDeEscena(ctx.dir, p, es, path.join(corrida, "escena.png")));
  if (pedido.producto) {
    const prod = path.join(ctx.dir, pedido.producto);
    if (!existsSync(prod)) throw new Error("No encuentro la foto del producto: súbela de nuevo.");
    refs.push(prod);
  }
  const prompt = promptComponer(a, pedido, { escena: conEscena, producto: !!pedido.producto });
  ctx.log(`Poniendo a «${a.nombre}» en la escena ${es.indice + 1}: ${prompt}`);
  const ajustes = { ...ajustesEdicion(prompt, refs, pedido.semilla), resolution: RESOLUCION_CUADRO[p.formato] };
  const [img] = await generarImagenes({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: path.join(corrida, "componer"), signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  if (!img) throw new Error("Wan2GP no devolvió la imagen de la escena con el avatar.");
  const destino = path.join(corrida, "cuadro.png");
  await correr(FFMPEG, ["-v", "error", "-y", "-i", img, destino]);
  return destino;
}

const dirActuar = (dir: string, escena: string) => path.join(dir, "build", "actuar", `${escena}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

/** El avatar en una escena: habla a cámara o hace algo. Guarda una versión nueva del proyecto. */
export async function actuarEscena(ctx: ContextoActuar, proyectoId: string, p: Proyecto, escena: string, pedido: PedidoActuar) {
  const es = buscarEscena(p, escena);
  const corrida = dirActuar(ctx.dir, es.escena.id);
  const cuadro = await componerCuadro(ctx, p, es.escena.id, pedido, corrida);
  const a = await leerAvatar(pedido.avatar);
  if (pedido.tipo === "habla") {
    return generarPresentador(ctx, proyectoId, p, {
      avatar: pedido.avatar,
      modo: "pantalla",
      escenas: [es.escena.id],
      imagen: cuadro,
      prompt: pedido.que || undefined,
      semilla: pedido.semilla,
    });
  }
  return generarPlanoEscena(ctx, proyectoId, p, es.escena.id, {
    modelo: "i2v",
    prompt: promptAccion(pedido),
    imagen: cuadro,
    extra: LIGHTNING_I2V,
    semilla: pedido.semilla,
    nota: `Escena ${es.indice + 1}: «${a.nombre}» ${pedido.que || "en la escena"}`,
  });
}

export const PedidoStreamer = z.object({
  avatar: z.string().regex(/^[a-z0-9-]+$/),
  encuadre: z.enum(["medio", "completo"]).default("medio"),
  lado: z.enum(["derecha", "izquierda"]).default("derecha"),
  tamano: z.number().min(0.2).max(0.6).default(0.4),
  actitud: z.string().trim().max(300).optional(),
  semilla: z.number().int().min(0).max(2147483647).optional(),
});
export type PedidoStreamer = z.infer<typeof PedidoStreamer>;

/** El avatar recortado sobre el video (gameplay, pantalla), hablando todo el video como un streamer. */
export async function streamerAvatar(ctx: ContextoActuar, proyectoId: string, p: Proyecto, pedido: PedidoStreamer) {
  const pose = await poseAvatar(ctx, pedido.avatar, pedido.encuadre, "verde");
  return generarPresentador(ctx, proyectoId, p, {
    avatar: pedido.avatar,
    modo: "burbuja",
    imagen: pose,
    marco: { forma: "recorte", esquina: pedido.lado === "derecha" ? "abajo-derecha" : "abajo-izquierda", tamano: pedido.tamano },
    prompt: pedido.actitud || "talks with energy like a streamer reacting to a game, natural gestures with the hands",
    semilla: pedido.semilla,
  });
}

// ---------------------------------------------------------------------------------------------------
// «Geeper propone»: dónde sale el avatar en un video nuevo

export interface Propuesta {
  escena: string;
  numero: number;
  pedido: PedidoActuar;
  porque: string;
}

const PERSONA = /\b(yo|t[uú]|nosotros|gente|persona|personas|quien|alguien|cliente|usuario|jugador|creador|imagina|mira|te |tu |vos|ustedes)\b/i;

/**
 * Escenas donde más gana el avatar (función pura): habla en el gancho y en el cierre; hace algo en las que
 * hablan de personas o le hablan a quien mira (como mucho `maxAccion`). La persona ajusta en el editor.
 */
export function proponerEscenas(p: Proyecto, avatar: string, o: { producto?: string; maxAccion?: number } = {}): Propuesta[] {
  const es = escenasEnLinea(p);
  if (!es.length) return [];
  const out: Propuesta[] = [];
  const base = { avatar, lugar: "escena" as const, donde: "" };
  out.push({ escena: es[0]!.escena.id, numero: 1, porque: "el gancho: una cara que habla retiene más", pedido: PedidoActuar.parse({ ...base, tipo: "habla", encuadre: "medio", que: "" }) });
  if (es.length > 1) {
    const u = es.at(-1)!;
    out.push({ escena: u.escena.id, numero: u.indice + 1, porque: "el cierre: pide la acción mirando a cámara", pedido: PedidoActuar.parse({ ...base, tipo: "habla", encuadre: "cara", que: "", producto: o.producto }) });
  }
  const medio = es.slice(1, -1).filter((e) => PERSONA.test(e.escena.texto)).slice(0, o.maxAccion ?? 1);
  for (const e of medio) {
    out.push({
      escena: e.escena.id, numero: e.indice + 1, porque: "habla de personas: el avatar lo actúa",
      pedido: PedidoActuar.parse({ ...base, tipo: "accion", encuadre: "medio", que: o.producto ? "muestra el producto a la cámara con entusiasmo" : "gesticula con naturalidad mientras explica", producto: o.producto }),
    });
  }
  return out.sort((x, y) => x.numero - y.numero);
}

/** El avatar elegido en «Nuevo» (y, si hay, la foto del producto), para el paso `avatar.escenas`. */
export const AvatarDelVideo = z.object({ avatar: z.string().regex(/^[a-z0-9-]+$/), producto: z.string().regex(/^assets\/[\w.-]+$/).optional() });
export type AvatarDelVideo = z.infer<typeof AvatarDelVideo>;
const rutaAvatarDelVideo = (slug: string) => path.join(dirProyecto(slug), "avatar.json");

export async function guardarAvatarDelVideo(slug: string, a: AvatarDelVideo) {
  await fs.mkdir(dirProyecto(slug), { recursive: true });
  await fs.writeFile(rutaAvatarDelVideo(slug), JSON.stringify(AvatarDelVideo.parse(a), null, 2));
}

export async function leerAvatarDelVideo(slug: string): Promise<AvatarDelVideo | null> {
  return fs.readFile(rutaAvatarDelVideo(slug), "utf8").then((t) => AvatarDelVideo.parse(JSON.parse(t)), () => null);
}
