/**
 * Planos generativos con Wan2GP (BRECHAS.md G4): imagen de una escena → video corto, en esta PC.
 *
 * Wan2GP (github.com/deepbeepmeep/Wan2GP) lo instala la persona aparte; Geeper sólo corre su modo sin
 * interfaz, `wgp.py --process ajustes.json --output-dir <carpeta>`, como proceso aparte. Su licencia
 * (WanGP Community License 2.0) permite usarlo gratis, también en una empresa, y vender lo generado
 * (citando a WanGP); no permite venderlo, embeberlo en un producto pago ni ofrecerlo como servicio. Por
 * eso no viaja en el instalador de Geeper. Los pesos tienen su propia licencia (ver MODELOS_PLANO).
 *
 * Portado de Open-Generative-AI (MIT, commit 7858e08, electron/lib/wan2gp{Local,Catalog,Output}.js):
 * lectura del avance y del archivo guardado, detección de fallos, estado de los pesos en `ckpts/` y el
 * modo de prueba (`--dry-run`). Cambios: formatos y licencias de Geeper, cuadros según los fps de cada
 * modelo, `image_prompt_type: "S"` (sin eso wgp.py descarta la imagen de inicio) y la GPU por
 * `gpu-solo` (o el candado de gpu.ts donde no existe).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { argsAtencionWan2gp, atencionInstalada, elegirAtencion } from "./atencion";
import type { Formato } from "./esquema";
import { tomarGpu } from "./gpu";
import { comandoGpuSolo } from "./gpu-solo";
import { LICENCIAS } from "./licencias";
import { aplicarParchesWan2gp } from "./parches-wan2gp";
import { matarArbol, patronComando } from "./proceso";
import { anotarProceso } from "./procesos-largos";
import { GPU_SOLO_BIN, WAN2GP_DIR, WAN2GP_PYTHON } from "./rutas";

export interface ModeloPlano {
  id: string;
  nombre: string;
  /** `model_type` de Wan2GP: el nombre de `<Wan2GP>/defaults/<modelType>.json`. */
  modelType: string;
  fps: number;
  /** Cuadros válidos: múltiplo de esto + 1 (Wan: 4; LTX: 8). */
  bloque: number;
  maxSegundos: number;
  resoluciones: Record<Formato, string>;
  /** Sin imagen de inicio no sirve (image-to-video puro). */
  necesitaImagen: boolean;
  licencia: string;
  nota: string;
  /** A la vista de quien no sabe (si no, va en «Más opciones»). */
  simple: boolean;
  /** Para quien no sabe: qué gana y cuánto tarda, sin jerga. */
  descripcion: string;
}

/**
 * Lo que cabe en la RTX 5080 (16 GB) con el manejo de memoria de Wan2GP. TI2V-5B es el mismo modelo que
 * ya se midió con OpenMontage (ESTUDIO.md); los demás quedan para probar antes de usarlos en serio.
 */
export const MODELOS_PLANO: readonly ModeloPlano[] = [
  {
    id: "rapido",
    nombre: "Rápido",
    modelType: "ti2v_2_2_fastwan",
    fps: 24,
    bloque: 4,
    maxSegundos: 5,
    resoluciones: { "9:16": "704x1280", "16:9": "1280x704", "1:1": "960x960" },
    necesitaImagen: false,
    licencia: "Apache-2.0 (Wan-AI/Wan2.2-TI2V-5B + FastVideo/FastWan2.2-TI2V-5B)",
    nota: "Wan 2.2 TI2V-5B con FastWan: 3 pasos en vez de 50.",
    simple: true,
    // Medido 2026-11-20 en la RTX 5080: ~100 s de trabajo (texto 33 s, 3 pasos 21 s, armado), VRAM pico 11 GB.
    descripcion: "Unos 2 minutos. Ideal para probar ideas.",
  },
  {
    id: "ti2v",
    nombre: "Calidad",
    modelType: "ti2v_2_2",
    fps: 24,
    bloque: 4,
    maxSegundos: 5,
    resoluciones: { "9:16": "704x1280", "16:9": "1280x704", "1:1": "960x960" },
    necesitaImagen: false,
    licencia: LICENCIAS["wan2.2-ti2v-5b"]!,
    nota: "Wan 2.2 TI2V-5B completo (50 pasos): más lento, más detalle.",
    simple: true,
    // Sin medir: ~7 s por paso medido con FastWan × 50 pasos.
    descripcion: "Más detalle y movimiento más limpio, pero tarda bastante más (unos 8 minutos).",
  },
  {
    id: "i2v",
    nombre: "Wan 2.2 I2V-A14B",
    modelType: "i2v_2_2",
    fps: 16,
    bloque: 4,
    maxSegundos: 5,
    resoluciones: { "9:16": "480x832", "16:9": "832x480", "1:1": "720x720" },
    necesitaImagen: true,
    licencia: "Apache-2.0 (Wan-AI/Wan2.2-I2V-A14B)",
    nota: "Más movimiento y más fiel a la imagen; 480p y lento en 16 GB.",
    simple: false,
    descripcion: "Muy fiel a la imagen, menos resolución y lento.",
  },
  {
    id: "ltx2",
    nombre: "LTX-2.3 22B destilado (GGUF Q4)",
    modelType: "ltx2_22B_distilled_gguf_q4_k_m",
    fps: 24,
    bloque: 8,
    maxSegundos: 10,
    resoluciones: { "9:16": "704x1280", "16:9": "1280x704", "1:1": "960x960" },
    necesitaImagen: false,
    // Licencia propia de Lightricks, condicionada a ingresos (MODELOS.md): el QC la bloquea en uso comercial.
    licencia: "revisar: LTX-2 Community License de Lightricks (condicionada a ingresos)",
    nota: "8 pasos. Licencia por revisar: no sirve para uso comercial hasta revisarla.",
    simple: false,
    descripcion: "Otro motor; su licencia está por revisar.",
  },
];

