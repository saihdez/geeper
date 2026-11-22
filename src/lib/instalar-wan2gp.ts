/**
 * Instala Wan2GP con un clic (Sistema → «Wan2GP»), para animar escenas (plano.ts). Pasos, cada uno se
 * salta si ya está:
 *  1. El código, en el commit fijado (WAN2GP_COMMIT), en WAN2GP_DIR: el archivo .tar.gz de ese commit
 *     que publica GitHub (no hace falta Git; un equipo normal no lo tiene). Si la carpeta ya es un
 *     checkout de git (el estudio de desarrollo), se actualiza con git.
 *  2. Python 3.11 propio con uv, en `<Wan2GP>/venv` (nada se instala en el sistema).
 *  3. PyTorch 2.10 con CUDA 13 (lo que Wan2GP recomienda para RTX 20xx a 50xx; driver R580 o más nuevo).
 *  4. Sus dependencias (requirements.txt), con PyTorch fijado para que no lo cambie.
 *  5. Que PyTorch vea la GPU y que wgp.py valide una tarea de prueba (--dry-run, sin generar).
 * Los pesos de cada modelo los baja Wan2GP la primera vez que se usa (plano.ts muestra cuánto va).
 *
 * Una instalación a la vez; el estado vive en memoria del servidor y se lee con estadoWan2gp().
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { instalarAtencionRapida } from "./atencion";
import { entornoUv } from "./estudio";
import { bajar, carpetaRaiz } from "./instalar-craft";
import { aplicarParchesWan2gp } from "./parches-wan2gp";
import { SISTEMA } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { UV, WAN2GP_DIR } from "./rutas";
import { ajustesWan2gp, faltaEnInstalacion, instalacionWan2gp, modeloPlano, MODELO_POR_DEFECTO, probarWan2gp, type InstalacionWan2gp } from "./wan2gp";

/** El código de un commit, sin Git. */
export const urlArchivoWan2gp = (commit: string) => `https://codeload.github.com/deepbeepmeep/Wan2GP/tar.gz/${commit}`;
/** Marca con el commit instalado desde el archivo (en un checkout de git, manda git). */
const MARCA = ".geeper-commit";
/** Commit fijado (v20, 2026-11-17). Subirlo es trabajo de /novedades (fuente «wan2gp»). */
export const WAN2GP_COMMIT = "f4cfc1259215577be9a2ee280c41efbedfb4459a";
export const WAN2GP_PYTHON_VERSION = "3.11";
export const TORCH = ["torch==2.10.0", "torchvision==0.25.0", "torchaudio==2.10.0"] as const;
export const INDICE_TORCH = "https://download.pytorch.org/whl/cu130";
/**
 * Las dependencias se resuelven con lo publicado hasta el día siguiente al commit fijado: así la
 * instalación es la misma hoy que dentro de un mes, y no entra un paquete subido hace minutos (el
 * 2026-11-21 kaldifst 1.9.2 salió primero sin su versión para Windows y la instalación intentó compilarlo;
 * además, un paquete recién publicado es justo donde se cuela uno comprometido). Subirla va con el commit.
 */
export const FECHA_CORTE = "2026-11-18T00:00:00Z";

export interface PasoWan2gp {
  id: string;
  nombre: string;
  estado: "pendiente" | "trabajando" | "listo" | "error";
}

export interface EstadoWan2gp {
  /** false en macOS: Wan2GP necesita una GPU NVIDIA (o AMD con ROCm). */
  disponible: boolean;
  /** null si está instalado y validado. */
  falta: string | null;
  corriendo: boolean;
  pasos: PasoWan2gp[];
  error: string | null;
  registro: string[];
  /** Líneas anotadas desde el inicio (el registro guarda sólo las últimas). */
  lineas: number;
  inicio: string | null;
}

