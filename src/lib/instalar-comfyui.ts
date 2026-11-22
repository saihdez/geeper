/**
 * Instala ComfyUI con un clic (página Workflows), como proceso aparte (GPL-3.0: no viaja dentro de
 * Geeper; se baja de su repo al instalarlo). Pasos, cada uno se salta si ya está:
 *  1. El código en el commit fijado (COMFYUI_COMMIT), el .tar.gz de GitHub (sin Git).
 *  2. Python 3.12 propio con uv, en `<ComfyUI>/venv`.
 *  3. PyTorch 2.10 con CUDA 13 (el mismo de Wan2GP: la caché de uv no lo baja dos veces).
 *  4. Sus dependencias (requirements.txt: trae el editor y las plantillas del hub), con PyTorch fijado.
 *  5. Que PyTorch vea la GPU y que el catálogo de workflows se lea.
 * Los modelos de cada workflow se bajan sólo cuando se usa (workflows.ts).
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { instalarAtencionRapida } from "./atencion";
import { COMFYUI_DIR, COMFYUI_PYTHON, faltaComfyui, leerCatalogo } from "./comfyui";
import { entornoUv } from "./estudio";
import { bajar, carpetaRaiz } from "./instalar-craft";
import { INDICE_TORCH, TORCH } from "./instalar-wan2gp";
import { SISTEMA } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { UV } from "./rutas";

/** v0.46.0 (2026-11-20). Subirlo es trabajo de /novedades (fuente «comfyui»). */
export const COMFYUI_COMMIT = "0072b8680dd2db0b6d68c06f718fa33bd92a728c";
export const COMFYUI_PYTHON_VERSION = "3.12";
export const urlArchivoComfyui = (commit: string) => `https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/${commit}`;
const MARCA = ".geeper-commit";

export interface PasoComfyui {
  id: string;
  nombre: string;
  estado: "pendiente" | "trabajando" | "listo" | "error";
}

export interface EstadoComfyui {
  disponible: boolean;
  falta: string | null;
  corriendo: boolean;
  pasos: PasoComfyui[];
  error: string | null;
  registro: string[];
  inicio: string | null;
}

const PASOS = [
  { id: "codigo", nombre: "Descargar ComfyUI" },
  { id: "python", nombre: "Python propio" },
  { id: "pytorch", nombre: "PyTorch con CUDA (unos 3 GB, o nada si ya está el de Wan2GP)" },
  { id: "dependencias", nombre: "Lo que necesita ComfyUI, con su editor y sus plantillas (unos 2 GB)" },
  { id: "prueba", nombre: "Probar la GPU y leer el catálogo" },
] as const;

export const rutaRestricciones = (dir: string) => path.join(dir, "venv", "geeper-restricciones.txt");

/** Comandos de uv, en orden (función pura). */
export function comandosComfyui(dir: string, python: string): { paso: string; args: string[] }[] {
  return [
    { paso: "python", args: ["venv", "--python", COMFYUI_PYTHON_VERSION, path.join(dir, "venv")] },
    { paso: "pytorch", args: ["pip", "install", "--python", python, ...TORCH, "--index-url", INDICE_TORCH] },
    { paso: "dependencias", args: ["pip", "install", "--python", python, "-r", path.join(dir, "requirements.txt"), "-c", rutaRestricciones(dir)] },
  ];
}

interface Memoria {
  estado: EstadoComfyui;
  enCurso: Promise<void> | null;
}
const g = globalThis as unknown as { __comfyui?: Memoria };
const memoria = (): Memoria =>
  (g.__comfyui ??= {
    estado: { disponible: SISTEMA !== "mac", falta: null, corriendo: false, pasos: PASOS.map((p) => ({ ...p, estado: "pendiente" })), error: null, registro: [], inicio: null },
    enCurso: null,
  });

function anotar(linea: string) {
  const e = memoria().estado;
  for (const l of linea.split(/\r?\n|\r/).map((x) => x.trimEnd()).filter(Boolean)) e.registro.push(l.slice(0, 300));
  if (e.registro.length > 300) e.registro.splice(0, e.registro.length - 300);
}
function poner(id: string, estado: PasoComfyui["estado"]) {
  const p = memoria().estado.pasos.find((x) => x.id === id);
  if (p) p.estado = estado;
}

