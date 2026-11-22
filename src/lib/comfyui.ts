/**
 * ComfyUI como motor aparte para la sección **Workflows** (HEREDADO.md «ComfyUI»). ComfyUI es GPL-3.0:
 * Geeper no importa su código, lo corre como proceso (`main.py`) y le habla por su API HTTP local.
 *
 *  - **Catálogo**: las plantillas oficiales del hub (paquete `comfyui-workflow-templates` de la versión
 *    instalada, leído con py/comfy_catalogo.py, más las que el paquete no trae: hub-comfy.ts). Las de nodos de pago (`openSource: false`) se muestran
 *    bloqueadas: Geeper es US$0 (decisión del dueño, 2026-11-21).
 *  - **Modelos**: cada workflow dice en sus nodos qué archivos usa y de dónde bajarlos
 *    (`properties.models`: nombre, url, carpeta); se bajan sólo al usarlo.
 *  - **Correr**: los workflows vienen en el formato del editor (con subgrafos). Para no reescribir su
 *    conversión, se abre el editor de ComfyUI en un Chrome sin ventana y se usa la suya
 *    (`app.graphToPrompt()`); el resultado va a `/prompt` y se espera en `/history`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { argsAtencionComfyui, atencionInstalada, elegirAtencion } from "./atencion";
import { comandoGpuSolo } from "./gpu-solo";
import { bajarHub, dirHub, HUB_COMMIT, resolverArchivo, unirHub } from "./hub-comfy";
import { pythonDeVenv } from "./plataforma";
import { correr, matarArbol, patronComando } from "./proceso";
import { anotarProceso } from "./procesos-largos";
import { abrirNavegador, rutaChrome } from "./navegador";
import { dirDatos, ESTUDIO, GPU_SOLO_BIN, RAIZ_REPO } from "./rutas";

export const COMFYUI_DIR = process.env.GEEPER_COMFYUI ?? path.join(ESTUDIO, "ComfyUI");
export const COMFYUI_PYTHON = process.env.GEEPER_COMFYUI_PYTHON ?? pythonDeVenv(path.join(COMFYUI_DIR, "venv"));
/** Los trabajos usan un puerto y el editor abierto a mano otro: nunca chocan. */
export const PUERTO_TRABAJOS = 8189;
export const PUERTO_EDITOR = 8190;

