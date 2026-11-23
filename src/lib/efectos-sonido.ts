/**
 * Efectos de sonido generados (BRECHAS G3) con MOSS-SoundEffect v2.0 (OpenMOSS, Apache-2.0: código y
 * pesos; idea tomada del inventario de VoiceStudio, HEREDADO.md). Cada efecto queda en una **biblioteca
 * compartida** (`~/geeper-data/efectos/`): la segunda vez que se pide el mismo sonido no se usa la GPU.
 *
 * Medido en la RTX 5080 (2026-11-20): carga 30–100 s; con la ventana de 10 s (py/efecto_sonido.py)
 * ~9 s por efecto de 2–8 s y pico de 14,5 GB de VRAM (con la de 30 s, ~40 s y 15,95 GB). Corre con `gpu-solo` (pausa Ollama y el servidor de imágenes de MPT mientras dura). El modelo
 * entiende inglés: una descripción propia se traduce antes con Gemma (que necesita Ollama encendido,
 * así que va primero). Varios sonidos van en un solo proceso (`generarEfectos`): el modelo se carga una vez
 * (GPU-05).
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
/**
 * Modelo para pasar la descripción al inglés: una frase corta no necesita el de 26b (3 min de carga en
 * frío); el de 12b carga en ~10 s (GPU-05). Se cambia con GEEPER_LLM_EFECTOS.
 */
export const MODELO_DESCRIBIR = process.env.GEEPER_LLM_EFECTOS ?? "gemma4:12b";

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
  const salida = await preguntarLlm(prompt, "Describir el sonido", ctx, { modelo: MODELO_DESCRIBIR });
  const m = salida.match(/\{[\s\S]*\}/);
  try {
    const p = (JSON.parse(m?.[0] ?? "{}") as { prompt?: unknown }).prompt;
    if (typeof p === "string" && p.trim()) return p.trim().slice(0, 300);
  } catch {
    /* abajo */
  }
  throw new Error("La IA no pudo describir el sonido en inglés: prueba con otras palabras.");
}

export interface PedidoEfecto {
  nombre: string;
  prompt: string;
  segundos: number;
}

/** Lo que MOSS imprime al terminar (py/efecto_sonido.py): carga, pico de VRAM y total. */
export interface MedidasMoss {
  cargado_s?: number;
  vram_pico_gb?: number;
  total_s?: number;
}

/** Corre MOSS con el pedido (JSON por stdin). Las pruebas pasan uno falso. */
export type CorrerMoss = (pedido: string, ctx: Contexto & { signal?: AbortSignal }) => Promise<{ codigo: number; stdout: string; stderr: string }>;

