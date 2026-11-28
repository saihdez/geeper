/**
 * Imágenes con IA para una invitación (usan la tarjeta: van por la cola, `invitacion.foto` e `invitacion.qr`).
 *
 * - **QR artístico**: el QR se vuelve un dibujo del tema con ControlNet QR Code Monster v2
 *   (monster-labs/control_v1p_sd15_qrcode_monster, OpenRAIL++) sobre DreamShaper 8 (Lykon, CreativeML
 *   OpenRAIL-M), en el ComfyUI que instala Geeper y sólo con nodos que trae ComfyUI. La receta es la de
 *   `qr-arte` (~/dev/video-tools): img2img desde el propio QR (corrección H, negro sobre blanco), fuerza 1,35,
 *   ruido 0,9, DPM++ 2M Karras. Cada resultado se lee con jsQR a 4 tamaños y **sólo se guardan los que
 *   devuelven la dirección exacta**; los que se leen en más tamaños van primero.
 * - **Foto del sobre**: Z-Image Turbo (Apache-2.0) por Wan2GP, como los retratos de los avatares, 4 tomas.
 *
 * Las propuestas quedan en `invitaciones/<slug>/propuestas/` y la persona elige cuál usar.
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import jsQR from "jsqr";
import { encode } from "uqr";
import { escribirAtomico } from "../archivos";
import { arrancarComfyui, COMFYUI_DIR, faltaComfyui, PUERTO_TRABAJOS, salidasDeHistorial } from "../comfyui";
import { exigirEspacio } from "../espacio";
import { tomarGpu } from "../gpu";
import { correr } from "../proceso";
import { FFMPEG, GPU_SOLO_BIN } from "../rutas";
import { bajarModelo } from "../workflows";
import { generarImagenes, instalacionWan2gp, type AjustesWan2gp, type Avance } from "../wan2gp";
import { TIPOS_INFO } from "./catalogo";
import type { Invitacion } from "./esquema";

const ejecutar = promisify(execFile);

// ── Qué dibujar ──────────────────────────────────────────────────────────────────────────────────

/** Ilustración (en inglés: DreamShaper entiende inglés) de los temas sin IA y de las plantillas. */
const ARTE_POR_TEMA: Record<string, string> = {
  "Bosque encantado": "enchanted forest at night, glowing fireflies, moss, tiny mushrooms, magical golden light, detailed fantasy illustration",
  "Bajo el mar": "underwater coral reef, sea shells, bubbles, soft light rays, turquoise water, detailed illustration",
  "Noche de estrellas": "starry night sky, crescent moon, galaxy, constellations, deep blue and gold, detailed illustration",
  "Cuento de princesas": "fairytale castle, pink roses, golden crown, sparkles, storybook illustration",
  "Invierno mágico": "magical winter landscape, snowflakes, frosted pine trees, icy blue light, detailed illustration",
  "Jardín en flor": "blooming flower garden, roses and peonies, soft spring light, botanical illustration",
  "Otoño dorado": "autumn forest, golden and orange leaves, warm sunlight, detailed illustration",
  "Gala dorada": "art deco gold ornaments, black and gold, elegant geometric pattern, luxury",
  "Noche de brujas": "halloween night, pumpkins, crescent moon, bats, purple and orange, illustration",
  "Fiesta en el rancho": "western ranch, desert sunset, cactus, wooden barn, warm tones, illustration",
  Safari: "jungle safari, tropical leaves, acacia trees, golden light, illustration",
  "Fiesta de colores": "colorful balloons, confetti, party, bright cheerful cartoon illustration",
  "Amor eterno": "romantic pink roses, hearts, soft petals, dreamy light, illustration",
};
const ARTE_POR_PLANTILLA: Record<string, string> = {
  "vino-oro": "elegant burgundy roses and gold ornaments, wax seal, luxury stationery, detailed illustration",
  jardin: "soft sage green botanical garden, white flowers and leaves, watercolor illustration",
  minimal: "elegant black and gold abstract art, minimal, luxury",
};

