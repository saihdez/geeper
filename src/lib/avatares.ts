/**
 * Avatares: un personaje (realista o animado) que se crea una vez y después habla en los videos con la
 * voz del proyecto (presentador.ts). Todo corre en esta PC con Wan2GP, que Geeper ya usa para animar
 * escenas (wan2gp.ts):
 *
 *  - **Retratos** desde una descripción: Z-Image Turbo (`z_image`, Apache-2.0), 4 tomas para elegir.
 *  - **Desde una foto** o **retocar** («ponle lentes», «fondo de oficina»): Qwen Image Edit Plus 2511
 *    (`qwen_image_edit_plus2_20B`, Apache-2.0) con su acelerador Lightning de 4 pasos (Apache-2.0), que
 *    conserva la identidad de la persona del retrato.
 *  - **Hablar**: InfiniteTalk (Wan 2.1 I2V 14B + MeiGen-AI/InfiniteTalk, Apache-2.0) con el acelerador
 *    lightx2v de 4 pasos (Apache-2.0), en presentador.ts.
 *
 * Idea de los workflows oficiales de ComfyUI (`video_wan2_1_infinitetalk`, `templates-1_click_multiple_
 * character_angles`), hechos con los mismos modelos en Wan2GP para no duplicar 30 GB de pesos.
 *
 * Biblioteca en `~/geeper-data/avatares/<id>/` (avatar.json, retrato.png y las versiones anteriores).
 * Una foto de una persona real sólo entra con su consentimiento, que queda escrito en avatar.json.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Contexto } from "./pasos";
import { correr } from "./proceso";
import { LOOKS, LUCES } from "./prompt-camara";
import { dirDatos, FFMPEG } from "./rutas";
import { generarImagenes, instalacionWan2gp, probarWan2gp, type AjustesWan2gp, type Avance } from "./wan2gp";

export const MAX_DESCRIPCION = 600;
export const TOMAS = 4;
/** Vertical, como los retratos de MPT: sirve en 9:16 y, recortado, en la burbuja. */
export const RESOLUCION_RETRATO = "832x1216";

export const MODELO_RETRATO = "z_image";
export const MODELO_RETOQUE = "qwen_image_edit_plus2_20B";
/** Acelerador de Qwen Edit 2511 (perfil «Lightning Qwen Edit 2511 - 4 Steps» de Wan2GP). */
export const LORA_RETOQUE = "https://huggingface.co/DeepBeepMeep/Qwen_image/resolve/main/loras_accelerators/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";

export const LICENCIA_RETRATO = "Apache-2.0 (Tongyi-MAI/Z-Image-Turbo); generado con WanGP";
export const LICENCIA_RETOQUE = "Apache-2.0 (Qwen/Qwen-Image-Edit-2511 + lightx2v/Qwen-Image-Edit-2511-Lightning); generado con WanGP";