const correrMoss: CorrerMoss = async (pedido, ctx) => {
  const script = path.join(RAIZ_REPO, "py", "efecto_sonido.py");
  const env = { TORCHDYNAMO_DISABLE: "1", PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" };
  if (existsSync(GPU_SOLO_BIN)) {
    // gpu-solo toma el gpu-lock y pausa lo de MPT que ocupa VRAM: el modelo pide casi 16 GB.
    return correr(GPU_SOLO_BIN, [PYTHON_MOSS, "-I", script], { entrada: pedido, timeout: 1_800_000, signal: ctx.signal, permitirFallo: true, env });
  }
  const candado = await tomarGpu("efecto de sonido", { esperar: true, signal: ctx.signal });
  try {
    return await correr(PYTHON_MOSS, ["-I", script], { entrada: pedido, timeout: 1_800_000, signal: ctx.signal, permitirFallo: true, env });
  } finally {
    candado?.liberar();
  }
};

/** Las líneas JSON de MOSS con medidas, juntas (función pura). */
export function medidasMoss(stdout: string): MedidasMoss {
  const m: MedidasMoss = {};
  for (const l of stdout.split("\n")) {
    if (!l.startsWith("{")) continue;
    try {
      const d = JSON.parse(l) as Record<string, unknown>;
      for (const k of ["cargado_s", "vram_pico_gb", "total_s"] as const) if (typeof d[k] === "number") m[k] = d[k];
    } catch {
      /* no era JSON */
    }
  }
  return m;
}

/** Las rutas que MOSS confirmó en stdout (`{"salida": …}`, después de `sf.write`) (función pura). */
export function salidasConfirmadas(stdout: string): Set<string> {
  const hechas = new Set<string>();
  for (const l of stdout.split("\n")) {
    if (!l.startsWith("{")) continue;
    try {
      const j = JSON.parse(l) as { salida?: unknown };
      if (typeof j.salida === "string") hechas.add(j.salida);
    } catch {
      /* línea que no es JSON completo */
    }
  }
  return hechas;
}

/**
 * Genera (o reutiliza) varios efectos de la biblioteca con **una sola carga** del modelo (GPU-05): lo que ya
 * está no usa la tarjeta, y lo que falta va todo junto a un proceso de MOSS. Si alguno sale y otro no, se
 * guardan los que salieron y los demás quedan en `fallidos`; si no sale ninguno, lanza el error.
 */
export async function generarEfectos(
  ctx: Contexto & { signal?: AbortSignal },
  lista: readonly PedidoEfecto[],
  op: { correr?: CorrerMoss } = {},
): Promise<{ efectos: Efecto[]; generados: number; fallidos: string[]; medidas: MedidasMoss }> {
  const biblioteca = await listarEfectos();
  const efectos: Efecto[] = [];
  const pendientes: (PedidoEfecto & { id: string; tmp: string })[] = [];
  for (const o of lista) {
    const segundos = Math.min(30, Math.max(1, Math.round(o.segundos)));
    const id = idEfecto(o.prompt, segundos);
    const ya = biblioteca.find((e) => e.id === id);
    if (ya) {
      ctx.log(`Ese sonido ya estaba en la biblioteca (${ya.nombre}): no se usa la tarjeta gráfica.`);
      efectos.push(ya);
    } else if (!pendientes.some((p) => p.id === id)) pendientes.push({ ...o, segundos, id, tmp: `${rutaEfecto(id)}.tmp.wav` });
  }
  if (!pendientes.length) return { efectos, generados: 0, fallidos: [], medidas: {} };
  if (!efectosInstalados()) throw new Error("Los efectos de sonido no están instalados en esta computadora (falta MOSS-SoundEffect).");
  await fs.mkdir(dirEfectos(), { recursive: true });
  // Un .tmp.wav de un intento cancelado puede estar cortado (MOSS escribe directo): fuera antes de empezar.
  await Promise.all(pendientes.map((p) => fs.rm(p.tmp, { force: true })));
  const pedido = JSON.stringify(pendientes.map((p) => ({ prompt: p.prompt, segundos: p.segundos, semilla: 0, salida: p.tmp })));
  ctx.log(`Creando ${pendientes.length === 1 ? "el sonido" : `${pendientes.length} sonidos`}: cargar el modelo tarda 1–2 min y después ~10 s por efecto.`);
  const r = await (op.correr ?? correrMoss)(pedido, ctx);
  for (const l of r.stdout.split("\n")) if (l.startsWith("{")) ctx.log(l);
  const confirmados = salidasConfirmadas(r.stdout);
  const fallidos: string[] = [];
  let generados = 0;
  for (const p of pendientes) {
    // Sólo cuenta lo que MOSS dice que terminó de escribir: si murió a mitad, el archivo puede estar cortado.
    if (!confirmados.has(p.tmp) || !existsSync(p.tmp)) {
      await fs.rm(p.tmp, { force: true });
      fallidos.push(p.nombre);
      continue;
    }
    await fs.rename(p.tmp, rutaEfecto(p.id));
    const e: Efecto = { id: p.id, nombre: p.nombre.slice(0, 80), prompt: p.prompt, segundos: p.segundos, creado: new Date().toISOString(), licencia: LICENCIA_MOSS };
    await anotar(e);
    efectos.push(e);
    generados++;
  }
  if (!generados) {
    ctx.log(`Detalle del error: ${r.stderr.trim().split("\n").slice(-6).join(" | ").slice(0, 1200)}`);
    if (r.stderr.toLowerCase().includes("out of memory")) throw new Error("La tarjeta gráfica se quedó sin memoria: cierra juegos o programas que la usen y vuelve a intentar.");
    throw new Error(`No se pudo crear el sonido: ${r.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`);
  }
  if (fallidos.length) ctx.log(`No salieron: ${fallidos.join(", ")} (los demás quedaron en la biblioteca).`);
  return { efectos, generados, fallidos, medidas: medidasMoss(r.stdout) };
}

/** Genera (o reutiliza) un efecto de la biblioteca. */
export async function generarEfecto(ctx: Contexto & { signal?: AbortSignal }, o: PedidoEfecto, op: { correr?: CorrerMoss } = {}): Promise<Efecto> {
  const r = await generarEfectos(ctx, [o], op);
  return r.efectos[0]!;
}

/** Los sonidos listos que todavía no están en la biblioteca (para prepararlos de una vez). */
export async function presetsQueFaltan(): Promise<PedidoEfecto[]> {
  const ids = new Set((await listarEfectos()).map((e) => e.id));
  return PRESETS.filter((p) => !ids.has(idEfecto(p.prompt, p.segundos))).map(({ nombre, prompt, segundos }) => ({ nombre, prompt, segundos }));
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