/** Descripción (inglés) de la ilustración que va con el estilo de la invitación. */
export function arteDe(inv: Pick<Invitacion, "plantilla" | "tema" | "tipo">): string {
  if (inv.plantilla === "tema" && inv.tema) {
    if (inv.tema.imagen) return inv.tema.imagen;
    if (ARTE_POR_TEMA[inv.tema.nombre]) return ARTE_POR_TEMA[inv.tema.nombre]!;
    return `${inv.tema.idea || inv.tema.nombre}, ornamental illustration, beautiful, detailed`;
  }
  const id = inv.plantilla === "tema" ? TIPOS_INFO[inv.tipo].plantilla : inv.plantilla;
  return ARTE_POR_PLANTILLA[id]!;
}

// ── Propuestas en disco ──────────────────────────────────────────────────────────────────────────

export const NOMBRE_PROPUESTA = /^(foto-\d{13}-\d|qr-\d+-l[1-4])\.png$/;
const MAX_PROPUESTAS = 12;

export const dirPropuestas = (dirInvitacion: string) => path.join(dirInvitacion, "propuestas");

export interface Propuestas {
  fotos: string[];
  /** Los QR que escanean, primero los que se leen en más tamaños. */
  qrs: { archivo: string; lecturas: number }[];
}

export async function leerPropuestas(dirInvitacion: string): Promise<Propuestas> {
  const nombres = (await fs.readdir(dirPropuestas(dirInvitacion)).catch(() => [] as string[])).filter((n) => NOMBRE_PROPUESTA.test(n));
  const fecha = (n: string) => statSync(path.join(dirPropuestas(dirInvitacion), n), { throwIfNoEntry: false })?.mtimeMs ?? 0;
  const fotos = nombres.filter((n) => n.startsWith("foto-")).sort().reverse();
  const qrs = nombres.filter((n) => n.startsWith("qr-")).map((archivo) => ({ archivo, lecturas: Number(/-l(\d)\.png$/.exec(archivo)![1]), fecha: fecha(archivo) }))
    .sort((a, b) => b.fecha - a.fecha || b.lecturas - a.lecturas).map(({ archivo, lecturas }) => ({ archivo, lecturas }));
  return { fotos, qrs };
}