export const MODELO_POR_DEFECTO = "rapido";

export function modeloPlano(id: string): ModeloPlano {
  const m = MODELOS_PLANO.find((x) => x.id === id);
  if (!m) throw new Error(`Modelo de plano desconocido: ${id} (hay: ${MODELOS_PLANO.map((x) => x.id).join(", ")})`);
  return m;
}

/** Cuadros para `segundos` (redondeado al bloque del modelo, + 1), entre un bloque y el máximo. */
export function cuadrosPara(m: ModeloPlano, segundos: number): number {
  const s = Math.min(Math.max(segundos, 0), m.maxSegundos);
  const bloques = Math.max(1, Math.round((s * m.fps) / m.bloque));
  const max = Math.floor((m.maxSegundos * m.fps) / m.bloque);
  return Math.min(bloques, max) * m.bloque + 1;
}

export interface PedidoPlano {
  prompt: string;
  formato: Formato;
  segundos: number;
  /** Ruta absoluta de la imagen de inicio. */
  imagen?: string;
  negativo?: string;
  pasos?: number;
  semilla?: number;
}

export type AjustesWan2gp = Record<string, string | number | string[]>;

/**
 * Ajustes para `wgp.py --process`. Sólo se fija lo que se pidió; el resto queda con los valores por
 * defecto de cada modelo en Wan2GP (ajustados por modelo: los destilados usan pocos pasos, etc.).
 */
export function ajustesWan2gp(m: ModeloPlano, pedido: PedidoPlano): AjustesWan2gp {
  if (m.necesitaImagen && !pedido.imagen) throw new Error(`${m.nombre} necesita la imagen de inicio`);
  const a: AjustesWan2gp = {
    model_type: m.modelType,
    prompt: pedido.prompt.trim(),
    resolution: m.resoluciones[pedido.formato],
    video_length: cuadrosPara(m, pedido.segundos),
    seed: pedido.semilla !== undefined && pedido.semilla >= 0 ? Math.round(pedido.semilla) : Math.floor(Math.random() * 2147483647),
  };
  if (pedido.negativo?.trim()) a.negative_prompt = pedido.negativo.trim();
  if (pedido.pasos && pedido.pasos > 0) a.num_inference_steps = Math.round(pedido.pasos);
  if (pedido.imagen) {
    // Sin «S» en image_prompt_type, wgp.py ignora image_start y hace texto → video.
    a.image_prompt_type = "S";
    a.image_start = pedido.imagen;
  }
  return a;
}

/**
 * Valores del modelo en `<Wan2GP>/defaults/<modelType>.json` (pasos, guidance, flow_shift…) debajo de los
 * ajustes pedidos, que mandan. Así un modelo destilado usa sus pocos pasos sin depender de que wgp.py
 * complete lo que falta. Sin el archivo (u otro formato), devuelve los ajustes como están.
 */
