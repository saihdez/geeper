/**
 * Lo común de los instaladores de un clic de programas en Python (ComfyUI y Wan2GP; COD-08): bajar el
 * código de un commit fijado como .tar.gz de GitHub, un Python propio con uv, PyTorch con CUDA, las
 * dependencias con PyTorch fijado, FlashAttention opcional y una prueba final. Cada paso se salta si ya
 * está. Una instalación a la vez; el estado vive en memoria del servidor (en `globalThis`, para que el
 * recargado de Next no lo pierda) y se lee con `revisar()`.
 *
 * Lo propio de cada uno va en su archivo: git y el contador de líneas en Wan2GP, borrar la caché del
 * catálogo en ComfyUI, y qué se importa y qué se prueba al final.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { exigirEspacio, type OpcionesEspacio } from "./espacio";
import { entornoUv } from "./estudio";
import { bajar, carpetaRaiz } from "./instalar-craft";
import { SISTEMA } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { UV } from "./rutas";

export interface PasoPython {
  id: string;
  nombre: string;
  estado: "pendiente" | "trabajando" | "listo" | "error";
}

export interface EstadoPython {
  /** false en macOS: hace falta una GPU NVIDIA. */
  disponible: boolean;
  /** null si está instalado. */
  falta: string | null;
  corriendo: boolean;
  pasos: PasoPython[];
  error: string | null;
  registro: string[];
  inicio: string | null;
}

/** Marca con el commit instalado desde el archivo. */
export const MARCA_COMMIT = ".geeper-commit";
/** Archivo de restricciones: las dependencias no pueden cambiar el PyTorch del paso anterior. */
export const rutaRestricciones = (dir: string) => path.join(dir, "venv", "geeper-restricciones.txt");

/** Comandos de uv, en orden (función pura): Python propio, PyTorch del índice de CUDA y las dependencias. */
export function comandosPython(
  dir: string,
  python: string,
  o: { versionPython: string; torch: readonly string[]; indiceTorch: string; extraDependencias?: string[] },
): { paso: string; args: string[] }[] {
  return [
    { paso: "python", args: ["venv", "--python", o.versionPython, path.join(dir, "venv")] },
    { paso: "pytorch", args: ["pip", "install", "--python", python, ...o.torch, "--index-url", o.indiceTorch] },
    // PyTorch ya está (con CUDA); las restricciones lo dejan como está.
    { paso: "dependencias", args: ["pip", "install", "--python", python, "-r", path.join(dir, "requirements.txt"), "-c", rutaRestricciones(dir), ...(o.extraDependencias ?? [])] },
  ];
}

/**
 * Baja el código de `url` (un .tar.gz de GitHub, sin Git) y lo copia encima de `dir`: el venv, los
 * modelos y los resultados de una versión anterior se conservan. Deja la marca con el commit.
 */
