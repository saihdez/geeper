/**
 * Efectos de sonido generados (BRECHAS G3) con MOSS-SoundEffect v2.0 (OpenMOSS, Apache-2.0: código y
 * pesos; idea tomada del inventario de VoiceStudio, HEREDADO.md). Cada efecto queda en una **biblioteca
 * compartida** (`~/geeper-data/efectos/`): la segunda vez que se pide el mismo sonido no se usa la GPU.
 *
 * Medido en la RTX 5080 (2026-11-20): carga 30–100 s; con la ventana de 10 s (py/efecto_sonido.py)
 * ~9 s por efecto de 2–8 s y pico de 14,5 GB de VRAM (con la de 30 s, ~40 s y 15,95 GB). Corre con `gpu-solo` (pausa Ollama y el servidor de imágenes de MPT mientras dura). El modelo
 * entiende inglés: una descripción propia se traduce antes con Gemma (que necesita Ollama encendido,
 * así que va primero).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describirAsset } from "./almacen";
import { aplicarEdicion, registrarAsset } from "./ediciones";
import type { Proyecto } from "./esquema";
import { tomarGpu } from "./gpu";
import type { Contexto } from "./pasos";
import { pythonDeVenv } from "./plataforma";
import { correr } from "./proceso";
import { dirDatos, ESTUDIO, GPU_SOLO_BIN, RAIZ_REPO } from "./rutas";
import { preguntarLlm } from "./traducir";

export const PYTHON_MOSS = process.env.GEEPER_MOSS_PYTHON ?? pythonDeVenv(path.join(ESTUDIO, "venvs", "moss-sfx"));
export const LICENCIA_MOSS = "Apache-2.0 (OpenMOSS-Team/MOSS-SoundEffect-v2.0)";
export const PISTA_EFECTOS = "efectos";
export const VOLUMEN_EFECTO = 0.6;

/** Sonidos listos para elegir: nombre para la persona y descripción en inglés para el modelo. */
export const PRESETS = [
  { id: "whoosh", nombre: "Whoosh (para pasar de escena)", prompt: "A fast cinematic whoosh transition sound, air swoosh passing by", segundos: 2 },
  { id: "golpe", nombre: "Golpe (para un título)", prompt: "A single deep cinematic impact hit with a short reverb tail", segundos: 3 },
  { id: "pop", nombre: "Pop (para un texto que aparece)", prompt: "A short soft bubbly pop sound for a user interface notification", segundos: 1 },
  { id: "olas", nombre: "Olas del mar", prompt: "Ocean waves crashing against rocky cliffs, strong wind, distant seagulls", segundos: 8 },
  { id: "viento", nombre: "Viento fuerte", prompt: "Strong howling wind gusts on an open coast at night", segundos: 6 },
  { id: "lluvia", nombre: "Lluvia", prompt: "Steady rain falling on a roof with soft distant thunder", segundos: 8 },
  { id: "trueno", nombre: "Trueno", prompt: "A loud close thunder crack followed by a long rumble", segundos: 5 },
  { id: "campana", nombre: "Campana", prompt: "A single large bronze bell ringing once, long natural decay", segundos: 4 },
  { id: "reloj", nombre: "Tic-tac de reloj", prompt: "A mechanical clock ticking steadily in a quiet room", segundos: 4 },
  { id: "aplausos", nombre: "Aplausos", prompt: "An audience of about fifty people applauding enthusiastically", segundos: 4 },
  { id: "pasos", nombre: "Pasos", prompt: "Footsteps walking slowly on a wooden floor", segundos: 4 },
  { id: "teclado", nombre: "Teclado", prompt: "The crisp, rhythmic click-clack of fast typing on a mechanical keyboard", segundos: 4 },
] as const;

export const Efecto = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  nombre: z.string().min(1).max(80),
  prompt: z.string().min(1),
  segundos: z.number().min(1).max(30),
  creado: z.string(),
  licencia: z.string(),
});
export type Efecto = z.infer<typeof Efecto>;

export const dirEfectos = () => path.join(dirDatos(), "efectos");
const indice = () => path.join(dirEfectos(), "efectos.json");
export const rutaEfecto = (id: string) => path.join(dirEfectos(), `${id}.wav`);
export const efectosInstalados = () => existsSync(PYTHON_MOSS);

/** Mismo sonido pedido = mismo archivo (función pura). */
export function idEfecto(prompt: string, segundos: number): string {
  return "sfx-" + createHash("sha256").update(JSON.stringify({ prompt: prompt.trim().toLowerCase(), segundos, semilla: 0 })).digest("hex").slice(0, 12);
}

export async function listarEfectos(): Promise<Efecto[]> {
  try {
    const lista = z.array(Efecto).parse(JSON.parse(await fs.readFile(indice(), "utf8")));
    return lista.filter((e) => existsSync(rutaEfecto(e.id))).sort((a, b) => b.creado.localeCompare(a.creado));
  } catch {
    return [];
  }
}