/** Estilos a la vista de la persona; al modelo va el texto en inglés. */
export const ESTILOS = {
  realista: {
    nombre: "Realista",
    detalle: "Como una foto",
    prompt: "photorealistic studio portrait photograph, natural skin texture, sharp focus, 85mm lens",
  },
  "animado-3d": {
    nombre: "Animado 3D",
    detalle: "Como una película animada",
    prompt: "stylized 3D animated character, feature animation film style, soft subsurface shading, expressive eyes, clean render",
  },
  anime: {
    nombre: "Anime",
    detalle: "Dibujo japonés",
    prompt: "anime style character illustration, clean cel shading, crisp line art, vibrant colors",
  },
  caricatura: {
    nombre: "Caricatura",
    detalle: "Dibujo animado 2D",
    prompt: "2D cartoon character, bold clean outlines, flat colors, friendly mascot style",
  },
  ilustracion: {
    nombre: "Ilustración",
    detalle: "Pintura digital",
    prompt: "digital painting illustration, painterly brush strokes, storybook style, rich colors",
  },
  plastilina: {
    nombre: "Plastilina",
    detalle: "Muñeco de stop motion",
    prompt: "claymation character, handmade plasticine texture, stop-motion animation look",
  },
  // Los dos que siguen adaptan prompts de la galería de OpenDesign (nexu-io/open-design,
  // prompt-templates/image, CC-BY-4.0): «Hyper-Realistic Selfie Texture Prompts» de Adrian Solarz y
  // «Monochrome Studio Portrait» de K (YouMind-OpenLab/awesome-gpt-image-2). Sin el encuadre casual ni la
  // pose del original: el avatar necesita la cara de frente (ENCUADRE_AVATAR). Atribución en NOTICE.
  natural: {
    nombre: "Foto de celular",
    detalle: "Natural, que no parece IA",
    prompt: "candid smartphone photo, realistic skin texture, visible pores around nose and cheeks, natural slight unevenness, no filter, no retouching, filmed in a real environment",
    luz: "soft natural window light from the side, natural indoor lighting, no harsh highlights",
  },
  "blanco-negro": {
    nombre: "Blanco y negro",
    detalle: "Retrato de estudio elegante",
    prompt: "black and white studio portrait photograph, high-end commercial monochrome photography, rich tonal range, fine texture detail, sharp focus",
    luz: "soft but dramatic directional studio light from the left",
  },
} as const;
export type Estilo = keyof typeof ESTILOS;
export const EstiloZ = z.enum(Object.keys(ESTILOS) as [Estilo, ...Estilo[]]);

export const FONDOS = {
  liso: { nombre: "Liso", prompt: "plain softly blurred neutral background" },
  estudio: { nombre: "Estudio", prompt: "softly lit studio background with subtle gradient" },
  oficina: { nombre: "Oficina", prompt: "blurred modern office in the background" },
  casa: { nombre: "Casa", prompt: "blurred cozy living room in the background" },
  exterior: { nombre: "Al aire libre", prompt: "blurred outdoor park in the background, daylight" },
} as const;
export type Fondo = keyof typeof FONDOS;
export const FondoZ = z.enum(Object.keys(FONDOS) as [Fondo, ...Fondo[]]);

/**
 * Lo que necesita InfiniteTalk para que la boca se mueva bien: la cara de frente, mirando a cámara, boca
 * cerrada y relajada (el modelo la abre), hombros a la vista y nada tapando la cara.
 */
export const ENCUADRE_AVATAR =
  "head and shoulders portrait, centered, facing the camera, looking straight at the viewer, mouth closed and relaxed, " +
  "neutral friendly expression, both eyes visible, face fully visible and unobstructed, no hands near the face, no text, no watermark";

export const Pedido = z.object({
  descripcion: z.string().trim().max(MAX_DESCRIPCION).default(""),
  estilo: EstiloZ.default("realista"),
  fondo: FondoZ.default("liso"),
  luz: z.enum(Object.keys(LUCES) as [keyof typeof LUCES, ...(keyof typeof LUCES)[]]).optional(),
  look: z.enum(Object.keys(LOOKS) as [keyof typeof LOOKS, ...(keyof typeof LOOKS)[]]).optional(),
  semilla: z.number().int().min(0).max(2147483647).optional(),
});
export type Pedido = z.infer<typeof Pedido>;

/** Prompt del retrato (función pura). */
export function promptRetrato(p: Pedido): string {
  const e = ESTILOS[p.estilo];
  const partes = [
    e.prompt,
    p.descripcion.trim(),
    ENCUADRE_AVATAR,
    FONDOS[p.fondo].prompt,
    p.luz ? LUCES[p.luz] : "luz" in e ? e.luz : "soft even studio lighting",
    p.look ? LOOKS[p.look] : "",
  ];
  return partes.filter(Boolean).join(". ");
}

/** Instrucción para Qwen Edit cuando el avatar sale de una foto (función pura). */
export function promptDesdeFoto(p: Pedido): string {
  const estilo =
    p.estilo === "realista"
      ? "Keep the person photorealistic and keep their face, identity, age and features exactly the same"
      : `Turn the person in the picture into a ${ESTILOS[p.estilo].prompt}, keeping their recognizable features, hairstyle and identity`;
  return [estilo, p.descripcion.trim(), `Reframe as a ${ENCUADRE_AVATAR}`, `Replace the background with a ${FONDOS[p.fondo].prompt}`, p.luz ? LUCES[p.luz] : "", p.look ? LOOKS[p.look] : ""]
    .filter(Boolean)
    .join(". ");
}