export function conValoresDelModelo(dirWan2gp: string, ajustes: AjustesWan2gp): AjustesWan2gp {
  let def: Record<string, unknown>;
  try {
    def = JSON.parse(readFileSync(path.join(dirWan2gp, "defaults", `${ajustes.model_type}.json`), "utf8")) as Record<string, unknown>;
  } catch {
    return ajustes;
  }
  const base: AjustesWan2gp = {};
  for (const [k, v] of Object.entries(def)) {
    // «model» describe el modelo (pesos, LoRAs) y lo lee Wan2GP solo; el prompt de ejemplo no sirve.
    if (k === "model" || k === "prompt" || k === "negative_prompt") continue;
    if (typeof v === "string" || typeof v === "number") base[k] = v;
  }
  return { ...base, ...ajustes };
}

// ---------------------------------------------------------------------------------------------------
// Lectura de la salida de wgp.py (función pura, probada en tests/wan2gp.test.ts)

export type Fase = "cargando" | "codificando" | "generando" | "decodificando" | "guardando" | "descargando";

export interface Avance {
  fase: Fase;
  /** 0..1, nunca baja. */
  avance: number;
  paso?: number;
  pasos?: number;
  bytes?: number;
}

const FASES: Record<Exclude<Fase, "guardando" | "descargando">, [number, number]> = {
  cargando: [0.02, 0.1],
  codificando: [0.1, 0.12],
  generando: [0.12, 0.9],
  decodificando: [0.9, 0.99],
};

const sinAnsi = (t: string) => String(t).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

function faseDe(etiqueta: string): keyof typeof FASES | null {
  if (/^Denoising/i.test(etiqueta)) return "generando";
  if (/^VAE Decoding/i.test(etiqueta)) return "decodificando";
  if (/^Encoding/i.test(etiqueta)) return "codificando";
  if (/^Loading/i.test(etiqueta)) return "cargando";
  return null;
}

/**
 * Lector con estado: recibe trozos de stdout/stderr y devuelve eventos sólo cuando algo cambió. La carga
 * tiene subfases con su propio contador (3/3 y luego 0/12), así que el avance total nunca retrocede.
 */
export function crearLectorAvance(): (trozo: string) => Avance[] {
  let resto = "";
  let ultimo = "";
  let maximo = 0;
  return (trozo) => {
    const lineas = (resto + sinAnsi(trozo).replace(/\r/g, "\n")).split("\n");
    resto = lineas.pop() ?? "";
    const eventos: Avance[] = [];
    for (const linea of lineas) {
      let e: Avance | null = null;
      const m = linea.match(/\[(\d+)\/(\d+)\]\s+([A-Za-z][^|[]*)/);
      const fase = m ? faseDe(m[3]!.trim()) : null;
      if (m && fase) {
        const paso = Number(m[1]);
        const pasos = Number(m[2]);
        const [de, a] = FASES[fase];
        e = { fase, paso, pasos, avance: de + (a - de) * (pasos > 0 ? Math.min(1, paso / pasos) : 0) };
      } else if (/^\s*Loading Model /.test(linea)) {
        e = { fase: "cargando", avance: FASES.cargando[0] };
      } else if (/Saving File/.test(linea)) {
        e = { fase: "guardando", avance: 0.99 };
      }
      if (!e) continue;
      const clave = `${e.fase}:${e.paso ?? ""}/${e.pasos ?? ""}`;
      if (clave === ultimo) continue;
      ultimo = clave;
      maximo = Math.max(maximo, e.avance);
      eventos.push({ ...e, avance: maximo });
    }
    return eventos;
  };
}

const lineasNoVacias = (t: string) =>
  sinAnsi(t)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());

export const colaLog = (salida: string, n = 15) => lineasNoVacias(salida).slice(-n).join("\n");

/** El archivo que dice wgp.py («Video file saved to Path: …»); si hubo posproceso, gana la última línea. */
export function rutaGuardada(salida: string): string | null {
  const ms = [...sinAnsi(salida).matchAll(/saved to Path:\s*(.+?)\s*$/gm)];
  return ms.length ? ms[ms.length - 1]![1]! : null;
}

function explicarFallo(salida: string): string | null {
  const t = sinAnsi(salida);
  if (/out of memory|OutOfMemoryError/i.test(t)) {
    return "La GPU se quedó sin memoria (VRAM). Prueba con menos segundos, otro modelo o cierra programas de Windows que usen la GPU.";
  }
  const falta = t.match(/File not found for '([^']+)':\s*(.+)$/m);
  if (falta) return `No se encontró el archivo de «${falta[1]}»: ${falta[2]!.trim()}`;
  const error = lineasNoVacias(t).reverse().find((l) => /^\[ERROR\]/.test(l.trim()));
  if (error) return error.trim().replace(/^\[ERROR\]\s*/, "");
  if (/Traceback \(most recent call last\)/.test(t)) {
    const exc = lineasNoVacias(t).reverse().find((l) => /^[A-Za-z_.]+(Error|Exception)\b/.test(l.trim()));
    if (exc) return exc.trim();
  }
  return null;
}

