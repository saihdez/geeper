/**
 * Biblioteca de voces (BRECHAS G2). Además de las voces fijas de Kokoro, una voz se puede **diseñar**
 * describiéndola en palabras con VoxCPM2 (Apache-2.0; ver MODELOS.md). Se generan varias tomas, la
 * persona elige la que le gusta y queda guardada en `~/geeper-data/voces/<id>/` con su muestra y la
 * transcripción. Desde ahí, cada frase se dice **clonando esa muestra**: el diseño por descripción
 * cambia de una corrida a otra, la clonación no (medido: misma voz, similitud 9/10).
 *
 * Sólo voces diseñadas: no se clona la voz de una persona real (eso pide su consentimiento escrito).
 * VoxCPM2 usa ~6 GB de la tarjeta gráfica: toma el gpu-lock y espera su turno.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tomarGpu } from "./gpu";
import type { Contexto } from "./pasos";
import { ESCRITORIO, pythonDeVenv } from "./plataforma";
import { correr } from "./proceso";
import { dirDatos, ESTUDIO, FFMPEG, RAIZ_REPO } from "./rutas";
import { sintetizar } from "./voz";

export const PYTHON_VOXCPM = process.env.GEEPER_VOXCPM_PYTHON ?? pythonDeVenv(path.join(ESTUDIO, "venvs", "voxcpm"));
/** Pesos de VoxCPM2 bajados por el instalador de la app (instalar-voxcpm.ts), con su revisión fijada. */
export const DIR_MODELO_VOXCPM = path.join(ESTUDIO, "modelos", "VoxCPM2");
/** Marca que deja el instalador cuando la prueba en la GPU salió bien. */
export const marcaVoxcpm = () => path.join(path.dirname(path.dirname(PYTHON_VOXCPM)), "geeper-listo.json");
export const LICENCIA_VOXCPM = "Apache-2.0 (openbmb/VoxCPM2)";
export const MAX_DESCRIPCION = 300;
export const TOMAS = 3;

/** Lo que dice cada toma al diseñar: también es la transcripción de la muestra para clonar. */
export const TEXTO_MUESTRA =
  "Hola, ésta es mi voz. Así sonaría la narración de tus videos: clara, cercana y con buen ritmo. Puedo contar una historia, explicar un dato curioso o presentar un producto.";

/** Voces fijas de Kokoro por idioma del proyecto (CPU, sin tarjeta gráfica); la letra inicial es el idioma. */
export const KOKORO: Record<string, { voz: string; nombre: string; detalle: string }[]> = {
  es: [
    { voz: "ef_dora", nombre: "Dora", detalle: "Mujer · la de siempre" },
    { voz: "em_alex", nombre: "Álex", detalle: "Hombre" },
    { voz: "em_santa", nombre: "Santa", detalle: "Hombre, grave" },
  ],
  en: [
    { voz: "af_heart", nombre: "Heart", detalle: "Mujer · inglés de EE. UU." },
    { voz: "af_bella", nombre: "Bella", detalle: "Mujer · inglés de EE. UU." },
    { voz: "am_michael", nombre: "Michael", detalle: "Hombre · inglés de EE. UU." },
    { voz: "bf_emma", nombre: "Emma", detalle: "Mujer · inglés británico" },
  ],
  pt: [
    { voz: "pf_dora", nombre: "Dora", detalle: "Mujer · portugués de Brasil" },
    { voz: "pm_alex", nombre: "Alex", detalle: "Hombre · portugués de Brasil" },
  ],
  fr: [{ voz: "ff_siwis", nombre: "Siwis", detalle: "Mujer · francés" }],
  it: [
    { voz: "if_sara", nombre: "Sara", detalle: "Mujer · italiano" },
    { voz: "im_nicola", nombre: "Nicola", detalle: "Hombre · italiano" },
  ],
};
export const KOKORO_ES = KOKORO.es!;
const IDIOMA_DE_LETRA: Record<string, string> = { e: "es", a: "en", b: "en", p: "pt", f: "fr", i: "it" };
/** Lo que dice la muestra de una voz de Kokoro, en su idioma. */
const MUESTRAS: Record<string, string> = {
  en: "Hi, this is my voice. This is how your videos would sound: clear, friendly and with a good pace.",
  pt: "Olá, esta é a minha voz. É assim que os seus vídeos soariam: claros, próximos e com um bom ritmo.",
  fr: "Bonjour, voici ma voix. Voilà comment sonneraient vos vidéos : claires, proches et bien rythmées.",
  it: "Ciao, questa è la mia voce. Ecco come suonerebbero i tuoi video: chiari, vicini e con un buon ritmo.",
};