/** Deja sólo las últimas MAX_PROPUESTAS de cada clase. */
async function podar(dir: string, prefijo: "foto-" | "qr-") {
  const lista = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.startsWith(prefijo) && NOMBRE_PROPUESTA.test(n))
    .map((n) => ({ n, t: statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { n } of lista.slice(MAX_PROPUESTAS)) await fs.rm(path.join(dir, n), { force: true });
}

// ── Leer un QR ───────────────────────────────────────────────────────────────────────────────────

/** Tamaños a los que se prueba leer: los QR artísticos a veces sólo se leen chicos (como en un teléfono lejos). */
const LADOS_LECTURA = [768, 512, 384, 256] as const;

/** En cuántos de los 4 tamaños el QR de `ruta` devuelve exactamente `url` (0 = no sirve). */
export async function lecturasQr(ruta: string, url: string): Promise<number> {
  let ok = 0;
  for (const lado of LADOS_LECTURA) {
    const { stdout } = await ejecutar(FFMPEG, ["-v", "error", "-i", ruta, "-vf", `scale=${lado}:${lado}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { encoding: "buffer", maxBuffer: 1 << 26, windowsHide: true });
    const r = jsQR(new Uint8ClampedArray(stdout.buffer, stdout.byteOffset, stdout.length), lado, lado, { inversionAttempts: "attemptBoth" });
    if (r?.data === url) ok++;
  }
  return ok;
}

/** QR base: corrección H, negro sobre blanco, `borde` módulos de margen, cuadrado de `lado` px (PNG). */
export async function pngQrBase(url: string, destino: string, lado = 768, borde = 4): Promise<void> {
  const { data } = encode(url, { ecc: "H", border: borde });
  const n = data.length;
  const caja = Math.max(1, Math.floor(lado / n));
  const px = n * caja;
  const cuerpo = Buffer.alloc(px * px);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) cuerpo[y * px + x] = data[Math.floor(y / caja)]![Math.floor(x / caja)] ? 0 : 255;
  const pgm = Buffer.concat([Buffer.from(`P5\n${px} ${px}\n255\n`), cuerpo]);
  const tmp = `${destino}.pgm`;
  await fs.writeFile(tmp, pgm);
  try {
    await correr(FFMPEG, ["-v", "error", "-y", "-i", tmp, "-vf", `scale=${lado}:${lado}:flags=neighbor`, "-pix_fmt", "rgb24", destino]);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

// ── QR artístico con ComfyUI ─────────────────────────────────────────────────────────────────────

export const MODELOS_QR = [
  { carpeta: "checkpoints", nombre: "DreamShaper_8_pruned.safetensors", url: "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors", bytes: 2_132_625_894 },
  { carpeta: "controlnet", nombre: "control_v1p_sd15_qrcode_monster_v2.safetensors", url: "https://huggingface.co/monster-labs/control_v1p_sd15_qrcode_monster/resolve/main/v2/control_v1p_sd15_qrcode_monster_v2.safetensors", bytes: 722_596_344 },
] as const;

export const NEGATIVO_QR = "ugly, disfigured, low quality, blurry, nsfw, text, letters, watermark, signature, deformed, extra limbs, jpeg artifacts";

export interface PedidoQr {
  url: string;
  prompt: string;
  /** controlnet_conditioning_scale: más alto = se escanea mejor, menos dibujo (1,1-1,6). */
  fuerza?: number;
  /** denoise del img2img: más alto = más dibujo, menos QR (0,8-0,95). */
  ruido?: number;
  cantidad?: number;
  semilla?: number;
}

/** El grafo (formato API de ComfyUI) de la receta de qr-arte, sólo con nodos de fábrica. */
export function grafoQrArte(o: { imagen: string; prompt: string; semilla: number; cantidad: number; fuerza: number; ruido: number; prefijo: string; pasos?: number; cfg?: number }) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: MODELOS_QR[0].nombre } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: NEGATIVO_QR, clip: ["1", 1] } },
    "4": { class_type: "LoadImage", inputs: { image: o.imagen } },
    "5": { class_type: "ControlNetLoader", inputs: { control_net_name: MODELOS_QR[1].nombre } },
    "6": { class_type: "ControlNetApplyAdvanced", inputs: { positive: ["2", 0], negative: ["3", 0], control_net: ["5", 0], image: ["4", 0], strength: o.fuerza, start_percent: 0, end_percent: 1 } },
    "7": { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["1", 2] } },
    "8": { class_type: "RepeatLatentBatch", inputs: { samples: ["7", 0], amount: o.cantidad } },
    "9": { class_type: "KSampler", inputs: { model: ["1", 0], seed: o.semilla, steps: o.pasos ?? 30, cfg: o.cfg ?? 7, sampler_name: "dpmpp_2m", scheduler: "karras", positive: ["6", 0], negative: ["6", 1], latent_image: ["8", 0], denoise: o.ruido } },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: o.prefijo } },
  };
}

export interface ContextoImagen {
  log: (l: string) => void;
  avanzar: (etapa: string, avance: number) => void;
  signal?: AbortSignal;
}

/** Genera QR artísticos y guarda en `propuestas/` los que escanean. Devuelve cuántos salieron y cuántos sirven. */
export async function generarQrArte(ctx: ContextoImagen, dirInvitacion: string, p: PedidoQr): Promise<{ hechos: number; sirven: number }> {
  const falta = faltaComfyui();
  if (falta) throw new Error(`Para los QR con dibujo hace falta ComfyUI: instálalo con un clic en «Workflows» y vuelve a intentar. (${falta})`);
  const cantidad = p.cantidad ?? 6;
  const fuerza = p.fuerza ?? 1.35;
  const ruido = p.ruido ?? 0.9;
  const semilla = p.semilla ?? Math.floor(Math.random() * 2_000_000_000);

  // 1. Modelos (2,8 GB la primera vez).
  const faltan = MODELOS_QR.filter((m) => !existsSync(path.join(COMFYUI_DIR, "models", m.carpeta, m.nombre)));
  if (faltan.length) await exigirEspacio(path.join(COMFYUI_DIR, "models"), faltan.reduce((s, m) => s + m.bytes, 0), "bajar los modelos del QR con dibujo");
  for (const [k, m] of faltan.entries()) {
    ctx.log(`Bajando ${m.nombre}`);
    await bajarModelo(m.url, path.join(COMFYUI_DIR, "models", m.carpeta, m.nombre), (b, t) => ctx.avanzar(`Bajando el dibujante (${k + 1} de ${faltan.length}): ${(b / 1024 ** 3).toFixed(1)}${t ? ` de ${(t / 1024 ** 3).toFixed(1)}` : ""} GB`, 0.02 + 0.3 * ((k + (t ? b / t : 0)) / faltan.length)), ctx.signal);
  }

  // 2. El QR base en input/ (se comprueba que se lea antes de gastar la tarjeta).
  const id = `geeper-inv-${path.basename(dirInvitacion)}-${Date.now()}`;
  const base = path.join(COMFYUI_DIR, "input", `${id}.png`);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await pngQrBase(p.url, base);
  if (!(await lecturasQr(base, p.url))) throw new Error("El QR base no se pudo leer: revisa la dirección de la invitación.");

  // 3. ComfyUI con la tarjeta (mismo turno que los workflows: gpu-solo o el candado de gpu.ts).
  ctx.avanzar("Esperando la tarjeta de video", 0.33);
  const candado = existsSync(GPU_SOLO_BIN) ? null : await tomarGpu("QR con dibujo", { esperar: true, signal: ctx.signal, alEsperar: (q) => ctx.avanzar(`Esperando la tarjeta (la tiene: ${q.slice(0, 80)})`, 0.33) });
  const prompt = `${p.prompt}, masterpiece, best quality, highly detailed`;
  ctx.log(`QR con dibujo: ${cantidad} versiones, fuerza ${fuerza}, ruido ${ruido}, semilla ${semilla}. Prompt: ${prompt}`);
  let srv: Awaited<ReturnType<typeof arrancarComfyui>>;
  try {
    srv = await arrancarComfyui({
      puerto: PUERTO_TRABAJOS, signal: ctx.signal,
      log: (l) => {
        ctx.log(l);
        const m = l.match(/\|\s*(\d+)\/(\d+)\s*\[/);
        if (m) ctx.avanzar(`Dibujando el QR: paso ${m[1]} de ${m[2]}`, 0.4 + 0.5 * (Number(m[1]) / Math.max(1, Number(m[2]))));
      },
    });
  } catch (e) {
    candado?.liberar();
    throw e;
  }
  const cancelar = () => void srv.detener();
  ctx.signal?.addEventListener("abort", cancelar, { once: true });
  let historial: unknown = null;
  try {
    const grafo = grafoQrArte({ imagen: path.basename(base), prompt, semilla, cantidad, fuerza, ruido, prefijo: id });
    const r = await fetch(`${srv.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: grafo, client_id: id }) });
    const cuerpo = (await r.json().catch(() => ({}))) as { prompt_id?: string; error?: { message?: string } };
    if (!r.ok || !cuerpo.prompt_id) throw new Error(`ComfyUI no aceptó el QR con dibujo: ${cuerpo.error?.message ?? r.status}`);
    while (!historial) {
      if (ctx.signal?.aborted) throw new Error("Cancelado");
      if (srv.hijo.exitCode !== null) throw new Error("ComfyUI se cerró en medio del trabajo (¿sin memoria?). Mira el registro.");
      await new Promise((ok) => setTimeout(ok, 2000));
      const h = (await (await fetch(`${srv.url}/history/${cuerpo.prompt_id}`)).json().catch(() => ({}))) as Record<string, { status?: { status_str?: string; messages?: [string, { exception_message?: string }][] }; outputs?: unknown }>;
      const e = h[cuerpo.prompt_id];
      if (e?.status?.status_str === "error") {
        const ex = e.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message ?? "error";
        throw new Error(/out of memory/i.test(ex) ? "La tarjeta de video se quedó sin memoria." : `ComfyUI falló: ${ex.trim().split("\n").at(-1)}`);
      }
      if (e && (e.status?.status_str === "success" || e.outputs)) historial = e;
    }
  } finally {
    ctx.signal?.removeEventListener("abort", cancelar);
    await srv.detener();
    candado?.liberar();
    await fs.rm(base, { force: true });
  }

  // 4. Se leen todos y se guardan sólo los que escanean.
  ctx.avanzar("Probando que cada QR se pueda escanear", 0.95);
  const dir = dirPropuestas(dirInvitacion);
  await fs.mkdir(dir, { recursive: true });
  const salidas = salidasDeHistorial(historial);
  let sirven = 0;
  for (const [k, s] of salidas.entries()) {
    const origen = path.join(COMFYUI_DIR, s.carpeta, s.subcarpeta, s.archivo);
    if (!existsSync(origen)) continue;
    const lecturas = await lecturasQr(origen, p.url);
    ctx.log(`Versión ${k + 1}: ${lecturas ? `se lee en ${lecturas} de 4 tamaños` : "no se lee (descartada)"}`);
    if (lecturas) {
      await fs.copyFile(origen, path.join(dir, `qr-${semilla + k}-l${lecturas}.png`));
      sirven++;
    }
    await fs.rm(origen, { force: true });
  }
  await podar(dir, "qr-");
  if (!salidas.length) throw new Error("ComfyUI terminó pero no dejó imágenes.");
  if (!sirven) throw new Error("Ninguna de las versiones se pudo escanear. Prueba «Que se lea mejor»: el dibujo queda más suave y el QR más claro.");
  return { hechos: salidas.length, sirven };
}

