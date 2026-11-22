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
import { bajarArchivoCodigo, comandosPython, crearInstaladorPython, MARCA_COMMIT, modulosListos, pythonListo, torchListo, type EstadoPython, type PasoPython } from "./instalar-python";
import { INDICE_TORCH, TORCH } from "./instalar-wan2gp";
import { correr, type Registro } from "./proceso";

export { rutaRestricciones } from "./instalar-python";

/** v0.46.0 (2026-11-20). Subirlo es trabajo de /novedades (fuente «comfyui»). */
export const COMFYUI_COMMIT = "0072b8680dd2db0b6d68c06f718fa33bd92a728c";
export const COMFYUI_PYTHON_VERSION = "3.12";
export const urlArchivoComfyui = (commit: string) => `https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/${commit}`;

export type PasoComfyui = PasoPython;
export type EstadoComfyui = EstadoPython;

const PASOS = [
  { id: "codigo", nombre: "Descargar ComfyUI" },
  { id: "python", nombre: "Python propio" },
  { id: "pytorch", nombre: "PyTorch con CUDA (unos 3 GB, o nada si ya está el de Wan2GP)" },
  { id: "dependencias", nombre: "Lo que necesita ComfyUI, con su editor y sus plantillas (unos 2 GB)" },
  { id: "prueba", nombre: "Probar la GPU y leer el catálogo" },
] as const;

/** Comandos de uv, en orden (función pura). */
export function comandosComfyui(dir: string, python: string): { paso: string; args: string[] }[] {
  return comandosPython(dir, python, { versionPython: COMFYUI_PYTHON_VERSION, torch: TORCH, indiceTorch: INDICE_TORCH });
}

export async function bajarCodigoComfyui(dir: string, log: Registro) {
  const actual = await fs.readFile(path.join(dir, MARCA_COMMIT), "utf8").then((t) => t.trim(), () => null);
  if (actual === COMFYUI_COMMIT && existsSync(path.join(dir, "main.py"))) return log("El código ya está en la versión fijada.");
  await bajarArchivoCodigo({
    dir,
    commit: COMFYUI_COMMIT,
    url: urlArchivoComfyui(COMFYUI_COMMIT),
    nombre: "ComfyUI",
    principal: "main.py",
    ajena: `Ya hay una carpeta ${dir} que no instaló Geeper. Muévela o bórrala y vuelve a intentar.`,
    // El catálogo se vuelve a leer con el código nuevo.
    despues: (d) => fs.rm(path.join(d, ".geeper-catalogo.json"), { force: true }),
    log,
  });
}

const SIN_MAC = "Los workflows locales necesitan una tarjeta de video NVIDIA: en macOS no se puede.";

const instalador = crearInstaladorPython<EstadoComfyui>({
  clave: "__comfyui",
  pasos: PASOS,
  sinMac: SIN_MAC,
  falta: faltaComfyui,
  ubicacion: () => ({ dir: COMFYUI_DIR, python: COMFYUI_PYTHON }),
  bajarCodigo: bajarCodigoComfyui,
  comandos: comandosComfyui,
  comprobar: (dir, python) => ({
    python: () => pythonListo(python, COMFYUI_PYTHON_VERSION),
    pytorch: async () => Boolean(await torchListo(python, "2.10.")),
    dependencias: () => modulosListos(dir, python, ["comfyui_frontend_package", "comfyui_workflow_templates", "aiohttp", "safetensors", "av"]),
  }),
  restricciones: TORCH,
  extra: instalarAtencionRapida,
  probar: async (dir, python, log) => {
    const r = await correr(python, ["-c", "import torch; ok = torch.cuda.is_available(); print(ok, torch.cuda.get_device_name(0) if ok else '')"], { log, permitirFallo: true, timeout: 120_000 });
    if (!r.stdout.trim().startsWith("True")) throw new Error("PyTorch no ve la GPU. Actualiza el driver de NVIDIA (R580 o más nuevo) y vuelve a intentar.");
    const { workflows } = await leerCatalogo(dir, python);
    log(`Catálogo: ${workflows.length} workflows (${workflows.filter((w) => w.local).length} corren en esta PC).`);
  },
  listo: "Listo: ya puedes usar los workflows.",
});

export const revisarComfyui = (): EstadoComfyui => instalador.revisar();
/** Empieza la instalación (si no hay otra) y vuelve enseguida; el avance se lee con revisarComfyui(). */
export const instalarComfyui = (): EstadoComfyui => instalador.instalar();