/** Instrucción de retoque: lo que pide la persona, conservando la cara y el encuadre (función pura). */
/** La instrucción toca la boca: entonces no se pide «boca cerrada» (chocaría con «que se le vean los dientes»). */
const TOCA_BOCA = /\b(boca|dientes?|muelas?|sonr\p{L}*|r[ií]e|re[ií]r|risa|labios?|lengua|beso|smil\p{L}*|teeth|tooth|mouth|lips?|laugh\p{L}*)\b/iu;
/**
 * Pedidos de «más calidad» («4k», «máxima calidad», «HD»): un modelo de edición no sube la resolución, y
 * pedírselo lo hace redibujar todo encima de lo anterior (salía la imagen doble). Se cambian por nitidez.
 */
const CALIDAD = /\b(4k|8k|ultra ?hd|full ?hd|hd|alta (?:resoluci[oó]n|calidad|definici[oó]n)|(?:m[aá]xima|mejor|m[aá]s|buena) (?:calidad|resoluci[oó]n|definici[oó]n)|calid[a]?d)\b/giu;

/**
 * Prompt del retoque (función pura). La instrucción de la persona va tal cual (Qwen entiende español);
 * alrededor, lo que tiene que conservarse. Todo en positivo: con 4 pasos y guía 1 no hay prompt negativo,
 * y nombrar un defecto («sin doble imagen») tiende a provocarlo.
 */
