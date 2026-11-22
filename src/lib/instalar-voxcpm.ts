/**
 * Instala VoxCPM2 (voces diseñadas: voces.ts) con un clic, desde donde se diseña una voz. Pasos, cada uno
 * se salta si ya está:
 *  1. Python 3.12 propio con uv, en `<herramientas>/venvs/voxcpm` (nada se instala en el sistema).
 *  2. PyTorch 2.11 con CUDA 12.8 (el mismo que el estudio de desarrollo; ~3 GB).
 *  3. voxcpm y sus dependencias, con PyTorch fijado y sólo lo publicado hasta FECHA_CORTE.
 *  4. Los pesos de openbmb/VoxCPM2 en la revisión fijada (~4,6 GB), en `<herramientas>/modelos/VoxCPM2`.
 *  5. Una toma corta de prueba en la GPU. Si sale bien, deja la marca y la voz queda disponible.
 *
 * Una instalación a la vez; el estado vive en memoria del servidor y se lee con revisarVoxcpm().
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { entornoUv } from "./estudio";
import { SISTEMA } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { UV } from "./rutas";
import { DIR_MODELO_VOXCPM, marcaVoxcpm, probarVoxcpm, PYTHON_VOXCPM, vozInstalada } from "./voces";

export const VOXCPM_PYTHON_VERSION = "3.12";
export const TORCH = ["torch==2.11.0", "torchaudio==2.11.0"] as const;
export const INDICE_TORCH = "https://download.pytorch.org/whl/cu128";
export const PAQUETES = ["voxcpm==2.0.3", "soundfile==0.14.0"] as const;
/**
 * kaldifst (de wetext) 1.9.1 y 1.9.2 salieron el 2026-11-19/21 y su versión para Windows llegó horas
 * después: sin ella uv intenta compilarla y falla. La 1.9.0 tiene ruedas para Windows, Linux y macOS.
 */
export const RESTRICCIONES = [...TORCH, "kaldifst==1.9.0"] as const;
/** Lo publicado hasta el día siguiente al venv del estudio de desarrollo (2026-11-20): instalación repetible. */
export const FECHA_CORTE = "2026-11-21T00:00:00Z";
export const MODELO_REPO = "openbmb/VoxCPM2";
export const MODELO_REVISION = "7936080b41163874f38610f46f438e2c0757f9fd";

export interface PasoVoxcpm {
  id: string;
  nombre: string;
  estado: "pendiente" | "trabajando" | "listo" | "error";
}

export interface EstadoVoxcpm {
  /** false en macOS: VoxCPM2 en Geeper necesita una GPU NVIDIA. */
  disponible: boolean;
  instalada: boolean;
  corriendo: boolean;
  pasos: PasoVoxcpm[];
  error: string | null;
  registro: string[];
}

const PASOS = [
  { id: "python", nombre: "Python propio" },
  { id: "pytorch", nombre: "PyTorch con CUDA (unos 3 GB)" },
  { id: "dependencias", nombre: "VoxCPM2 y lo que necesita (unos 2 GB)" },
  { id: "modelo", nombre: "El modelo de voz (unos 4,6 GB)" },
  { id: "prueba", nombre: "Probar una voz en la tarjeta gráfica" },
] as const;

const venv = () => path.dirname(path.dirname(PYTHON_VOXCPM));
const rutaRestricciones = () => path.join(venv(), "geeper-restricciones.txt");

/** Comandos de uv, en orden (función pura, para las pruebas). */
export function comandosVoxcpm(dirVenv: string, python: string, restricciones: string): { paso: string; args: string[] }[] {
  return [
    { paso: "python", args: ["venv", "--python", VOXCPM_PYTHON_VERSION, dirVenv] },
    { paso: "pytorch", args: ["pip", "install", "--python", python, ...TORCH, "--index-url", INDICE_TORCH] },
    { paso: "dependencias", args: ["pip", "install", "--python", python, ...PAQUETES, "-c", restricciones, "--exclude-newer", FECHA_CORTE] },
  ];
}

/** Script de Python que baja los pesos en la revisión fijada (sin enlaces simbólicos: sirve en Windows). */
export function scriptModelo(destino: string): string {
  return `from huggingface_hub import snapshot_download; print(snapshot_download(${JSON.stringify(MODELO_REPO)}, revision=${JSON.stringify(MODELO_REVISION)}, local_dir=${JSON.stringify(destino)}))`;
}

const REGISTRO_MAX = 200;
interface Memoria {
  estado: EstadoVoxcpm;
  enCurso: Promise<void> | null;
}
const g = globalThis as unknown as { __voxcpm?: Memoria };

