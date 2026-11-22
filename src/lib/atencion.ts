/**
 * Atención rápida para Wan2GP y ComfyUI: Geeper mira qué hay instalado en el venv de cada motor y
 * le pasa la mejor opción al arrancarlo. Orden: SageAttention (la más rápida en video) > FlashAttention 2
 * > la de PyTorch (sdpa, la de siempre). Wan2GP en «auto» nunca elige flash por su cuenta y ComfyUI
 * necesita la opción explícita; si flash falla en una capa, ComfyUI vuelve a sdpa solo, y en Wan2GP los
 * modelos que piden su propia atención la siguen usando.
 *
 * GEEPER_ATENCION=auto (por defecto) | sage | flash | sdpa. Con «sdpa» se apaga todo (vía de escape si
 * algo falla); con «sage» o «flash» se fuerza aunque no se detecte.
 *
 * FlashAttention no tiene ruedas oficiales para torch 2.9+ (2026-11): se compila una vez con
 * `~/dev/video-tools/bin/flash-attn <venv>` y la rueda queda en <herramientas>/ruedas/torch<versión>/.
 * Los instaladores la ponen sola si encuentran una para su Python y su torch; si no, siguen sin ella.
 */
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { correr, type Registro } from "./proceso";
import { ESTUDIO, UV } from "./rutas";

export type Atencion = "sage" | "flash" | "sdpa";
export interface AtencionInstalada {
  sage: boolean;
  flash: boolean;
}

/** Carpetas site-packages de un venv a partir de su python (Linux/mac: lib/pythonX.Y; Windows: Lib). */
export function sitePackages(python: string): string[] {
  const venv = path.dirname(path.dirname(python));
  const salida = [path.join(venv, "Lib", "site-packages")];
  const lib = path.join(venv, "lib");
  try {
    for (const d of readdirSync(lib)) if (d.startsWith("python")) salida.push(path.join(lib, d, "site-packages"));
  } catch {
    // sin lib/: venv de Windows o no existe
  }
  return salida.filter((d) => existsSync(d));
}

/** Qué hay instalado, mirando el disco (sin arrancar Python: se llama en cada lanzamiento). */
export function atencionInstalada(python: string): AtencionInstalada {
  const r = { sage: false, flash: false };
  for (const sp of sitePackages(python)) {
    let nombres: string[];
    try {
      nombres = readdirSync(sp);
    } catch {
      continue;
    }
    if (nombres.includes("sageattention")) r.sage = true;
    // El módulo compilado es lo que importa: sin él, flash_attn/ es sólo Python que no carga.
    if (nombres.some((n) => /^flash_attn_2_cuda\..*(so|pyd)$/.test(n))) r.flash = true;
  }
  return r;
}

/** La atención a usar (función pura). */
export function elegirAtencion(inst: AtencionInstalada, pedido = process.env.GEEPER_ATENCION): Atencion {
  const p = (pedido ?? "auto").trim().toLowerCase();
  if (p === "sage" || p === "flash" || p === "sdpa") return p;
  return inst.sage ? "sage" : inst.flash ? "flash" : "sdpa";
}

/**
 * Argumentos para wgp.py. Con sage se deja «auto» (Wan2GP elige sage2 o sage según la tarjeta); sdpa
 * por defecto tampoco lleva nada, salvo que se pida a mano (pisa una elección guardada en la interfaz).
 */
export function argsAtencionWan2gp(a: Atencion, pedido = process.env.GEEPER_ATENCION): string[] {
  if (a === "flash") return ["--attention", "flash"];
  if (a === "sdpa" && pedido?.trim().toLowerCase() === "sdpa") return ["--attention", "sdpa"];
  return [];
}

/** Argumentos para main.py de ComfyUI (sdpa es su opción por defecto). */
export function argsAtencionComfyui(a: Atencion): string[] {
  if (a === "sage") return ["--use-sage-attention"];
  if (a === "flash") return ["--use-flash-attention"];
  return [];
}

// ---------------------------------------------------------------------------------------------------
// Instalación desde una rueda guardada

export const DIR_RUEDAS = process.env.GEEPER_RUEDAS ?? path.join(ESTUDIO, "ruedas");

/** La rueda de flash-attn para ese Python y torch, si está (función pura sobre la lista de archivos). */
export function elegirRueda(archivos: string[], cp: string, plataforma: string): string | null {
  const re = new RegExp(`^flash_attn-[^-]+-${cp}-${cp}-${plataforma}\\.whl$`);
  return archivos.filter((a) => re.test(a)).sort().at(-1) ?? null;
}

const SONDA = "import sys, platform, torch; print(f'cp{sys.version_info[0]}{sys.version_info[1]}', torch.__version__, 'win_amd64' if platform.system() == 'Windows' else f'linux_{platform.machine()}')";
const PRUEBA = "import flash_attn, flash_attn_2_cuda; print(flash_attn.__version__)";

/**
 * Pone FlashAttention en el venv si hay una rueda guardada para su Python y su torch. Nunca hace fallar
 * la instalación: si no hay rueda o no carga, lo dice en el registro y la quita. No usa la GPU.
 */
export async function instalarAtencionRapida(python: string, log: Registro, env?: Record<string, string>): Promise<boolean> {
  try {
    if ((await correr(python, ["-c", PRUEBA], { permitirFallo: true, timeout: 120_000 })).codigo === 0) {
      log("Atención rápida: FlashAttention ya estaba.");
      return true;
    }
    const sonda = await correr(python, ["-c", SONDA], { permitirFallo: true, timeout: 120_000 });
    const [cp, torch, plataforma] = sonda.stdout.trim().split(/\s+/);
    if (sonda.codigo !== 0 || !cp || !torch || !plataforma) {
      log("Atención rápida: no se pudo leer la versión de Python/PyTorch; se sigue sin FlashAttention.");
      return false;
    }
    const dir = path.join(DIR_RUEDAS, `torch${torch}`);
    const rueda = elegirRueda(await fs.readdir(dir).catch(() => []), cp, plataforma);
    if (!rueda) {
      log(`Atención rápida: no hay FlashAttention compilado para ${cp} y torch ${torch}; se usa la atención de PyTorch.`);
      return false;
    }
    await correr(UV, ["pip", "install", "--python", python, "--no-deps", path.join(dir, rueda)], { env, log, timeout: 10 * 60_000 });
    if ((await correr(python, ["-c", PRUEBA], { permitirFallo: true, timeout: 120_000 })).codigo === 0) {
      log(`Atención rápida: FlashAttention instalado (${rueda}).`);
      return true;
    }
    log("Atención rápida: FlashAttention no cargó con este PyTorch; se quita y se usa la de PyTorch.");
    await correr(UV, ["pip", "uninstall", "--python", python, "flash-attn"], { env, log, permitirFallo: true, timeout: 5 * 60_000 });
    return false;
  } catch (x) {
    log(`Atención rápida: se sigue sin FlashAttention (${x instanceof Error ? x.message.split("\n")[0] : x}).`);
    return false;
  }
}