export type ResultadoCorrida = { ok: true; ruta: string | null } | { ok: false; error: string };

/** ¿La corrida dejó el video? Éxito = código 0 y «Queue completed: N/N». */
export function resumirCorrida(codigo: number | null, senal: string | null, salida: string): ResultadoCorrida {
  const r = sinAnsi(salida).match(/Queue completed:\s*(\d+)\/(\d+) tasks/);
  const hechas = r ? Number(r[1]) : 0;
  const total = r ? Number(r[2]) : 0;
  if (!senal && codigo === 0 && total > 0 && hechas === total) return { ok: true, ruta: rutaGuardada(salida) };
  const motivo = senal
    ? `Wan2GP se detuvo (${senal}).`
    : explicarFallo(salida) ?? (r ? `Wan2GP terminó ${hechas} de ${total} tareas.` : `Wan2GP salió con código ${codigo}.`);
  return { ok: false, error: `${motivo}\n\n${colaLog(salida)}` };
}

// ---------------------------------------------------------------------------------------------------
// Instalación

export interface InstalacionWan2gp {
  dir: string;
  python: string;
  wgp: string;
}

export function instalacionWan2gp(dir = WAN2GP_DIR, python = WAN2GP_PYTHON): InstalacionWan2gp {
  return { dir, python, wgp: path.join(dir, "wgp.py") };
}

/** null si está lista; si no, qué falta (en palabras de la persona). */
export function faltaEnInstalacion(i: InstalacionWan2gp): string | null {
  if (!existsSync(i.dir)) return `No está Wan2GP en ${i.dir} (instálalo o define GEEPER_WAN2GP)`;
  if (!existsSync(i.wgp)) return `No hay wgp.py en ${i.dir}: ¿es la carpeta de Wan2GP?`;
  if (!existsSync(i.python)) return `No está el Python de Wan2GP: ${i.python} (o define GEEPER_WAN2GP_PYTHON)`;
  return null;
}

/**
 * Estado de cada modelo en esa instalación: «listo» (definido y con algún archivo de pesos en ckpts/),
 * «sin-pesos» (los baja Wan2GP la primera vez), «definido» (no se pudo saber qué pesos usa) o
 * «no-existe» (esa versión de Wan2GP no lo trae).
 */
export function estadoModelos(i: InstalacionWan2gp, modelos: readonly ModeloPlano[] = MODELOS_PLANO): Record<string, "listo" | "sin-pesos" | "definido" | "no-existe"> {
  const r: Record<string, "listo" | "sin-pesos" | "definido" | "no-existe"> = {};
  for (const m of modelos) {
    const def = path.join(i.dir, "defaults", `${m.modelType}.json`);
    if (!existsSync(def)) {
      r[m.id] = "no-existe";
      continue;
    }
    let urls: unknown = null;
    try {
      urls = (JSON.parse(readFileSync(def, "utf8")) as { model?: { URLs?: unknown } }).model?.URLs;
      // «URLs» puede nombrar otro modelo cuyos pesos usa (FastWan usa los de ti2v_2_2).
      if (typeof urls === "string") urls = (JSON.parse(readFileSync(path.join(i.dir, "defaults", `${urls}.json`), "utf8")) as { model?: { URLs?: unknown } }).model?.URLs;
    } catch {
      /* definición ilegible */
    }
    if (!Array.isArray(urls) || urls.length === 0) {
      r[m.id] = "definido";
      continue;
    }
    r[m.id] = urls.some((u) => existsSync(path.join(i.dir, "ckpts", path.basename(String(u))))) ? "listo" : "sin-pesos";
  }
  return r;
}

function tamanoCarpeta(dir: string): number {
  let total = 0;
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entradas) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += tamanoCarpeta(p);
    else if (e.isFile()) {
      try {
        total += statSync(p).size;
      } catch {
        /* se movió mientras se medía */
      }
    }
  }
  return total;
}