// ── Foto del sobre con Z-Image ───────────────────────────────────────────────────────────────────

export const TOMAS_FOTO = 4;

/** Ajustes de Wan2GP para la foto del sobre: horizontal (como la carta), 4 tomas. */
export function ajustesFoto(descripcion: string, estilo: string, semilla = Math.floor(Math.random() * 2_147_483_647)): AjustesWan2gp {
  const d = descripcion.trim();
  return {
    model_type: "z_image",
    image_mode: 1,
    prompt: `${d ? `${d}. ` : ""}Style: ${estilo}. Beautiful invitation card illustration, soft light, high detail, no text, no letters, no watermark.`,
    resolution: "1216x832",
    batch_size: TOMAS_FOTO,
    seed: semilla,
  };
}

export async function generarFotos(ctx: ContextoImagen & { alAvanzar?: (a: Avance) => void }, dirInvitacion: string, ajustes: AjustesWan2gp): Promise<string[]> {
  ctx.log(`Foto del sobre: ${ajustes.model_type}, ${ajustes.batch_size} tomas. Prompt: ${ajustes.prompt}`);
  const corrida = path.join(dirInvitacion, "wan2gp", new Date().toISOString().replace(/[:.]/g, "-"));
  const imagenes = await generarImagenes({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: corrida, signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  if (!imagenes.length) throw new Error("No salió ninguna foto. Prueba con otra descripción.");
  const dir = dirPropuestas(dirInvitacion);
  await fs.mkdir(dir, { recursive: true });
  const t = Date.now();
  const nombres: string[] = [];
  for (const [k, img] of imagenes.slice(0, 9).entries()) {
    const nombre = `foto-${t}-${k + 1}.png`;
    await correr(FFMPEG, ["-v", "error", "-y", "-i", img, path.join(dir, nombre)]);
    nombres.push(nombre);
  }
  await fs.rm(corrida, { recursive: true, force: true });
  await podar(dir, "foto-");
  return nombres;
}

/** Guarda la elección como lo usa la invitación (foto.webp o qr.png). */
export async function copiarElegida(dirInvitacion: string, archivo: string, que: "foto" | "qr"): Promise<void> {
  if (!NOMBRE_PROPUESTA.test(archivo) || !archivo.startsWith(`${que}-`)) throw new Error("Esa propuesta no existe");
  const origen = path.join(dirPropuestas(dirInvitacion), archivo);
  if (!existsSync(origen)) throw new Error("Esa propuesta ya no está: crea otras.");
  if (que === "foto") {
    await correr(FFMPEG, ["-y", "-v", "error", "-i", origen, "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", "-c:v", "libwebp", "-quality", "82", path.join(dirInvitacion, "foto.webp")]);
  } else {
    await escribirAtomico(path.join(dirInvitacion, "qr-arte.png"), await fs.readFile(origen));
  }
}