export async function bajarCodigoComfyui(dir: string, log: Registro) {
  const actual = await fs.readFile(path.join(dir, MARCA), "utf8").then((t) => t.trim(), () => null);
  if (actual === COMFYUI_COMMIT && existsSync(path.join(dir, "main.py"))) return log("El código ya está en la versión fijada.");
  if (existsSync(dir) && !existsSync(path.join(dir, MARCA))) {
    const dentro = (await fs.readdir(dir)).filter((n) => n !== "venv");
    if (dentro.length) throw new Error(`Ya hay una carpeta ${dir} que no instaló Geeper. Muévela o bórrala y vuelve a intentar.`);
  }
  log(`Descargando ComfyUI (${COMFYUI_COMMIT.slice(0, 7)})…`);
  const r = await bajar(urlArchivoComfyui(COMFYUI_COMMIT));
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al descargar ComfyUI`);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const tmp = await fs.mkdtemp(path.join(path.dirname(dir), ".comfyui-"));
  try {
    const archivo = path.join(tmp, "comfyui.tar.gz");
    await fs.writeFile(archivo, Buffer.from(await r.arrayBuffer()));
    await fs.mkdir(path.join(tmp, "x"));
    await correr("tar", ["-xzf", archivo, "-C", path.join(tmp, "x")], { log, timeout: 10 * 60_000 });
    const raiz = path.join(tmp, "x", await carpetaRaiz(path.join(tmp, "x"), ""));
    if (!existsSync(path.join(raiz, "main.py"))) throw new Error("El archivo de ComfyUI no trae main.py: no se instaló.");
    // Encima de lo que haya: el venv, los modelos (models/) y los resultados se conservan.
    await fs.cp(raiz, dir, { recursive: true, force: true });
    await fs.writeFile(path.join(dir, MARCA), `${COMFYUI_COMMIT}\n`);
    await fs.rm(path.join(dir, ".geeper-catalogo.json"), { force: true });
    log("Código de ComfyUI listo.");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function pythonListo(python: string) {
  if (!existsSync(python)) return false;
  const r = await correr(python, ["-c", "import sys; print(sys.version_info[:2] == (3, 12))"], { permitirFallo: true }).catch(() => null);
  return r?.stdout.trim() === "True";
}
async function torchListo(python: string) {
  const r = await correr(python, ["-c", "import torch; print(torch.__version__)"], { permitirFallo: true, timeout: 120_000 }).catch(() => null);
  return r?.codigo === 0 && r.stdout.trim().startsWith("2.10.");
}
async function dependenciasListas(dir: string, python: string) {
  const r = await correr(python, ["-c", "import comfyui_frontend_package, comfyui_workflow_templates, aiohttp, safetensors, av; print('ok')"], { cwd: dir, permitirFallo: true, timeout: 180_000 }).catch(() => null);
  return r?.codigo === 0 && r.stdout.includes("ok");
}

export function revisarComfyui(): EstadoComfyui {
  const m = memoria();
  if (!m.enCurso) m.estado.falta = m.estado.disponible ? faltaComfyui() : "Los workflows locales necesitan una tarjeta de video NVIDIA: en macOS no se puede.";
  return m.estado;
}

/** Empieza la instalación (si no hay otra) y vuelve enseguida; el avance se lee con revisarComfyui(). */
export function instalarComfyui(): EstadoComfyui {
  const m = memoria();
  if (!m.estado.disponible) throw new Error("Los workflows locales necesitan una tarjeta de video NVIDIA: en macOS no se puede.");
  if (m.enCurso) return m.estado;
  const e = m.estado;
  Object.assign(e, { corriendo: true, error: null, registro: [], inicio: new Date().toISOString(), pasos: PASOS.map((p) => ({ ...p, estado: "pendiente" })) });
  const dir = COMFYUI_DIR;
  const python = COMFYUI_PYTHON;
  const env = entornoUv();
  m.enCurso = (async () => {
    let actual = "codigo";
    try {
      const log: Registro = (l) => anotar(l);
      poner("codigo", "trabajando");
      await bajarCodigoComfyui(dir, log);
      poner("codigo", "listo");
      const comprobar: Record<string, () => Promise<boolean>> = {
        python: () => pythonListo(python),
        pytorch: () => torchListo(python),
        dependencias: () => dependenciasListas(dir, python),
      };
      for (const c of comandosComfyui(dir, python)) {
        actual = c.paso;
        poner(c.paso, "trabajando");
        if (await comprobar[c.paso]!()) log(`${c.paso}: ya estaba.`);
        else {
          if (c.paso === "dependencias") await fs.writeFile(rutaRestricciones(dir), `${TORCH.join("\n")}\n`);
          await correr(UV, c.args, { env, log, timeout: 90 * 60_000 });
          if (!(await comprobar[c.paso]!())) throw new Error("Se instaló pero no responde; mira el registro.");
        }
        poner(c.paso, "listo");
      }
      // Opcional: FlashAttention desde una rueda guardada (nunca hace fallar la instalación).
      await instalarAtencionRapida(python, log, env);
      actual = "prueba";
      poner("prueba", "trabajando");
      const r = await correr(python, ["-c", "import torch; ok = torch.cuda.is_available(); print(ok, torch.cuda.get_device_name(0) if ok else '')"], { log, permitirFallo: true, timeout: 120_000 });
      if (!r.stdout.trim().startsWith("True")) throw new Error("PyTorch no ve la GPU. Actualiza el driver de NVIDIA (R580 o más nuevo) y vuelve a intentar.");
      const { workflows } = await leerCatalogo(dir, python);
      log(`Catálogo: ${workflows.length} workflows (${workflows.filter((w) => w.local).length} corren en esta PC).`);
      poner("prueba", "listo");
      log("Listo: ya puedes usar los workflows.");
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      poner(actual, "error");
      anotar(`Error: ${msg}`);
      e.error = msg.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? msg;
    }
  })().finally(() => {
    e.corriendo = false;
    e.falta = faltaComfyui();
    m.enCurso = null;
  });
  return e;
}

