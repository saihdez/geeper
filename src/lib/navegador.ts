/**
 * El Chrome sin ventana (chrome-headless-shell) que ya baja Hyperframes, en desarrollo
 * (~/.cache/hyperframes) o en la app de escritorio (CACHE_HF). Un solo lugar que cambiar si Hyperframes
 * mueve su caché (COD-02).
 *
 * No lanza error si no lo encuentra: quien lo usa cae a propósito al navegador de Playwright.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CACHE_HF } from "./rutas";

const SUBCARPETAS = ["chrome-headless-shell-linux64", "chrome-headless-shell-win64", "chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"];
const EJECUTABLES = ["chrome-headless-shell", "chrome-headless-shell.exe"];

/** Ruta del ejecutable (la versión más nueva de la primera caché que lo tenga) o `undefined`. */
export function rutaChrome(bases: string[] = [path.join(os.homedir(), ".cache", "hyperframes"), CACHE_HF]): string | undefined {
  for (const base of bases) {
    const raiz = path.join(base, "chrome", "chrome-headless-shell");
    let versiones: string[];
    try {
      versiones = fs.readdirSync(raiz).sort().reverse();
    } catch {
      continue; // no está en esta carpeta
    }
    for (const v of versiones) {
      for (const sub of SUBCARPETAS) {
        for (const exe of EJECUTABLES) {
          const ruta = path.join(raiz, v, sub, exe);
          if (fs.existsSync(ruta)) return ruta;
        }
      }
    }
  }
  return undefined;
}

/** Abre el navegador; si no arranca, lo dice en palabras simples y deja el detalle técnico al final. */
export async function abrirNavegador<T>(lanzar: () => Promise<T>): Promise<T> {
  try {
    return await lanzar();
  } catch (e) {
    const detalle = e instanceof Error ? e.message.split("\n")[0] : String(e);
    throw new Error(`No se pudo abrir el navegador sin ventana que usa Geeper. Abre «Sistema» y revisa que Hyperframes esté listo. (Detalle: ${detalle})`);
  }
}