export async function bajarArchivoCodigo(o: {
  dir: string;
  commit: string;
  url: string;
  nombre: string;
  /** Archivo que tiene que traer el código (main.py, wgp.py). */
  principal: string;
  /** Mensaje si la carpeta existe, tiene algo y no la instaló Geeper. */
  ajena: string;
  /** Lo propio de cada uno, con el código ya copiado y antes de «listo». */
  despues?: (dir: string, log: Registro) => Promise<unknown>;
  log: Registro;
}): Promise<void> {
  const { dir, log } = o;
  if (existsSync(dir) && !existsSync(path.join(dir, MARCA_COMMIT))) {
    // Sólo se usa si está vacía (o tiene sólo el venv de un intento anterior).
    const dentro = (await fs.readdir(dir)).filter((n) => n !== "venv");
    if (dentro.length) throw new Error(o.ajena);
  }
  log(`Descargando ${o.nombre} (${o.commit.slice(0, 7)})…`);
  const r = await bajar(o.url);
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al descargar ${o.nombre}`);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const base = o.nombre.toLowerCase();
  const tmp = await fs.mkdtemp(path.join(path.dirname(dir), `.${base}-`));
  try {
    const archivo = path.join(tmp, `${base}.tar.gz`);
    await fs.writeFile(archivo, Buffer.from(await r.arrayBuffer()));
    await fs.mkdir(path.join(tmp, "x"));
    // tar viene con Windows 10+ y macOS; en Linux siempre está.
    await correr("tar", ["-xzf", archivo, "-C", path.join(tmp, "x")], { log, timeout: 10 * 60_000 });
    const raiz = path.join(tmp, "x", await carpetaRaiz(path.join(tmp, "x"), ""));
    if (!existsSync(path.join(raiz, o.principal))) throw new Error(`El archivo de ${o.nombre} no trae ${o.principal}: no se instaló.`);
    await fs.cp(raiz, dir, { recursive: true, force: true });
    await fs.writeFile(path.join(dir, MARCA_COMMIT), `${o.commit}\n`);
    await o.despues?.(dir, log);
    log(`Código de ${o.nombre} listo.`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** El Python del venv es de la versión pedida («3.12» → (3, 12)). */
export async function pythonListo(python: string, version: string): Promise<boolean> {
  if (!existsSync(python)) return false;
  const [ma, mi] = version.split(".");
  const r = await correr(python, ["-c", `import sys; print(sys.version_info[:2] == (${Number(ma)}, ${Number(mi)}))`], { permitirFallo: true }).catch(() => null);
  return r?.stdout.trim() === "True";
}

/** La versión de PyTorch instalada si empieza con `prefijo` («2.10.»); si no, null. */
export async function torchListo(python: string, prefijo: string): Promise<string | null> {
  const r = await correr(python, ["-c", "import torch; print(torch.__version__)"], { permitirFallo: true, timeout: 120_000 }).catch(() => null);
  return r?.codigo === 0 && r.stdout.trim().startsWith(prefijo) ? r.stdout.trim() : null;
}

/** Se pueden importar `modulos` desde `dir` (la carpeta del programa trae algunos propios). */
export async function modulosListos(dir: string, python: string, modulos: string[]): Promise<boolean> {
  const r = await correr(python, ["-c", `import ${modulos.join(", ")}; print('ok')`], { cwd: dir, permitirFallo: true, timeout: 180_000 }).catch(() => null);
  return r?.codigo === 0 && r.stdout.includes("ok");
}

export interface ConfigInstaladorPython {
  /** Dónde guarda su memoria en `globalThis` (`__comfyui`, `__wan2gp`). */
  clave: string;
  pasos: readonly { id: string; nombre: string }[];
  /** Mensaje en macOS, donde no se puede. */
  sinMac: string;
  /** Cuenta las líneas anotadas desde el inicio en `estado.lineas` (el registro guarda sólo las últimas). */
  contarLineas?: boolean;
  /** Qué falta (null si está instalado), sin probar nada pesado. */
  falta: () => string | null;
  /** Carpeta y Python de la instalación, leídos al empezar. */
  ubicacion: () => { dir: string; python: string };
  bajarCodigo: (dir: string, log: Registro) => Promise<void>;
  comandos: (dir: string, python: string) => { paso: string; args: string[] }[];
  /** Si cada paso de `comandos` ya está. */
  comprobar: (dir: string, python: string) => Record<string, () => Promise<boolean>>;
  /** Lo que va en el archivo de restricciones antes de las dependencias (el PyTorch fijado). */
  restricciones: readonly string[];
  /** Opcional entre las dependencias y la prueba (FlashAttention): nunca hace fallar la instalación. */
  extra?: (python: string, log: Registro, env: Record<string, string>) => Promise<unknown>;
  probar: (dir: string, python: string, log: Registro) => Promise<void>;
  /** Última línea del registro cuando todo salió bien. */
  listo: string;
  /**
   * Lo que ocupa la instalación (venv, PyTorch y dependencias), para mirar el disco antes de empezar
   * (DSC-05). `para`, en palabras simples: «instalar los workflows».
   */
  espacio?: { bytes: number; para: string };
  /** Para las pruebas: cómo se mira el disco. */
  opcionesEspacio?: OpcionesEspacio;
  /** Para las pruebas: otro uv y otro entorno. */
  uv?: string;
  entorno?: () => Record<string, string>;
}

const REGISTRO_MAX = 300;

export function crearInstaladorPython<E extends EstadoPython>(c: ConfigInstaladorPython) {
  interface Memoria {
    estado: E;
    enCurso: Promise<void> | null;
  }
  const g = globalThis as unknown as Record<string, Memoria | undefined>;
  const nuevosPasos = (): PasoPython[] => c.pasos.map((p) => ({ ...p, estado: "pendiente" }));
  const memoria = (): Memoria =>
    (g[c.clave] ??= {
      estado: {
        disponible: SISTEMA !== "mac", falta: null, corriendo: false, pasos: nuevosPasos(), error: null, registro: [],
        ...(c.contarLineas ? { lineas: 0 } : {}), inicio: null,
      } as unknown as E,
      enCurso: null,
    });

  function anotar(linea: string) {
    const e = memoria().estado as E & { lineas?: number };
    for (const l of linea.split(/\r?\n|\r/).map((x) => x.trimEnd()).filter(Boolean)) {
      e.registro.push(l.slice(0, 300));
      if (c.contarLineas) e.lineas = (e.lineas ?? 0) + 1;
    }
    if (e.registro.length > REGISTRO_MAX) e.registro.splice(0, e.registro.length - REGISTRO_MAX);
  }
  function poner(id: string, estado: PasoPython["estado"]) {
    const p = memoria().estado.pasos.find((x) => x.id === id);
    if (p) p.estado = estado;
  }

  /** Lo que falta; mientras instala, el último valor. */
  function revisar(): E {
    const m = memoria();
    if (!m.enCurso) m.estado.falta = m.estado.disponible ? c.falta() : c.sinMac;
    return m.estado;
  }

  /** Empieza la instalación (si no hay otra) y vuelve enseguida; el avance se lee con revisar(). */
  function instalar(): E {
    const m = memoria();
    if (!m.estado.disponible) throw new Error(c.sinMac);
    if (m.enCurso) return m.estado;
    const e = m.estado;
    Object.assign(e, { corriendo: true, error: null, registro: [], ...(c.contarLineas ? { lineas: 0 } : {}), inicio: new Date().toISOString(), pasos: nuevosPasos() });
    const { dir, python } = c.ubicacion();
    const env = (c.entorno ?? entornoUv)();
    m.enCurso = (async () => {
      let actual = "codigo";
      try {
        const log: Registro = (l) => anotar(l);
        poner("codigo", "trabajando");
        // Antes de bajar nada (DSC-05): si no cabe con la reserva, se dice y no se empieza.
        if (c.espacio) await exigirEspacio(dir, c.espacio.bytes, c.espacio.para, c.opcionesEspacio);
        await c.bajarCodigo(dir, log);
        poner("codigo", "listo");
        const comprobar = c.comprobar(dir, python);
        for (const paso of c.comandos(dir, python)) {
          actual = paso.paso;
          poner(paso.paso, "trabajando");
          if (await comprobar[paso.paso]!()) log(`${paso.paso}: ya estaba.`);
          else {
            if (paso.paso === "dependencias") await fs.writeFile(rutaRestricciones(dir), `${c.restricciones.join("\n")}\n`);
            await correr(c.uv ?? UV, paso.args, { env, log, timeout: 90 * 60_000 });
            if (!(await comprobar[paso.paso]!())) throw new Error("Se instaló pero no responde; mira el registro.");
          }
          poner(paso.paso, "listo");
        }
        await c.extra?.(python, log, env);
        actual = "prueba";
        poner("prueba", "trabajando");
        await c.probar(dir, python, log);
        poner("prueba", "listo");
        log(c.listo);
      } catch (x) {
        const msg = x instanceof Error ? x.message : String(x);
        poner(actual, "error");
        anotar(`Error: ${msg}`);
        e.error = msg.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? msg;
      }
    })().finally(() => {
      e.corriendo = false;
      e.falta = c.falta();
      m.enCurso = null;
    });
    return e;
  }

  /** Espera a que termine la instalación en curso (scripts y pruebas). */
  async function esperar(): Promise<E> {
    await memoria().enCurso;
    return memoria().estado;
  }

  return { revisar, instalar, esperar };
}