export const VozGuardada = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  nombre: z.string().min(1).max(60),
  descripcion: z.string().max(MAX_DESCRIPCION),
  texto: z.string().min(1),
  creada: z.string(),
  licencia: z.string(),
});
export type VozGuardada = z.infer<typeof VozGuardada>;

export const dirVoces = () => path.join(dirDatos(), "voces");
const dirPropuesta = (id: string) => path.join(dirVoces(), "_propuestas", id);
/** Ruta relativa a ~/geeper-data (para /api/archivos). */
export const relativaADatos = (abs: string) => path.relative(dirDatos(), abs).split(path.sep).join("/");

/** En la app hace falta que el instalador haya terminado (modelo bajado y probado); en el estudio, el venv. */
export const vozInstalada = () => existsSync(PYTHON_VOXCPM) && (!ESCRITORIO || existsSync(marcaVoxcpm()));

/** «Narradora cálida» → «narradora-calida-3fa2» (función pura salvo el sufijo). */
export function idDeVoz(nombre: string, sufijo = randomBytes(2).toString("hex")): string {
  const base = nombre
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "voz"}-${sufijo}`;
}

export async function listarGuardadas(): Promise<VozGuardada[]> {
  let entradas: string[] = [];
  try {
    entradas = await fs.readdir(dirVoces());
  } catch {
    return [];
  }
  const out: VozGuardada[] = [];
  for (const e of entradas) {
    if (e.startsWith("_")) continue;
    try {
      out.push(VozGuardada.parse(JSON.parse(await fs.readFile(path.join(dirVoces(), e, "voz.json"), "utf8"))));
    } catch {
      /* carpeta ajena o a medio escribir */
    }
  }
  return out.sort((a, b) => b.creada.localeCompare(a.creada));
}

export async function leerVoz(id: string): Promise<VozGuardada & { referencia: string }> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Voz inválida");
  const dir = path.join(dirVoces(), id);
  try {
    const v = VozGuardada.parse(JSON.parse(await fs.readFile(path.join(dir, "voz.json"), "utf8")));
    return { ...v, referencia: path.join(dir, "referencia.wav") };
  } catch {
    throw new Error(`La voz «${id}» ya no está en la biblioteca: elige otra.`);
  }
}

/** Muestra de una voz de Kokoro (se genera una vez, en CPU). Devuelve la ruta absoluta. */
export async function muestraKokoro(voz: string): Promise<string> {
  const idioma = IDIOMA_DE_LETRA[voz.charAt(0)] ?? "";
  if (!KOKORO[idioma]?.some((k) => k.voz === voz)) throw new Error("Voz de Kokoro desconocida");
  const ruta = path.join(dirVoces(), "_kokoro", `${voz}.wav`);
  if (existsSync(ruta)) return ruta;
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  await sintetizar(MUESTRAS[idioma] ?? TEXTO_MUESTRA, voz, 0.9, `${ruta}.tmp.wav`, () => {});
  await fs.rename(`${ruta}.tmp.wav`, ruta);
  return ruta;
}

async function correrVoxcpm(pedido: Record<string, unknown>, ctx: Pick<Contexto, "log"> & { signal?: AbortSignal }, que: string, probando = false): Promise<void> {
  if (!(probando ? existsSync(PYTHON_VOXCPM) : vozInstalada())) throw new Error("Las voces diseñadas no están instaladas en esta computadora (falta VoxCPM2).");
  ctx.log(`${que}: esperando la tarjeta gráfica…`);
  const candado = await tomarGpu(`voz ${que}`, {
    esperar: true,
    signal: ctx.signal,
    alEsperar: () => ctx.log("La tarjeta gráfica está ocupada con otro video; la voz espera su turno y sigue sola."),
  });
  try {
    ctx.log(`${que}: cargando VoxCPM2 (la primera vez tarda 1–2 min)…`);
    const r = await correr(PYTHON_VOXCPM, ["-I", path.join(RAIZ_REPO, "py", "voz_voxcpm.py")], {
      entrada: JSON.stringify(pedido),
      timeout: 1_200_000,
      signal: ctx.signal,
      permitirFallo: true,
      env: {
        TORCHDYNAMO_DISABLE: "1",
        PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True",
        // El modelo que bajó el instalador (revisión fijada); en el estudio de desarrollo, la caché de HF.
        ...(existsSync(path.join(DIR_MODELO_VOXCPM, "model.safetensors")) ? { GEEPER_VOXCPM: DIR_MODELO_VOXCPM } : {}),
      },
    });
    for (const l of r.stdout.split("\n")) if (l.startsWith("{")) ctx.log(l);
    if (r.codigo !== 0) {
      const err = r.stderr.toLowerCase();
      if (err.includes("out of memory")) throw new Error("La tarjeta gráfica se quedó sin memoria: cierra otros programas que la usen y vuelve a intentar.");
      throw new Error(`VoxCPM2 falló: ${r.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`);
    }
  } finally {
    candado?.liberar();
  }
}

/** Genera `TOMAS` voces que cumplen la descripción. Devuelve el id de la propuesta. */
export async function disenarVoz(ctx: Contexto & { signal?: AbortSignal }, propuesta: string, descripcion: string): Promise<{ tomas: string[] }> {
  const dir = dirPropuesta(propuesta);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "pedido.json"), JSON.stringify({ descripcion, creada: new Date().toISOString() }));
  await correrVoxcpm({ modo: "disenar", descripcion, texto: TEXTO_MUESTRA, tomas: TOMAS, salida: dir }, ctx, "Diseñar voz");
  const tomas = (await fs.readdir(dir)).filter((f) => /^toma-\d+\.wav$/.test(f)).sort();
  if (!tomas.length) throw new Error("VoxCPM2 no dejó ninguna toma.");
  return { tomas: tomas.map((t) => relativaADatos(path.join(dir, t))) };
}

/** Prueba de la instalación: una toma corta en la GPU (carga el modelo y genera de verdad). */
export async function probarVoxcpm(log: Contexto["log"], dir: string): Promise<void> {
  await correrVoxcpm({ modo: "disenar", descripcion: "voz cálida y clara", texto: "Hola, ésta es una prueba.", tomas: 1, salida: dir }, { log }, "Prueba de voz", true);
  if (!existsSync(path.join(dir, "toma-1.wav"))) throw new Error("VoxCPM2 terminó sin dejar el audio de prueba.");
}

export async function leerPropuesta(propuesta: string): Promise<{ descripcion: string; tomas: string[] } | null> {
  if (!/^[a-z0-9]+$/.test(propuesta)) return null;
  const dir = dirPropuesta(propuesta);
  try {
    const { descripcion } = JSON.parse(await fs.readFile(path.join(dir, "pedido.json"), "utf8")) as { descripcion: string };
    const tomas = (await fs.readdir(dir)).filter((f) => /^toma-\d+\.wav$/.test(f)).sort();
    return { descripcion, tomas: tomas.map((t) => relativaADatos(path.join(dir, t))) };
  } catch {
    return null;
  }
}

/** Guarda una toma como voz de la biblioteca. */
export async function guardarVoz(propuesta: string, toma: number, nombre: string): Promise<VozGuardada> {
  const p = await leerPropuesta(propuesta);
  if (!p) throw new Error("Esa propuesta de voz ya no existe: diseña la voz otra vez.");
  const archivo = path.join(dirPropuesta(propuesta), `toma-${toma}.wav`);
  if (!existsSync(archivo)) throw new Error("Esa toma no existe.");
  const v: VozGuardada = { id: idDeVoz(nombre), nombre: nombre.trim(), descripcion: p.descripcion, texto: TEXTO_MUESTRA, creada: new Date().toISOString(), licencia: LICENCIA_VOXCPM };
  const dir = path.join(dirVoces(), v.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(archivo, path.join(dir, "referencia.wav"));
  await fs.writeFile(path.join(dir, "voz.json"), JSON.stringify(v, null, 2));
  return v;
}

/**
 * Dice `texto` con una voz guardada y deja un WAV en `salida`. VoxCPM2 habla a ~17–18 car./s (más que el
 * tope de 17 de los subtítulos): la velocidad del proyecto se aplica con `atempo`, que conserva el tono.
 */
export async function sintetizarVoxcpm(ctx: Contexto & { signal?: AbortSignal }, texto: string, vozId: string, velocidad: number, salida: string): Promise<void> {
  const v = await leerVoz(vozId);
  const crudo = `${salida}.voxcpm.wav`;
  try {
    await correrVoxcpm({ modo: "decir", referencia: v.referencia, texto_referencia: v.texto, texto, salida: crudo }, ctx, "Voz");
    const filtro = Math.abs(velocidad - 1) > 1e-3 ? ["-af", `atempo=${velocidad}`] : [];
    await correr(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-i", crudo, ...filtro, "-ac", "1", "-ar", "48000", salida]);
  } finally {
    await fs.rm(crudo, { force: true });
  }
}