async function anotar(e: Efecto): Promise<void> {
  const lista = (await listarEfectos()).filter((x) => x.id !== e.id);
  lista.push(e);
  await fs.mkdir(dirEfectos(), { recursive: true });
  await fs.writeFile(`${indice()}.tmp`, JSON.stringify(lista, null, 2));
  await fs.rename(`${indice()}.tmp`, indice());
}

/** «golpe metálico seco» → descripción en inglés para MOSS, con Gemma local. */
export async function describirEnIngles(descripcion: string, ctx: Contexto & { signal?: AbortSignal }): Promise<string> {
  const prompt = [
    "Rewrite this Spanish description of a sound effect as a short, concrete English prompt for a text-to-audio model.",
    "Describe only the sound (source, material, action, space, distance); no music unless asked; one sentence.",
    `Description: ${descripcion}`,
    'Answer only JSON: {"prompt": "…"}',
  ].join("\n");
  const salida = await preguntarLlm(prompt, "Describir el sonido", ctx);
  const m = salida.match(/\{[\s\S]*\}/);
  try {
    const p = (JSON.parse(m?.[0] ?? "{}") as { prompt?: unknown }).prompt;
    if (typeof p === "string" && p.trim()) return p.trim().slice(0, 300);
  } catch {
    /* abajo */
  }
  throw new Error("La IA no pudo describir el sonido en inglés: prueba con otras palabras.");
}

/** Genera (o reutiliza) un efecto de la biblioteca. */
export async function generarEfecto(ctx: Contexto & { signal?: AbortSignal }, o: { nombre: string; prompt: string; segundos: number }): Promise<Efecto> {
  const segundos = Math.min(30, Math.max(1, Math.round(o.segundos)));
  const id = idEfecto(o.prompt, segundos);
  const ya = (await listarEfectos()).find((e) => e.id === id);
  if (ya) {
    ctx.log(`Ese sonido ya estaba en la biblioteca (${ya.nombre}): no se usa la tarjeta gráfica.`);
    return ya;
  }
  if (!efectosInstalados()) throw new Error("Los efectos de sonido no están instalados en esta computadora (falta MOSS-SoundEffect).");
  await fs.mkdir(dirEfectos(), { recursive: true });
  const salida = rutaEfecto(id);
  const pedido = JSON.stringify([{ prompt: o.prompt, segundos, semilla: 0, salida: `${salida}.tmp.wav` }]);
  const script = path.join(RAIZ_REPO, "py", "efecto_sonido.py");
  const env = { TORCHDYNAMO_DISABLE: "1", PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" };
  ctx.log("Creando el sonido: cargar el modelo tarda 1–2 min y después ~10 s por efecto.");
  let r;
  if (existsSync(GPU_SOLO_BIN)) {
    // gpu-solo toma el gpu-lock y pausa lo de MPT que ocupa VRAM: el modelo pide casi 16 GB.
    r = await correr(GPU_SOLO_BIN, [PYTHON_MOSS, "-I", script], { entrada: pedido, timeout: 1_800_000, signal: ctx.signal, permitirFallo: true, env });
  } else {
    const candado = await tomarGpu("efecto de sonido", { esperar: true, signal: ctx.signal });
    try {
      r = await correr(PYTHON_MOSS, ["-I", script], { entrada: pedido, timeout: 1_800_000, signal: ctx.signal, permitirFallo: true, env });
    } finally {
      candado?.liberar();
    }
  }
  for (const l of r.stdout.split("\n")) if (l.startsWith("{")) ctx.log(l);
  if (r.codigo !== 0 || !existsSync(`${salida}.tmp.wav`)) {
    ctx.log(`Detalle del error: ${r.stderr.trim().split("\n").slice(-6).join(" | ").slice(0, 1200)}`);
    if (r.stderr.toLowerCase().includes("out of memory")) throw new Error("La tarjeta gráfica se quedó sin memoria: cierra juegos o programas que la usen y vuelve a intentar.");
    throw new Error(`No se pudo crear el sonido: ${r.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`);
  }
  await fs.rename(`${salida}.tmp.wav`, salida);
  const e: Efecto = { id, nombre: o.nombre.slice(0, 80), prompt: o.prompt, segundos, creado: new Date().toISOString(), licencia: LICENCIA_MOSS };
  await anotar(e);
  return e;
}

/** Copia el efecto al proyecto y lo pone en la pista «efectos» en `inicio` (no guarda). */
export async function agregarEfecto(dir: string, p: Proyecto, e: Efecto, inicio: number): Promise<Proyecto> {
  const ruta = `assets/${e.id}.wav`;
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  if (!existsSync(path.join(dir, ruta))) await fs.copyFile(rutaEfecto(e.id), path.join(dir, ruta));
  const asset = await describirAsset(dir, ruta, {
    id: e.id,
    tipo: "audio",
    source: "archivo",
    licencia: e.licencia,
    regenerar: { efecto: e.nombre, prompt: e.prompt, modelo: "moss-soundeffect-v2.0", biblioteca: `efectos/${e.id}.wav` },
  });
  return aplicarEdicion(registrarAsset(p, asset), { tipo: "agregarClipLibre", pista: PISTA_EFECTOS, asset: e.id, inicio: Math.max(0, inicio), desde: 0, volumen: VOLUMEN_EFECTO });
}