export function faltaComfyui(dir = COMFYUI_DIR, python = COMFYUI_PYTHON): string | null {
  if (!existsSync(path.join(dir, "main.py"))) return "ComfyUI no está instalado";
  if (!existsSync(python)) return "Falta el Python de ComfyUI";
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Catálogo

export interface EntradaIndice {
  name: string;
  title?: string;
  description?: string;
  mediaType?: string;
  tags?: string[];
  models?: string[];
  size?: number;
  openSource?: boolean;
  requiresCustomNodes?: string[];
  io?: { inputs?: { nodeId: number; nodeType: string; file?: string; mediaType?: string }[] };
  thumbnail?: string[];
  date?: string;
  usage?: number;
  tutorialUrl?: string;
  minComfyUIVersion?: string;
  /** ["cloud"]: sólo en la nube de Comfy; ["local"]: sólo en ComfyUI local. */
  includeOnDistributions?: string[];
}
export interface CategoriaIndice {
  title?: string;
  moduleName?: string;
  category?: string;
  templates: EntradaIndice[];
}

export interface Workflow {
  id: string;
  titulo: string;
  descripcion: string;
  categoria: string;
  tipo: string;
  etiquetas: string[];
  modelos: string[];
  /** Bytes de los modelos que baja (aprox., del índice). */
  tamano: number;
  /** Corre en esta PC (sin nodos de pago). */
  local: boolean;
  /** Paquetes de nodos de la comunidad que necesita (todavía no se instalan desde Geeper). */
  complementos: string[];
  entradas: { nodo: number; tipo: string; archivo: string | null; medio: string }[];
  /** Nombres de archivo de las miniaturas (se sirven por /api/workflows/archivo). */
  miniaturas: string[];
  fecha: string | null;
  uso: number;
}

/** Nombres de categoría en español (las que no están, quedan como vienen). */
export const CATEGORIAS: Record<string, string> = {
  Image: "Imágenes",
  Video: "Video",
  "Video Tools": "Herramientas de video",
  "Image Tools": "Herramientas de imagen",
  "3D Model": "3D",
  Audio: "Audio y música",
  "Character & Fashion": "Personajes y moda",
  LLM: "Texto con IA",
  "Product & Ads": "Productos y anuncios",
  "Brand & Design": "Marca y diseño",
  Vector: "Vectores",
  "Node Basics": "Básicos",
};

/** Índice + archivos → lista de workflows (función pura). Una plantilla en varias categorías sale una vez. */
export function normalizarCatalogo(indice: CategoriaIndice[], archivos: Record<string, string> = {}): Workflow[] {
  const vistos = new Map<string, Workflow>();
  for (const c of indice) {
    const categoria = CATEGORIAS[c.title ?? ""] ?? c.title ?? c.category ?? "Otros";
    for (const t of c.templates ?? []) {
      if (!t.name || vistos.has(t.name)) continue;
      // Primero las imágenes (algunas miniaturas del hub son .mp4), después la estándar `<nombre>-1.webp`.
      const candidatas = [...new Set([...(t.thumbnail ?? []).map((x) => path.basename(x)), `${t.name}-1.webp`])];
      const imagen = (x: string) => /\.(webp|png|jpe?g|gif)$/i.test(x);
      const miniaturas = candidatas.filter((x) => !Object.keys(archivos).length || x in archivos).sort((a, b) => Number(imagen(b)) - Number(imagen(a)));
      vistos.set(t.name, {
        id: t.name,
        titulo: t.title ?? t.name,
        descripcion: t.description ?? "",
        categoria,
        tipo: t.mediaType ?? "image",
        etiquetas: t.tags ?? [],
        modelos: (t.models ?? []).filter((m) => m && m !== "None"),
        tamano: t.size ?? 0,
        local: t.openSource !== false && (!t.includeOnDistributions?.length || t.includeOnDistributions.includes("local")),
        complementos: t.requiresCustomNodes ?? [],
        entradas: (t.io?.inputs ?? []).map((x) => ({ nodo: x.nodeId, tipo: x.nodeType, archivo: x.file ?? null, medio: x.mediaType ?? "image" })),
        miniaturas,
        fecha: t.date ?? null,
        uso: t.usage ?? 0,
      });
    }
  }
  return [...vistos.values()];
}

interface CacheCatalogo {
  clave: string;
  workflows: Workflow[];
  archivos: Record<string, string>;
}
const g = globalThis as unknown as { __catalogoComfy?: CacheCatalogo };

/** Subirlo cuando cambia cómo se arma el catálogo: invalida las cachés (disco y memoria). */
const FORMATO_CATALOGO = 2;

/** El catálogo de la versión instalada (se calcula una vez por versión del paquete de plantillas). */
export async function leerCatalogo(dir = COMFYUI_DIR, python = COMFYUI_PYTHON): Promise<CacheCatalogo> {
  const falta = faltaComfyui(dir, python);
  if (falta) throw new Error(falta);
  const marca = path.join(dir, ".geeper-commit");
  const hub = path.join(dirHub(dir), "templates", "index.json");
  const clave = `${dir}:${await fs.readFile(marca, "utf8").catch(() => "?")}:${HUB_COMMIT}:${existsSync(hub)}:v${FORMATO_CATALOGO}`;
  if (g.__catalogoComfy?.clave === clave) return g.__catalogoComfy;
  const cache = path.join(dir, ".geeper-catalogo.json");
  let datos: { indice: CategoriaIndice[]; archivos: Record<string, string> } | null = null;
  try {
    const c = JSON.parse(await fs.readFile(cache, "utf8")) as { clave: string; indice: CategoriaIndice[]; archivos: Record<string, string> };
    if (c.clave === clave) datos = c;
  } catch {
    /* sin caché */
  }
  if (!datos) {
    const r = await correr(python, ["-I", path.join(RAIZ_REPO, "py", "comfy_catalogo.py")], { cwd: dir, timeout: 120_000, permitirFallo: true });
    const salida = JSON.parse(r.stdout || "{}") as { indice?: CategoriaIndice[]; archivos?: Record<string, string>; error?: string };
    if (!salida.indice) throw new Error(`No pude leer el catálogo de workflows: ${salida.error ?? r.stderr.trim().split("\n").at(-1)}`);
    datos = { indice: salida.indice, archivos: salida.archivos ?? {} };
    // Las recetas del hub que el paquete no trae (código de la comunidad, sólo nube): hub-comfy.ts.
    if (!existsSync(hub)) await bajarHub(dir, datos.archivos).catch(() => null);
    if (existsSync(hub)) {
      const u = unirHub(datos.archivos, JSON.parse(await fs.readFile(hub, "utf8")) as CategoriaIndice[], (repo) => path.join(dirHub(dir), repo), existsSync);
      datos = { indice: u.indice, archivos: u.archivos };
    }
    await fs.writeFile(cache, JSON.stringify({ clave: `${dir}:${await fs.readFile(marca, "utf8").catch(() => "?")}:${HUB_COMMIT}:${existsSync(hub)}:v${FORMATO_CATALOGO}`, ...datos }));
  }
  g.__catalogoComfy = { clave, workflows: normalizarCatalogo(datos.indice, datos.archivos), archivos: datos.archivos };
  return g.__catalogoComfy;
}

export async function leerWorkflowJson(id: string): Promise<GrafoUi> {
  if (!/^[\w.-]+$/.test(id)) throw new Error("Workflow inválido");
  const { archivos } = await leerCatalogo();
  const ruta = archivos[`${id}.json`];
  if (!ruta) throw new Error(`No encuentro el workflow «${id}» en esta versión de ComfyUI`);
  return JSON.parse(await fs.readFile(await resolverArchivo(COMFYUI_DIR, ruta), "utf8")) as GrafoUi;
}

// ---------------------------------------------------------------------------------------------------
// Lo que hay dentro de un workflow (funciones puras)

export interface NodoUi {
  id: number | string;
  type: string;
  title?: string;
  mode?: number;
  widgets_values?: unknown[] | Record<string, unknown>;
  properties?: { models?: { name?: string; url?: string; directory?: string }[]; [k: string]: unknown };
}
export interface GrafoUi {
  nodes?: NodoUi[];
  definitions?: { subgraphs?: { id?: string; nodes?: NodoUi[] }[] };
  [k: string]: unknown;
}

export interface ModeloWorkflow {
  nombre: string;
  url: string;
  carpeta: string;
}

/** Los modelos que declaran los nodos (también dentro de subgrafos), sin repetir. Sólo URLs https. */
export function modelosDeWorkflow(w: GrafoUi): ModeloWorkflow[] {
  const todos = [...(w.nodes ?? []), ...(w.definitions?.subgraphs ?? []).flatMap((s) => s.nodes ?? [])];
  const out = new Map<string, ModeloWorkflow>();
  for (const n of todos) {
    if (n.mode === 2 || n.mode === 4) continue; // silenciado o salteado: no se usa
    for (const m of n.properties?.models ?? []) {
      if (!m.name || !m.url || !m.directory) continue;
      if (!/^https:\/\//.test(m.url) || !/^[\w./-]+$/.test(m.directory) || m.directory.includes("..") || m.name.includes("..") || path.isAbsolute(m.name)) continue;
      const clave = `${m.directory}/${m.name}`;
      if (!out.has(clave)) out.set(clave, { nombre: m.name, url: m.url, carpeta: m.directory });
    }
  }
  return [...out.values()];
}

export interface CampoTexto {
  nodo: string;
  indice: number;
  etiqueta: string;
  valor: string;
}

const NO_ES_TEXTO = /Note|Math|Json|Resolution|Resize|PathAnimator|Expression/i;
const ES_TEXTO = /Text|Prompt|String|Encode|Lyrics|Caption|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Etiqueta en palabras de la persona para un campo de texto. */
export function etiquetaTexto(n: NodoUi): string {
  const t = `${n.title ?? ""} ${n.type}`;
  if (/negative|negativ/i.test(t)) return "Lo que NO quieres que aparezca";
  if (/lyric/i.test(t)) return "Letra";
  if (/tag|style|estilo/i.test(t) && /audio|music|ace/i.test(t)) return "Estilo de la música";
  return n.title?.trim() && !/^(CLIP Text Encode.*|Text|String.*|Prompt)$/i.test(n.title.trim()) ? n.title.trim() : "Qué quieres que salga";
}

/** Los textos que la persona puede cambiar (los prompts del nivel de arriba, no las notas). */
export function textosDeWorkflow(w: GrafoUi): CampoTexto[] {
  const out: CampoTexto[] = [];
  for (const n of w.nodes ?? []) {
    if (n.mode === 2 || n.mode === 4 || NO_ES_TEXTO.test(n.type) || !ES_TEXTO.test(n.type)) continue;
    if (!Array.isArray(n.widgets_values)) continue;
    n.widgets_values.forEach((v, i) => {
      if (typeof v === "string" && /\s/.test(v.trim()) && v.trim().length > 3 && !/\.(png|jpe?g|webp|mp4|wav|mp3|safetensors|gguf)$/i.test(v)) {
        out.push({ nodo: String(n.id), indice: i, etiqueta: etiquetaTexto(n), valor: v });
      }
    });
  }
  return out;
}

/** Notas del autor (MarkdownNote / Note), para «Cómo se usa» (vienen en inglés). */
export function notasDeWorkflow(w: GrafoUi): string[] {
  return (w.nodes ?? [])
    .filter((n) => /Note/.test(n.type) && Array.isArray(n.widgets_values) && typeof n.widgets_values[0] === "string")
    .map((n) => String((n.widgets_values as unknown[])[0]).trim())
    .filter(Boolean)
    .slice(0, 4);
}

export interface Cambios {
  textos?: { nodo: string; indice: number; valor: string }[];
  /** Archivos ya copiados a `ComfyUI/input/`: el nodo de carga apunta a ese nombre. */
  archivos?: { nodo: number | string; nombre: string }[];
}

/** El workflow con los textos y archivos de la persona (función pura; no toca el original). */
export function aplicarCambios(w: GrafoUi, c: Cambios): GrafoUi {
  const copia = structuredClone(w);
  const porId = new Map((copia.nodes ?? []).map((n) => [String(n.id), n]));
  for (const t of c.textos ?? []) {
    const n = porId.get(t.nodo);
    if (!n || !Array.isArray(n.widgets_values) || typeof n.widgets_values[t.indice] !== "string") throw new Error(`El campo de texto ${t.nodo}/${t.indice} ya no existe en este workflow`);
    n.widgets_values[t.indice] = t.valor;
  }
  for (const a of c.archivos ?? []) {
    const n = porId.get(String(a.nodo));
    if (!n) throw new Error(`El workflow no tiene el nodo ${a.nodo} para tu archivo`);
    if (Array.isArray(n.widgets_values)) n.widgets_values[0] = a.nombre;
    else if (n.widgets_values && typeof n.widgets_values === "object") {
      const k = Object.keys(n.widgets_values).find((x) => /file|image|video|audio/i.test(x)) ?? Object.keys(n.widgets_values)[0];
      if (k) (n.widgets_values as Record<string, unknown>)[k] = a.nombre;
    } else n.widgets_values = [a.nombre];
  }
  return copia;
}

export interface EstadoModelo extends ModeloWorkflow {
  listo: boolean;
  ruta: string;
}

export function estadoModelos(modelos: ModeloWorkflow[], dir = COMFYUI_DIR): EstadoModelo[] {
  return modelos.map((m) => {
    const ruta = path.join(dir, "models", m.carpeta, m.nombre);
    return { ...m, ruta, listo: existsSync(ruta) };
  });
}

// ---------------------------------------------------------------------------------------------------
// Servidor

export interface Servidor {
  url: string;
  hijo: ChildProcess;
  detener: () => Promise<void>;
}

/** Arranca `main.py` en 127.0.0.1 y espera a que responda. Con gpu-solo pausa la IA de MPT mientras vive. */
/**
 * `nodos`: argumentos de nodos extra (argsNodos de nodos-comfy.ts). Por defecto no carga ninguno:
 * el código de la comunidad sólo corre cuando el workflow lo pide y la persona lo permitió.
 */
export async function arrancarComfyui(op: { puerto: number; gpuSolo?: boolean; arranqueMs?: number; log?: (l: string) => void; signal?: AbortSignal; dir?: string; python?: string; nodos?: string[] }): Promise<Servidor> {
  const dir = op.dir ?? COMFYUI_DIR;
  const python = op.python ?? COMFYUI_PYTHON;
  const falta = faltaComfyui(dir, python);
  if (falta) throw new Error(falta);
  const args = [path.join(dir, "main.py"), "--listen", "127.0.0.1", "--port", String(op.puerto), "--disable-auto-launch", "--output-directory", path.join(dir, "output"), ...argsAtencionComfyui(elegirAtencion(atencionInstalada(python))), ...(op.nodos ?? ["--disable-all-custom-nodes"])];
  const conGpuSolo = op.gpuSolo ?? existsSync(GPU_SOLO_BIN);
  const c = conGpuSolo ? comandoGpuSolo(python, args) : { cmd: python, args };
  const hijo = spawn(c.cmd, c.args, { cwd: dir, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, detached: process.platform !== "win32" });
  // «close»: el hijo salió y nadie más (un Python que siguiera vivo) tiene abierta su salida.
  let salio = false;
  hijo.once("close", () => (salio = true));
  anotarProceso(hijo, "ComfyUI");
  let salida = "";
  // Con gpu-solo, el plazo de arranque cuenta desde que tiene la tarjeta («gpu-solo: pausados»), no desde
  // que hace fila: si la tarjeta lleva más de 5 min ocupada, el workflow sólo esperaba su turno (GPU-08).
  let desde: number | null = conGpuSolo ? null : Date.now();
  const leer = (d: Buffer) => {
    const t = d.toString();
    if (desde === null && t.includes("gpu-solo: pausados")) desde = Date.now();
    salida = (salida + t).slice(-200_000);
    for (const l of t.split(/\r?\n/)) if (l.trim()) op.log?.(l.trimEnd());
  };
  hijo.stdout?.on("data", leer);
  hijo.stderr?.on("data", leer);
  const url = `http://127.0.0.1:${op.puerto}`;
  // Todo el grupo (gpu-lock, gpu-solo y Python). Con gpu-solo, el SIGKILL va sólo al Python: matar su bash
  // antes del `trap` dejaría apagada la IA de MPT (WRK-03).
  const detener = async () => {
    if (salio) return;
    const cerrado = new Promise<void>((ok) => {
      const t = setTimeout(ok, 10_000);
      hijo.once("close", () => {
        clearTimeout(t);
        ok();
      });
    });
    matarArbol(hijo, { graciaMs: 8000, patronDuro: conGpuSolo ? patronComando(python) : undefined });
    await cerrado;
  };
  const ARRANQUE_MS = op.arranqueMs ?? 5 * 60_000;
  // Tope de la fila por si gpu-solo nunca avisa: una hora.
  const topeFila = Date.now() + 60 * 60_000;
  while (desde === null ? Date.now() < topeFila : Date.now() < desde + ARRANQUE_MS) {
    if (op.signal?.aborted) {
      await detener();
      throw new Error("Cancelado");
    }
    if (hijo.exitCode !== null) throw new Error(`ComfyUI se cerró al arrancar.\n\n${salida.split("\n").slice(-12).join("\n")}`);
    try {
      const r = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return { url, hijo, detener };
    } catch {
      /* todavía no */
    }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  await detener();
  throw new Error(`ComfyUI no respondió en 5 minutos.\n\n${salida.split("\n").slice(-12).join("\n")}`);
}

/**
 * Convierte el workflow del editor al formato de la API con el propio editor de ComfyUI (subgrafos, nodos
 * salteados, reroutes y widgets quedan como los resuelve ComfyUI). Necesita el servidor andando.
 */
export async function aFormatoApi(url: string, w: GrafoUi): Promise<Record<string, unknown>> {
  const pw = await import("playwright-core");
  const nav = await abrirNavegador(() => pw.chromium.launch({ executablePath: rutaChrome() }));
  try {
    const ctx = await nav.newContext();
    await ctx.addInitScript({ content: "window.__name = (f) => f;" });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    await page.waitForFunction(() => {
      const a = (window as unknown as { app?: { graph?: unknown; graphToPrompt?: unknown } }).app;
      return !!a?.graph && typeof a.graphToPrompt === "function";
    }, undefined, { timeout: 120_000 });
    const api = await page.evaluate(async (grafo) => {
      const app = (window as unknown as { app: { loadGraphData: (g: unknown, limpiar?: boolean, restaurar?: boolean) => Promise<void>; graphToPrompt: () => Promise<{ output: Record<string, unknown> }> } }).app;
      await app.loadGraphData(grafo, true, false);
      return (await app.graphToPrompt()).output;
    }, w as unknown as Record<string, unknown>);
    if (!api || !Object.keys(api).length) throw new Error("El editor de ComfyUI no devolvió nada para ejecutar (¿al workflow le faltan nodos?).");
    return api;
  } finally {
    await nav.close().catch(() => {});
  }
}

export interface Salida {
  archivo: string;
  subcarpeta: string;
  tipo: string;
  /** output: lo que guardó (SaveImage…); temp: una vista previa (PreviewImage), sólo si no guardó nada. */
  carpeta: "output" | "temp";
}

/**
 * Los archivos que dejó un prompt (de `/history/<id>`), sin repetir. Si el workflow no guarda nada y sólo
 * muestra vistas previas (PreviewImage, como el de quitar el fondo), se usan esas.
 */
export function salidasDeHistorial(h: unknown): Salida[] {
  const out: Salida[] = [];
  const outputs = (h as { outputs?: Record<string, Record<string, unknown>> } | undefined)?.outputs ?? {};
  for (const nodo of Object.values(outputs)) {
    for (const [clave, lista] of Object.entries(nodo)) {
      if (!Array.isArray(lista)) continue;
      for (const x of lista as { filename?: string; subfolder?: string; type?: string }[]) {
        const carpeta = x?.type ?? "output";
        if (x && typeof x.filename === "string" && (carpeta === "output" || carpeta === "temp")) out.push({ archivo: x.filename, subcarpeta: x.subfolder ?? "", tipo: clave, carpeta });
      }
    }
  }
  const guardadas = out.filter((x) => x.carpeta === "output");
  const elegidas = guardadas.length ? guardadas : out;
  return elegidas.filter((x, i) => elegidas.findIndex((y) => y.archivo === x.archivo && y.subcarpeta === x.subcarpeta && y.carpeta === x.carpeta) === i);
}

/** Carpeta de resultados de los workflows en ~/geeper-data. */
export const dirResultados = () => path.join(dirDatos(), "workflows");