const MEDIOS = new Set([".mp4", ".mkv", ".mov", ".webm"]);
const IMAGENES = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** Archivos de ese tipo en `dir`, del más viejo al más nuevo (Wan2GP no anuncia la ruta de las imágenes). */
function archivosDe(dir: string, tipos: Set<string>): string[] {
  let nombres: string[];
  try {
    nombres = readdirSync(dir);
  } catch {
    return [];
  }
  return nombres
    .filter((n) => tipos.has(path.extname(n).toLowerCase()))
    .map((n) => ({ p: path.join(dir, n), t: statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => a.t - b.t || a.p.localeCompare(b.p))
    .map((x) => x.p);
}

const videoMasNuevo = (dir: string): string | null => archivosDe(dir, MEDIOS).at(-1) ?? null;

/**
 * Mata wgp.py y lo que haya lanzado (ffmpeg, compiladores): tiene su propio grupo de procesos. SIGTERM a
 * todo el grupo y, si a los 5 s el grupo sigue vivo, SIGKILL (WRK-03: se mira el grupo y no el hijo
 * directo, que con gpu-solo es gpu-lock y muere enseguida). Con gpu-solo, el SIGKILL va sólo al Python:
 * matar el bash de gpu-solo antes de su `trap` dejaría detenidos los contenedores de MPT.
 */
function matarWan2gp(hijo: ChildProcess, i: InstalacionWan2gp, conGpuSolo: boolean) {
  matarArbol(hijo, { patronDuro: conGpuSolo ? patronComando(i.python) : undefined });
}

const TOPE_SALIDA = 2 * 1024 * 1024;

function lanzar(i: InstalacionWan2gp, argsPedidos: string[], conGpuSolo: boolean) {
  // La mejor atención instalada en su venv (sage > flash > sdpa); ver atencion.ts.
  const args = [...argsAtencionWan2gp(elegirAtencion(atencionInstalada(i.python))), ...argsPedidos];
  const c = conGpuSolo ? comandoGpuSolo(i.python, [i.wgp, ...args]) : { cmd: i.python, args: [i.wgp, ...args] };
  return spawn(c.cmd, c.args, {
    cwd: i.dir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      // Igual que correr(): en Windows Python usa la página de códigos del sistema si no.
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      // wgp.py importa GitPython (sólo lo usa su gestor de plugins); sin Git en el PATH, el import
      // revienta. La app no instala Git, así que se silencia: Geeper no usa los plugins.
      GIT_PYTHON_REFRESH: "quiet",
      PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF ?? "expandable_segments:True",
    },
    // Grupo propio en POSIX: cancelar llega a todo el árbol.
    detached: process.platform !== "win32",
  });
}

function juntarSalida(hijo: ChildProcess, alTrozo?: (t: string) => void): () => string {
  let salida = "";
  const h = (d: Buffer) => {
    const t = d.toString();
    salida = (salida + t).slice(-TOPE_SALIDA);
    alTrozo?.(t);
  };
  hijo.stdout?.on("data", h);
  hijo.stderr?.on("data", h);
  return () => salida;
}

/** `wgp.py --process <ajustes> --dry-run`: valida la instalación y los ajustes sin generar ni usar la GPU. */
export async function probarWan2gp(i: InstalacionWan2gp, ajustes: AjustesWan2gp, dirCorrida: string): Promise<{ ok: boolean; mensaje: string }> {
  const falta = faltaEnInstalacion(i);
  if (falta) return { ok: false, mensaje: falta };
  await fs.mkdir(dirCorrida, { recursive: true });
  const archivo = path.join(dirCorrida, "prueba.json");
  await fs.writeFile(archivo, JSON.stringify(conValoresDelModelo(i.dir, ajustes), null, 2));
  const hijo = lanzar(i, ["--process", archivo, "--dry-run"], false);
  const salida = juntarSalida(hijo);
  return new Promise((ok) => {
    hijo.on("error", (e) => ok({ ok: false, mensaje: `No arrancó ${i.python}: ${e.message}` }));
    hijo.on("close", (codigo) => {
      const m = salida().match(/Validation complete\.\s*(\d+)\/(\d+) task/);
      if (codigo === 0 && m && m[1] === m[2] && Number(m[2]) > 0) ok({ ok: true, mensaje: "Wan2GP validó la tarea de prueba." });
      else ok({ ok: false, mensaje: colaLog(salida(), 8) || `Salió con código ${codigo}` });
    });
  });
}

export interface OpcionesGenerar {
  instalacion: InstalacionWan2gp;
  ajustes: AjustesWan2gp;
  /** Carpeta de la corrida: ajustes.json, wgp.log y out/. */
  dirCorrida: string;
  alAvanzar?: (a: Avance) => void;
  log?: (l: string) => void;
  signal?: AbortSignal;
  /** Por defecto, gpu-solo si existe (pausa Ollama y el servidor de imágenes de MPT); si no, el candado de gpu.ts. */
  gpuSolo?: boolean;
}

/**
 * Genera el plano y devuelve la ruta del video. Toma toda la GPU: puede tardar varios minutos, más la
 * primera vez de cada modelo (Wan2GP baja los pesos a `ckpts/` sin decir nada; el avance sale del
 * tamaño de esa carpeta).
 */
export async function generarPlano(op: OpcionesGenerar): Promise<string> {
  return (await correrWan2gp(op, "video"))[0]!;
}

/**
 * Genera imágenes (modelos de imagen de Wan2GP con `image_mode: 1`, p. ej. Z-Image o Qwen Edit) y devuelve
 * sus rutas en el orden en que se guardaron (con `batch_size`, una por toma).
 */
export async function generarImagenes(op: OpcionesGenerar): Promise<string[]> {
  return correrWan2gp(op, "imagen");
}

async function correrWan2gp(op: OpcionesGenerar, tipo: "video" | "imagen"): Promise<string[]> {
  const { instalacion: i, ajustes, dirCorrida, signal } = op;
  const inicio = Date.now();
  const falta = faltaEnInstalacion(i);
  if (falta) throw new Error(falta);
  await aplicarParchesWan2gp(i.dir, op.log);
  const out = path.join(dirCorrida, "out");
  await fs.mkdir(out, { recursive: true });
  const archivo = path.join(dirCorrida, "ajustes.json");
  await fs.writeFile(archivo, JSON.stringify(conValoresDelModelo(i.dir, ajustes), null, 2));

  const conGpuSolo = op.gpuSolo ?? existsSync(GPU_SOLO_BIN);
  const candado = conGpuSolo ? null : await tomarGpu("wan2gp", { esperar: true, signal, alEsperar: (q) => op.log?.(`Esperando la GPU (la usa ${q})`) });
  try {
    if (signal?.aborted) throw new Error("Cancelado");
    const hijo = lanzar(i, ["--process", archivo, "--output-dir", out], conGpuSolo);
    anotarProceso(hijo, "Wan2GP");
    const lector = crearLectorAvance();
    let modeloCargado = false;
    const salida = juntarSalida(hijo, (t) => {
      for (const e of lector(t)) {
        if (e.fase !== "cargando") modeloCargado = true;
        op.alAvanzar?.(e);
      }
    });
    const ckpts = path.join(i.dir, "ckpts");
    const base = tamanoCarpeta(ckpts);
    const medidor = setInterval(() => {
      if (modeloCargado) return;
      const bajado = tamanoCarpeta(ckpts) - base;
      if (bajado > 0) op.alAvanzar?.({ fase: "descargando", bytes: bajado, avance: 0.02 });
    }, 2000);
    const cancelar = () => matarWan2gp(hijo, i, conGpuSolo);
    signal?.addEventListener("abort", cancelar, { once: true });
    try {
      return await new Promise<string[]>((ok, mal) => {
        hijo.on("error", (e) => mal(new Error(`No arrancó Wan2GP (${i.python}): ${e.message}`)));
        hijo.on("close", (codigo, senal) => {
          void fs.writeFile(path.join(dirCorrida, "wgp.log"), salida()).catch(() => {});
          const r = resumirCorrida(codigo, senal, salida());
          if (!r.ok) return mal(new Error(r.error));
          if (tipo === "imagen") {
            // Sólo las de esta corrida (si la carpeta se reusó, las viejas no cuentan).
            const imagenes = archivosDe(out, IMAGENES).filter((f) => statSync(f).mtimeMs >= inicio - 1000);
            if (!imagenes.length) return mal(new Error(`Wan2GP dijo que terminó pero no hay imágenes en ${out}.\n\n${colaLog(salida())}`));
            return ok(imagenes);
          }
          const ruta = r.ruta && existsSync(r.ruta) ? r.ruta : videoMasNuevo(out);
          if (!ruta) return mal(new Error(`Wan2GP dijo que terminó pero no hay video en ${out}.\n\n${colaLog(salida())}`));
          ok([ruta]);
        });
      });
    } finally {
      clearInterval(medidor);
      signal?.removeEventListener("abort", cancelar);
    }
  } finally {
    candado?.liberar();
  }
}