function memoria(): Memoria {
  return (g.__voxcpm ??= {
    estado: { disponible: SISTEMA !== "mac", instalada: false, corriendo: false, pasos: PASOS.map((p) => ({ ...p, estado: "pendiente" })), error: null, registro: [] },
    enCurso: null,
  });
}

function anotar(linea: string) {
  const e = memoria().estado;
  for (const l of linea.split(/\r?\n|\r/).map((x) => x.trimEnd()).filter(Boolean)) e.registro.push(l.slice(0, 300));
  if (e.registro.length > REGISTRO_MAX) e.registro.splice(0, e.registro.length - REGISTRO_MAX);
}

function poner(id: string, estado: PasoVoxcpm["estado"]) {
  const p = memoria().estado.pasos.find((x) => x.id === id);
  if (p) p.estado = estado;
}

async function importa(modulos: string): Promise<boolean> {
  if (!existsSync(PYTHON_VOXCPM)) return false;
  const r = await correr(PYTHON_VOXCPM, ["-I", "-c", `import ${modulos}`], { permitirFallo: true, timeout: 180_000 }).catch(() => null);
  return r?.codigo === 0;
}

const comprobar: Record<string, () => Promise<boolean>> = {
  python: async () => existsSync(PYTHON_VOXCPM),
  pytorch: () => importa("torch, torchaudio"),
  dependencias: () => importa("voxcpm, soundfile"),
};

export function revisarVoxcpm(): EstadoVoxcpm {
  const m = memoria();
  m.estado.instalada = vozInstalada();
  return m.estado;
}

/** Empieza la instalación (si no hay otra) y vuelve enseguida; el avance se lee con revisarVoxcpm(). */
export function instalarVoxcpm(): EstadoVoxcpm {
  const m = memoria();
  if (!m.estado.disponible) throw new Error("Las voces diseñadas necesitan una tarjeta gráfica NVIDIA: en macOS todavía no se puede.");
  if (m.enCurso) return m.estado;
  const e = m.estado;
  Object.assign(e, { corriendo: true, error: null, registro: [], pasos: PASOS.map((p) => ({ ...p, estado: "pendiente" })) });
  const env = entornoUv();
  const log: Registro = (l) => anotar(l);
  m.enCurso = (async () => {
    let actual = "python";
    try {
      for (const c of comandosVoxcpm(venv(), PYTHON_VOXCPM, rutaRestricciones())) {
        actual = c.paso;
        poner(c.paso, "trabajando");
        if (await comprobar[c.paso]!()) log(`${c.paso}: ya estaba.`);
        else {
          if (c.paso === "dependencias") await fs.writeFile(rutaRestricciones(), `${RESTRICCIONES.join("\n")}\n`);
          await correr(UV, c.args, { env, log, timeout: 90 * 60_000 });
          if (!(await comprobar[c.paso]!())) throw new Error("Se instaló pero no responde; mira el registro.");
        }
        poner(c.paso, "listo");
      }

      actual = "modelo";
      poner("modelo", "trabajando");
      await fs.mkdir(DIR_MODELO_VOXCPM, { recursive: true });
      // Si ya está, snapshot_download sólo revisa y vuelve enseguida.
      await correr(PYTHON_VOXCPM, ["-I", "-c", scriptModelo(DIR_MODELO_VOXCPM)], { log, timeout: 120 * 60_000, env: { HF_HUB_DISABLE_TELEMETRY: "1" } });
      if (!existsSync(path.join(DIR_MODELO_VOXCPM, "model.safetensors"))) throw new Error("El modelo no quedó completo; vuelve a intentar.");
      poner("modelo", "listo");

      actual = "prueba";
      poner("prueba", "trabajando");
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-voxcpm-"));
      try {
        // La primera carga justo después de bajar el modelo puede caerse en Windows (0xC0000005, el
        // antivirus revisando el archivo de 4,6 GB recién escrito; pasó una vez el 2026-11-21): se reintenta.
        await probarVoxcpm(log, tmp).catch(async (x: Error) => {
          log(`La primera prueba falló (${x.message.slice(0, 120)}); se intenta otra vez…`);
          await probarVoxcpm(log, tmp);
        });
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
      await fs.writeFile(marcaVoxcpm(), JSON.stringify({ modelo: MODELO_REPO, revision: MODELO_REVISION, probada: new Date().toISOString() }, null, 2));
      poner("prueba", "listo");
      log("Listo: ya puedes crear voces describiéndolas.");
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      poner(actual, "error");
      anotar(`Error: ${msg}`);
      e.error = msg.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? msg;
    }
  })().finally(() => {
    e.corriendo = false;
    e.instalada = vozInstalada();
    m.enCurso = null;
  });
  return e;
}

/** Espera a que termine la instalación en curso (scripts y pruebas). */
export async function esperarVoxcpm(): Promise<EstadoVoxcpm> {
  await memoria().enCurso;
  return memoria().estado;
}