const PASOS = [
  { id: "codigo", nombre: "Descargar Wan2GP" },
  { id: "python", nombre: "Python propio" },
  { id: "pytorch", nombre: "PyTorch con CUDA (unos 3 GB)" },
  { id: "dependencias", nombre: "Lo que necesita Wan2GP (unos 3 GB)" },
  { id: "prueba", nombre: "Probar la GPU y Wan2GP" },
] as const;

/** Archivo de restricciones: las dependencias no pueden cambiar el PyTorch del paso anterior. */
export const rutaRestricciones = (dir: string) => path.join(dir, "venv", "geeper-restricciones.txt");

/**
 * Comandos de uv, en orden (función pura, para las pruebas). Las dependencias van con la estrategia de
 * índices por defecto de uv (cada paquete sale del primer índice que lo tiene): mezclar índices por
 * versión (`unsafe-best-match`) abre la puerta a que un paquete con el mismo nombre en otro índice se
 * cuele (revisión con Nemotron, 2026-11-20).
 */
export function comandosWan2gp(dir: string, python: string): { paso: string; args: string[] }[] {
  return [
    { paso: "python", args: ["venv", "--python", WAN2GP_PYTHON_VERSION, path.join(dir, "venv")] },
    { paso: "pytorch", args: ["pip", "install", "--python", python, ...TORCH, "--index-url", INDICE_TORCH] },
    {
      paso: "dependencias",
      // PyTorch ya está (con CUDA 13); las restricciones lo dejan como está.
      args: ["pip", "install", "--python", python, "-r", path.join(dir, "requirements.txt"), "-c", rutaRestricciones(dir), "--exclude-newer", FECHA_CORTE],
    },
  ];
}

const REGISTRO_MAX = 300;
interface Memoria {
  estado: EstadoWan2gp;
  enCurso: Promise<void> | null;
}
const g = globalThis as unknown as { __wan2gp?: Memoria };

function memoria(): Memoria {
  return (g.__wan2gp ??= {
    estado: { disponible: SISTEMA !== "mac", falta: null, corriendo: false, pasos: PASOS.map((p) => ({ ...p, estado: "pendiente" })), error: null, registro: [], lineas: 0, inicio: null },
    enCurso: null,
  });
}

function anotar(linea: string) {
  const e = memoria().estado;
  for (const l of linea.split(/\r?\n|\r/).map((x) => x.trimEnd()).filter(Boolean)) {
    e.registro.push(l.slice(0, 300));
    e.lineas++;
  }
  if (e.registro.length > REGISTRO_MAX) e.registro.splice(0, e.registro.length - REGISTRO_MAX);
}

function poner(id: string, estado: PasoWan2gp["estado"]) {
  const p = memoria().estado.pasos.find((x) => x.id === id);
  if (p) p.estado = estado;
}

/** Commit del código instalado: el de git si es un checkout; si no, el de la marca que deja el archivo. */
async function commitActual(dir: string): Promise<string | null> {
  if (existsSync(path.join(dir, ".git"))) {
    const r = await correr("git", ["-C", dir, "rev-parse", "HEAD"], { permitirFallo: true }).catch(() => null);
    return r?.codigo === 0 ? r.stdout.trim() : null;
  }
  return fs.readFile(path.join(dir, MARCA), "utf8").then((t) => t.trim(), () => null);
}

