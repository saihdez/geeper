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
import { bajarArchivoCodigo, comandosPython, crearInstaladorPython, MARCA_COMMIT, modulosListos, pythonListo, torchListo, type EstadoPython, type PasoPython } from "./instalar-python";
import { aplicarParchesWan2gp } from "./parches-wan2gp";
import { correr, type Registro } from "./proceso";
import { WAN2GP_DIR } from "./rutas";
import { ajustesWan2gp, faltaEnInstalacion, instalacionWan2gp, modeloPlano, MODELO_POR_DEFECTO, probarWan2gp, type InstalacionWan2gp } from "./wan2gp";

export { rutaRestricciones } from "./instalar-python";

/** El código de un commit, sin Git. */
export const urlArchivoWan2gp = (commit: string) => `https://codeload.github.com/deepbeepmeep/Wan2GP/tar.gz/${commit}`;
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

export type PasoWan2gp = PasoPython;

export interface EstadoWan2gp extends EstadoPython {
  /** Líneas anotadas desde el inicio (el registro guarda sólo las últimas). */
  lineas: number;
}

const PASOS = [
  { id: "codigo", nombre: "Descargar Wan2GP" },
  { id: "python", nombre: "Python propio" },
  { id: "pytorch", nombre: "PyTorch con CUDA (unos 3 GB)" },
  { id: "dependencias", nombre: "Lo que necesita Wan2GP (unos 3 GB)" },
  { id: "prueba", nombre: "Probar la GPU y Wan2GP" },
] as const;

/**
 * Comandos de uv, en orden (función pura, para las pruebas). Las dependencias van con la estrategia de
 * índices por defecto de uv (cada paquete sale del primer índice que lo tiene): mezclar índices por
 * versión (`unsafe-best-match`) abre la puerta a que un paquete con el mismo nombre en otro índice se
 * cuele (revisión con Nemotron, 2026-11-20).
 */
export function comandosWan2gp(dir: string, python: string): { paso: string; args: string[] }[] {
  return comandosPython(dir, python, { versionPython: WAN2GP_PYTHON_VERSION, torch: TORCH, indiceTorch: INDICE_TORCH, extraDependencias: ["--exclude-newer", FECHA_CORTE] });
}

/** Commit del código instalado: el de git si es un checkout; si no, el de la marca que deja el archivo. */
async function commitActual(dir: string): Promise<string | null> {
  if (existsSync(path.join(dir, ".git"))) {
    const r = await correr("git", ["-C", dir, "rev-parse", "HEAD"], { permitirFallo: true }).catch(() => null);
    return r?.codigo === 0 ? r.stdout.trim() : null;
  }
  return fs.readFile(path.join(dir, MARCA_COMMIT), "utf8").then((t) => t.trim(), () => null);
}

export async function bajarCodigo(dir: string, log: Registro) {
  if ((await commitActual(dir)) === WAN2GP_COMMIT && existsSync(path.join(dir, "wgp.py"))) return log("El código ya está en la versión fijada.");
  if (existsSync(path.join(dir, ".git"))) return bajarConGit(dir, log);
  await bajarArchivoCodigo({
    dir,
    commit: WAN2GP_COMMIT,
    url: urlArchivoWan2gp(WAN2GP_COMMIT),
    nombre: "Wan2GP",
    principal: "wgp.py",
    // Ni checkout ni instalado por Geeper.
    ajena: `Ya hay una carpeta ${dir} que no es de Wan2GP. Muévela o bórrala y vuelve a intentar.`,
    // Encima de lo que haya: el venv y los pesos (ckpts/) de una versión anterior se conservan.
    despues: aplicarParchesWan2gp,
    log,
  });
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

const instalador = crearInstaladorPython<EstadoWan2gp>({
  clave: "__wan2gp",
  pasos: PASOS,
  sinMac: "Wan2GP necesita una GPU NVIDIA: en macOS no se puede.",
  contarLineas: true,
  // Lo que falta (null si está instalado: código, Python y wgp.py). La GPU se prueba al instalar.
  falta: () => faltaEnInstalacion(instalacionWan2gp()),
  ubicacion: () => instalacionWan2gp(WAN2GP_DIR),
  bajarCodigo,
  comandos: comandosWan2gp,
  comprobar: (dir, python) => ({
    python: () => pythonListo(python, WAN2GP_PYTHON_VERSION),
    pytorch: async () => Boolean(await torchListo(python, "2.10.")),
    // mmgp viene dentro de la carpeta de Wan2GP: se importa desde ahí.
    dependencias: () => modulosListos(dir, python, ["diffusers", "transformers", "mmgp", "gradio", "decord", "cv2"]),
  }),
  restricciones: TORCH,
  extra: instalarAtencionRapida,
  probar: (dir, python, log) => probar(instalacionWan2gp(dir, python), log),
  listo: "Listo: ya puedes animar escenas.",
});

/** Lo que falta (null si está instalado: código, Python y wgp.py). La GPU se prueba al instalar. */
export const revisarWan2gp = (): EstadoWan2gp => instalador.revisar();
/** Empieza la instalación (si no hay otra) y vuelve enseguida; el avance se lee con revisarWan2gp(). */
export const instalarWan2gp = (): EstadoWan2gp => instalador.instalar();
/** Espera a que termine la instalación en curso (scripts y pruebas). */
export const esperarWan2gp = (): Promise<EstadoWan2gp> => instalador.esperar();