export function promptRetoque(instruccion: string): string {
  const original = instruccion.trim();
  const pideCalidad = CALIDAD.test(original);
  CALIDAD.lastIndex = 0;
  let limpia = original.replace(CALIDAD, " ").replace(/\s+([,.;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // Lo que queda colgando al quitar «… y sea 4k» o «en alta calidad»: conectores sueltos al final o al inicio.
  for (let antes = ""; antes !== limpia; ) {
    antes = limpia;
    limpia = limpia.replace(/^[\s,.;:]+|[\s,.;:]+$/g, "").replace(/\s+(?:y|e|que|sea|est[eé]|quede|se vea|en|con|a|de|un|una|la|el)$/iu, "").replace(/^(?:y|e)\s+/iu, "");
  }
  const partes: string[] = [];
  // «hazlo en HD» → «hazlo»: si sólo pedía calidad, lo que sobra no es una instrucción.
  const palabras = limpia.split(/\s+/).filter(Boolean).length;
  if (limpia.length >= 3 && (!pideCalidad || palabras >= 3)) partes.push(`${limpia}.`);
  if (pideCalidad) partes.push("Make the lines, edges and details sharper and cleaner.");
  if (!partes.length) partes.push("Make the lines, edges and details sharper and cleaner.");
  partes.push(
    "Keep the same character, face, identity, art style, colors and proportions.",
    "Keep the exact same framing, zoom level, position and camera angle.",
    "Output one single clean image of the character.",
  );
  partes.push(TOCA_BOCA.test(original) ? "Facing the camera." : "Keep the mouth closed and relaxed, facing the camera.");
  return partes.join(" ");
}

const semillaDe = (s?: number) => (s !== undefined && s >= 0 ? Math.round(s) : Math.floor(Math.random() * 2147483647));

export function ajustesRetratos(p: Pedido, cantidad = TOMAS): AjustesWan2gp {
  if (!p.descripcion.trim()) throw new Error("Describe a tu avatar: cómo es, qué edad tiene, cómo se viste…");
  return {
    model_type: MODELO_RETRATO,
    image_mode: 1,
    prompt: promptRetrato(p),
    resolution: RESOLUCION_RETRATO,
    batch_size: cantidad,
    seed: semillaDe(p.semilla),
  };
}

/** Qwen Edit con una o varias imágenes de referencia (la primera es el sujeto principal). */
export function ajustesEdicion(prompt: string, referencias: string[], semilla?: number, cantidad = 1): AjustesWan2gp {
  if (!referencias.length) throw new Error("Falta la imagen de referencia");
  return {
    model_type: MODELO_RETOQUE,
    image_mode: 1,
    prompt,
    resolution: RESOLUCION_RETRATO,
    video_prompt_type: "KI",
    image_refs: referencias,
    batch_size: cantidad,
    activated_loras: [LORA_RETOQUE],
    loras_multipliers: "1",
    num_inference_steps: 4,
    guidance_scale: 1,
    seed: semillaDe(semilla),
  };
}

// ---------------------------------------------------------------------------------------------------
// Biblioteca

export const Version = z.object({ archivo: z.string(), nota: z.string(), fecha: z.string() });

/** La voz con la que habla el avatar: una de Kokoro o una diseñada de la biblioteca (voces.ts). */
export const VozAvatar = z.object({ motor: z.enum(["kokoro", "voxcpm"]), voz: z.string().min(1).max(80), nombre: z.string().min(1).max(60) });
export type VozAvatar = z.infer<typeof VozAvatar>;

export const Avatar = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  nombre: z.string().min(1).max(60),
  descripcion: z.string().max(MAX_DESCRIPCION),
  estilo: EstiloZ,
  origen: z.enum(["descripcion", "foto"]),
  /** Con foto: lo que confirmó la persona, palabra por palabra, y cuándo. */
  consentimiento: z.object({ texto: z.string(), fecha: z.string() }).optional(),
  voz: VozAvatar.optional(),
  /** Retratos anteriores (el actual es retrato.png), del más viejo al más nuevo. */
  versiones: z.array(Version).default([]),
  /** Retoque hecho que espera que la persona elija una opción (o se quede con el actual). */
  retoque: z.object({ corrida: z.string().regex(/^[0-9A-Za-z-]+$/), nota: z.string(), tomas: z.array(z.string().regex(/^toma-\d+\.png$/)), fecha: z.string() }).optional(),
  creado: z.string(),
  actualizado: z.string(),
  licencia: z.string(),
});
export type Avatar = z.infer<typeof Avatar>;

export const dirAvatares = () => path.join(dirDatos(), "avatares");
export const dirAvatar = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Avatar inválido");
  return path.join(dirAvatares(), id);
};
const dirPropuesta = (id: string) => {
  if (!/^[a-z0-9]+$/.test(id)) throw new Error("Propuesta inválida");
  return path.join(dirAvatares(), "_propuestas", id);
};
/** Ruta relativa a ~/geeper-data (para /api/archivos). */
export const relativaADatos = (abs: string) => path.relative(dirDatos(), abs).split(path.sep).join("/");
export const rutaRetrato = (id: string) => path.join(dirAvatar(id), "retrato.png");

export const TEXTO_CONSENTIMIENTO =
  "La persona de la foto soy yo, o tengo su permiso por escrito para crear un avatar con su cara y usarlo en videos.";

export const nuevaPropuesta = () => randomBytes(6).toString("hex");

/** «Doctora Sofía» → «doctora-sofia-3fa2». */
export function idDeAvatar(nombre: string, sufijo = randomBytes(2).toString("hex")): string {
  const base = nombre
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "avatar"}-${sufijo}`;
}

export async function listarAvatares(): Promise<Avatar[]> {
  let entradas: string[] = [];
  try {
    entradas = await fs.readdir(dirAvatares());
  } catch {
    return [];
  }
  const out: Avatar[] = [];
  for (const e of entradas) {
    if (e.startsWith("_")) continue;
    try {
      out.push(Avatar.parse(JSON.parse(await fs.readFile(path.join(dirAvatares(), e, "avatar.json"), "utf8"))));
    } catch {
      /* carpeta ajena o a medio escribir */
    }
  }
  return out.sort((a, b) => b.actualizado.localeCompare(a.actualizado));
}

export async function leerAvatar(id: string): Promise<Avatar> {
  try {
    return Avatar.parse(JSON.parse(await fs.readFile(path.join(dirAvatar(id), "avatar.json"), "utf8")));
  } catch {
    throw new Error(`El avatar «${id}» ya no está en la biblioteca: elige otro.`);
  }
}

async function escribirAvatar(a: Avatar) {
  const dir = dirAvatar(a.id);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `avatar.json.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(Avatar.parse(a), null, 2));
  await fs.rename(tmp, path.join(dir, "avatar.json"));
}