export async function bajarCodigo(dir: string, log: Registro) {
  if ((await commitActual(dir)) === WAN2GP_COMMIT && existsSync(path.join(dir, "wgp.py"))) return log("El código ya está en la versión fijada.");
  if (existsSync(path.join(dir, ".git"))) return bajarConGit(dir, log);
  if (existsSync(dir) && !existsSync(path.join(dir, MARCA))) {
    // Ni checkout ni instalado por Geeper: sólo se usa si está vacía (o tiene sólo el venv de un intento anterior).
    const dentro = (await fs.readdir(dir)).filter((n) => n !== "venv");
    if (dentro.length) throw new Error(`Ya hay una carpeta ${dir} que no es de Wan2GP. Muévela o bórrala y vuelve a intentar.`);
  }
  log(`Descargando Wan2GP (${WAN2GP_COMMIT.slice(0, 7)})…`);
  const r = await bajar(urlArchivoWan2gp(WAN2GP_COMMIT));
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al descargar Wan2GP`);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const tmp = await fs.mkdtemp(path.join(path.dirname(dir), ".wan2gp-"));
  try {
    const archivo = path.join(tmp, "wan2gp.tar.gz");
    await fs.writeFile(archivo, Buffer.from(await r.arrayBuffer()));
    await fs.mkdir(path.join(tmp, "x"));
    // tar viene con Windows 10+ y macOS; en Linux siempre está.
    await correr("tar", ["-xzf", archivo, "-C", path.join(tmp, "x")], { log, timeout: 10 * 60_000 });
    const raiz = path.join(tmp, "x", await carpetaRaiz(path.join(tmp, "x"), ""));
    if (!existsSync(path.join(raiz, "wgp.py"))) throw new Error("El archivo de Wan2GP no trae wgp.py: no se instaló.");
    // Encima de lo que haya: el venv y los pesos (ckpts/) de una versión anterior se conservan.
    await fs.cp(raiz, dir, { recursive: true, force: true });
    await fs.writeFile(path.join(dir, MARCA), `${WAN2GP_COMMIT}\n`);
    await aplicarParchesWan2gp(dir, log);
    log("Código de Wan2GP listo.");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** El estudio de desarrollo puede tener Wan2GP como checkout de git: se actualiza con git. */
async function bajarConGit(dir: string, log: Registro) {
  const git = await correr("git", ["--version"], { permitirFallo: true }).catch(() => null);
  if (git?.codigo !== 0) throw new Error(`${dir} es un checkout de git y no hay Git en este equipo. Instálalo (git-scm.com) o borra la carpeta para instalarlo sin Git.`);
  // Un Wan2GP con cambios propios no se toca.
  const cambios = await correr("git", ["-C", dir, "status", "--porcelain", "--untracked-files=no"], { log });
  if (cambios.stdout.trim()) throw new Error(`Wan2GP en ${dir} tiene cambios sin guardar; no lo toco. Guárdalos (git stash) o usa otra carpeta con GEEPER_WAN2GP.`);
  // Sólo ese commit, sin la historia: es mucho más liviano.
  await correr("git", ["-C", dir, "fetch", "--depth", "1", "origin", WAN2GP_COMMIT], { log, timeout: 30 * 60_000 });
  await correr("git", ["-C", dir, "checkout", "-q", "--detach", "FETCH_HEAD"], { log });
}

async function pythonListo(python: string): Promise<boolean> {
  if (!existsSync(python)) return false;
  const r = await correr(python, ["-c", "import sys; print(sys.version_info[:2] == (3, 11))"], { permitirFallo: true }).catch(() => null);
  return r?.stdout.trim() === "True";
}

async function torchListo(python: string): Promise<string | null> {
  const r = await correr(python, ["-c", "import torch; print(torch.__version__)"], { permitirFallo: true, timeout: 120_000 }).catch(() => null);
  return r?.codigo === 0 && r.stdout.trim().startsWith("2.10.") ? r.stdout.trim() : null;
}

async function dependenciasListas(i: InstalacionWan2gp): Promise<boolean> {
  // mmgp viene dentro de la carpeta de Wan2GP: se importa desde ahí.
  const r = await correr(i.python, ["-c", "import diffusers, transformers, mmgp, gradio, decord, cv2; print('ok')"], { cwd: i.dir, permitirFallo: true, timeout: 180_000 }).catch(() => null);
  return r?.codigo === 0 && r.stdout.includes("ok");
}

async function probar(i: InstalacionWan2gp, log: Registro) {
  const r = await correr(i.python, ["-c", "import torch; ok = torch.cuda.is_available(); print(ok, torch.cuda.get_device_name(0) if ok else '')"], { log, permitirFallo: true, timeout: 120_000 });
  if (!r.stdout.trim().startsWith("True")) {
    throw new Error("PyTorch no ve la GPU. Actualiza el driver de NVIDIA (hace falta R580 o más nuevo para CUDA 13) y vuelve a intentar.");
  }
  log(`GPU: ${r.stdout.trim().replace(/^True\s*/, "")}`);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-wan2gp-"));
  try {
    const ajustes = ajustesWan2gp(modeloPlano(MODELO_POR_DEFECTO), { prompt: "a calm sea at sunset", formato: "9:16", segundos: 1, semilla: 1 });
    const v = await probarWan2gp(i, ajustes, tmp);
    log(v.mensaje);
    if (!v.ok) {
      // La última línea de un traceback suele ser el consejo, no el error: se busca la línea del error.
      const lineas = v.mensaje.split("\n").map((l) => l.trim()).filter(Boolean);
      const error = lineas.findLast((l) => /(Error|Exception)\b.*:/.test(l)) ?? lineas.at(-1);
      throw new Error(`Wan2GP no validó la tarea de prueba: ${error}`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Lo que falta (null si está instalado: código, Python y wgp.py). La GPU se prueba al instalar. */
export function revisarWan2gp(): EstadoWan2gp {
  const m = memoria();
  if (!m.enCurso) m.estado.falta = m.estado.disponible ? faltaEnInstalacion(instalacionWan2gp()) : "Wan2GP necesita una GPU NVIDIA: en macOS no se puede.";
  return m.estado;
}

/** Empieza la instalación (si no hay otra) y vuelve enseguida; el avance se lee con revisarWan2gp(). */
export function instalarWan2gp(): EstadoWan2gp {
  const m = memoria();
  if (!m.estado.disponible) throw new Error("Wan2GP necesita una GPU NVIDIA: en macOS no se puede.");
  if (m.enCurso) return m.estado;
  const e = m.estado;
  Object.assign(e, { corriendo: true, error: null, registro: [], lineas: 0, inicio: new Date().toISOString(), pasos: PASOS.map((p) => ({ ...p, estado: "pendiente" })) });
  const i = instalacionWan2gp(WAN2GP_DIR);
  const env = entornoUv();
  m.enCurso = (async () => {
    let actual = "codigo";
    try {
      const log: Registro = (l) => anotar(l);
      poner("codigo", "trabajando");
      await bajarCodigo(i.dir, log);
      poner("codigo", "listo");

      const comprobar: Record<string, () => Promise<boolean>> = {
        python: () => pythonListo(i.python),
        pytorch: async () => Boolean(await torchListo(i.python)),
        dependencias: () => dependenciasListas(i),
      };
      for (const c of comandosWan2gp(i.dir, i.python)) {
        actual = c.paso;
        poner(c.paso, "trabajando");
        if (await comprobar[c.paso]!()) log(`${c.paso}: ya estaba.`);
        else {
          if (c.paso === "dependencias") await fs.writeFile(rutaRestricciones(i.dir), `${TORCH.join("\n")}\n`);
          await correr(UV, c.args, { env, log, timeout: 90 * 60_000 });
          if (!(await comprobar[c.paso]!())) throw new Error("Se instaló pero no responde; mira el registro.");
        }
        poner(c.paso, "listo");
      }
      // Opcional: FlashAttention desde una rueda guardada (nunca hace fallar la instalación).
      await instalarAtencionRapida(i.python, log, env);
      actual = "prueba";
      poner("prueba", "trabajando");
      await probar(i, log);
      poner("prueba", "listo");
      log("Listo: ya puedes animar escenas.");
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      poner(actual, "error");
      anotar(`Error: ${msg}`);
      e.error = msg.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? msg;
    }
  })().finally(() => {
    e.corriendo = false;
    e.falta = faltaEnInstalacion(i);
    m.enCurso = null;
  });
  return e;
}

/** Espera a que termine la instalación en curso (scripts y pruebas). */
export async function esperarWan2gp(): Promise<EstadoWan2gp> {
  await memoria().enCurso;
  return memoria().estado;
}