export interface PedidoPropuesta {
  pedido: Pedido;
  /** Ruta absoluta de la foto subida (avatar desde una foto). */
  foto?: string;
  consentimiento?: { texto: string; fecha: string };
}

export interface Propuesta extends PedidoPropuesta {
  id: string;
  tomas: string[];
  creada: string;
}

/** Guarda lo pedido antes de encolar (la foto se copia a la propuesta). */
export async function crearPropuesta(p: PedidoPropuesta): Promise<string> {
  if (p.foto && !p.consentimiento) throw new Error("Para usar una foto, confirma que es tuya o que tienes permiso de la persona.");
  if (!p.foto && !p.pedido.descripcion.trim()) throw new Error("Describe a tu avatar o sube una foto.");
  const id = nuevaPropuesta();
  const dir = dirPropuesta(id);
  await fs.mkdir(dir, { recursive: true });
  let foto: string | undefined;
  if (p.foto) {
    foto = path.join(dir, `foto${path.extname(p.foto).toLowerCase() || ".png"}`);
    await fs.copyFile(p.foto, foto);
  }
  await fs.writeFile(path.join(dir, "pedido.json"), JSON.stringify({ ...p, foto, creada: new Date().toISOString() }, null, 2));
  return id;
}

export async function leerPropuesta(id: string): Promise<Propuesta | null> {
  let dir: string;
  try {
    dir = dirPropuesta(id);
  } catch {
    return null;
  }
  try {
    const base = JSON.parse(await fs.readFile(path.join(dir, "pedido.json"), "utf8")) as PedidoPropuesta & { creada: string };
    const tomas = (await fs.readdir(dir)).filter((f) => /^toma-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    return { ...base, pedido: Pedido.parse(base.pedido), id, tomas: tomas.map((t) => relativaADatos(path.join(dir, t))) };
  } catch {
    return null;
  }
}

export interface ContextoAvatar extends Contexto {
  signal?: AbortSignal;
  alAvanzar?: (a: Avance) => void;
}

/** Copia las imágenes de Wan2GP como toma-1.png, toma-2.png… (en PNG aunque Wan2GP guarde otro formato). */
async function guardarTomas(imagenes: string[], dir: string, desde: number): Promise<void> {
  for (const [k, img] of imagenes.entries()) {
    const destino = path.join(dir, `toma-${desde + k}.png`);
    if (path.extname(img).toLowerCase() === ".png") await fs.copyFile(img, destino);
    else await correr(FFMPEG, ["-v", "error", "-y", "-i", img, destino]);
  }
}

function ajustesDePropuesta(pr: Propuesta): AjustesWan2gp {
  if (pr.foto) return ajustesEdicion(promptDesdeFoto(pr.pedido), [pr.foto], pr.pedido.semilla, 2);
  return ajustesRetratos(pr.pedido);
}

/** Genera las tomas de una propuesta (usa toda la GPU). Con foto salen 2; desde una descripción, 4. */
export async function generarPropuesta(ctx: ContextoAvatar, id: string): Promise<{ tomas: string[] }> {
  const pr = await leerPropuesta(id);
  if (!pr) throw new Error("Esa propuesta de avatar ya no existe: vuelve a describirlo.");
  const dir = dirPropuesta(id);
  const ajustes = ajustesDePropuesta(pr);
  ctx.log(`Avatar: ${ajustes.model_type}, ${ajustes.batch_size} tomas. Prompt: ${ajustes.prompt}`);
  const imagenes = await generarImagenes({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: path.join(dir, "wan2gp", new Date().toISOString().replace(/[:.]/g, "-")), signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  await guardarTomas(imagenes, dir, pr.tomas.length + 1);
  return { tomas: (await leerPropuesta(id))!.tomas };
}

/** Valida los ajustes de una propuesta con `wgp.py --dry-run` (sin GPU). */
export async function probarPropuesta(id: string) {
  const pr = await leerPropuesta(id);
  if (!pr) throw new Error("Esa propuesta de avatar ya no existe.");
  return probarWan2gp(instalacionWan2gp(), ajustesDePropuesta(pr), path.join(dirPropuesta(id), "prueba"));
}

/** Guarda una toma de la propuesta como avatar nuevo de la biblioteca. */
export async function guardarAvatar(propuesta: string, toma: number, nombre: string, voz?: VozAvatar): Promise<Avatar> {
  const pr = await leerPropuesta(propuesta);
  if (!pr) throw new Error("Esa propuesta ya no existe: vuelve a crear el avatar.");
  const archivo = path.join(dirPropuesta(propuesta), `toma-${toma}.png`);
  if (!existsSync(archivo)) throw new Error("Esa toma no existe.");
  const ahora = new Date().toISOString();
  const a: Avatar = {
    id: idDeAvatar(nombre),
    nombre: nombre.trim(),
    descripcion: pr.pedido.descripcion,
    estilo: pr.pedido.estilo,
    origen: pr.foto ? "foto" : "descripcion",
    consentimiento: pr.consentimiento,
    voz,
    versiones: [],
    creado: ahora,
    actualizado: ahora,
    licencia: pr.foto ? `foto propia o con permiso («${pr.consentimiento?.texto ?? ""}», ${pr.consentimiento?.fecha ?? ""}); ${LICENCIA_RETOQUE}` : LICENCIA_RETRATO,
  };
  await fs.mkdir(dirAvatar(a.id), { recursive: true });
  await fs.copyFile(archivo, rutaRetrato(a.id));
  if (pr.foto) await fs.copyFile(pr.foto, path.join(dirAvatar(a.id), `foto-original${path.extname(pr.foto)}`));
  await escribirAvatar(a);
  return a;
}

/** Opciones que deja cada retoque: se elige mirando, como los retratos (un mal resultado no pisa el actual). */
export const OPCIONES_RETOQUE = 2;

const dirRetoque = (id: string, corrida: string) => {
  if (!/^[0-9A-Za-z-]+$/.test(corrida)) throw new Error("Retoque inválido");
  return path.join(dirAvatar(id), "_retoques", corrida);
};

/**
 * Retoca el retrato con una instrucción: deja OPCIONES_RETOQUE opciones en `avatar.retoque` y NO cambia
 * el retrato; la persona elige una (elegirRetoque) o se queda con el actual. Un retoque nuevo reemplaza
 * al que esperaba.
 */
export async function retocarAvatar(ctx: ContextoAvatar, id: string, instruccion: string, semilla?: number): Promise<Avatar> {
  const a = await leerAvatar(id);
  const texto = instruccion.trim();
  if (texto.length < 3) throw new Error("Escribe qué quieres cambiar («ponle lentes», «que sonría»…).");
  const corrida = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = dirRetoque(id, corrida);
  const ajustes = ajustesEdicion(promptRetoque(texto), [rutaRetrato(id)], semilla, OPCIONES_RETOQUE);
  ctx.log(`Retoque de «${a.nombre}»: ${texto}`);
  ctx.log(`Prompt: ${ajustes.prompt}`);
  const imgs = await generarImagenes({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: dir, signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  if (!imgs.length) throw new Error("Wan2GP terminó sin dejar ninguna imagen del retoque.");
  await guardarTomas(imgs, dir, 1);
  if (a.retoque) await fs.rm(dirRetoque(id, a.retoque.corrida), { recursive: true, force: true });
  const nuevo: Avatar = {
    ...(await leerAvatar(id)),
    retoque: { corrida, nota: texto, tomas: imgs.map((_, k) => `toma-${k + 1}.png`), fecha: new Date().toISOString() },
  };
  await escribirAvatar(nuevo);
  return nuevo;
}

/**
 * Decide el retoque que espera: `toma` (1, 2…) pasa a ser el retrato y el anterior queda en las versiones
 * (se puede deshacer); `null` lo descarta y el retrato no cambia.
 */
export async function elegirRetoque(id: string, toma: number | null): Promise<Avatar> {
  const a = await leerAvatar(id);
  const r = a.retoque;
  if (!r) throw new Error("Este avatar no tiene un retoque esperando.");
  const dir = dirRetoque(id, r.corrida);
  const { retoque: _, ...sin } = a;
  void _;
  let nuevo: Avatar = { ...sin, actualizado: new Date().toISOString() };
  if (toma !== null) {
    const archivo = r.tomas[toma - 1];
    if (!archivo || !existsSync(path.join(dir, archivo))) throw new Error("Esa opción ya no existe: retócalo otra vez.");
    const anterior = `version-${a.versiones.length + 1}.png`;
    await fs.copyFile(rutaRetrato(id), path.join(dirAvatar(id), anterior));
    await fs.copyFile(path.join(dir, archivo), rutaRetrato(id));
    nuevo = {
      ...nuevo,
      versiones: [...a.versiones, { archivo: anterior, nota: r.nota, fecha: nuevo.actualizado }],
      licencia: a.licencia.includes("Qwen-Image-Edit") ? a.licencia : `${a.licencia}; retocado: ${LICENCIA_RETOQUE}`,
    };
  }
  await escribirAvatar(nuevo);
  await fs.rm(dir, { recursive: true, force: true });
  return nuevo;
}

/** Vuelve al retrato anterior al último retoque (el actual se descarta). */
export async function deshacerRetoque(id: string): Promise<Avatar> {
  const a = await leerAvatar(id);
  const ultima = a.versiones.at(-1);
  if (!ultima) throw new Error("Este avatar no tiene retoques para deshacer.");
  await fs.copyFile(path.join(dirAvatar(id), ultima.archivo), rutaRetrato(id));
  await fs.rm(path.join(dirAvatar(id), ultima.archivo), { force: true });
  const nuevo = { ...a, versiones: a.versiones.slice(0, -1), actualizado: new Date().toISOString() };
  await escribirAvatar(nuevo);
  return nuevo;
}

export async function renombrarAvatar(id: string, nombre: string): Promise<Avatar> {
  const a = await leerAvatar(id);
  const n = nombre.trim();
  if (!n || n.length > 60) throw new Error("El nombre debe tener entre 1 y 60 letras.");
  const nuevo = { ...a, nombre: n, actualizado: new Date().toISOString() };
  await escribirAvatar(nuevo);
  return nuevo;
}

export async function cambiarVozAvatar(id: string, voz: VozAvatar | null): Promise<Avatar> {
  const a = await leerAvatar(id);
  const nuevo: Avatar = { ...a, actualizado: new Date().toISOString() };
  if (voz) nuevo.voz = VozAvatar.parse(voz);
  else delete nuevo.voz;
  await escribirAvatar(nuevo);
  return nuevo;
}

/** Borra el avatar de la biblioteca. Los videos que ya lo usan no cambian (tienen su copia). */
export async function borrarAvatar(id: string): Promise<void> {
  await leerAvatar(id);
  await fs.rm(dirAvatar(id), { recursive: true, force: true });
}

/** Para la UI: rutas servibles por /api/archivos. */
export function vistaAvatar(a: Avatar) {
  const v = encodeURIComponent(a.actualizado);
  return {
    ...a,
    retrato: `/api/archivos/${relativaADatos(rutaRetrato(a.id))}?v=${v}`,
    estiloNombre: ESTILOS[a.estilo].nombre,
    puedeDeshacer: a.versiones.length > 0,
    retoque: a.retoque
      ? { nota: a.retoque.nota, opciones: a.retoque.tomas.map((t) => `/api/archivos/${relativaADatos(path.join(dirRetoque(a.id, a.retoque!.corrida), t))}?v=${v}`) }
      : null,
  };
}
