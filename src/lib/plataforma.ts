/**
 * Dónde vive cada cosa según el sistema y según cómo corre Geeper:
 * - Desarrollo (repo en Linux/WSL, lo de siempre): datos en ~/geeper-data, herramientas en ~/dev/video-tools.
 * - App de escritorio (Electron pone GEEPER_ESCRITORIO=1 y las rutas): datos en Documentos/Geeper,
 *   herramientas en la carpeta de la app (%LOCALAPPDATA%\Geeper, ~/Library/Application Support/Geeper).
 * Las variables GEEPER_* siguen mandando sobre todo (pruebas, scripts).
 *
 * Sin dependencias de Electron: lo usan el servidor y el worker, que son procesos Node comunes.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Sistema = "windows" | "mac" | "linux";

export const SISTEMA: Sistema = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";

/** ¿Corre dentro de WSL? (Linux con el núcleo de Microsoft.) Su disco vive en un archivo de C: (DSC-06). */
export function esWsl(env: Record<string, string | undefined> = process.env): boolean {
  if (process.platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  } catch {
    return false;
  }
}

/** Corre como app de escritorio (lo fija la carcasa de Electron). */
export const ESCRITORIO = process.env.GEEPER_ESCRITORIO === "1";

/** «ffmpeg» → «ffmpeg.exe» en Windows. */
export const exe = (nombre: string) => (SISTEMA === "windows" && !nombre.toLowerCase().endsWith(".exe") ? `${nombre}.exe` : nombre);

/** Python dentro de un venv: `Scripts\python.exe` en Windows, `bin/python` en el resto. */
export const pythonDeVenv = (venv: string) => (SISTEMA === "windows" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python"));

/** Python del sistema para scripts sueltos (`python` en Windows, donde `python3` no suele existir). */
export const PYTHON_SISTEMA = process.env.GEEPER_PYTHON ?? (SISTEMA === "windows" ? "python" : "python3");

/** Carpeta de datos del usuario (proyectos, base, renders). */
export function datosPorDefecto(): string {
  if (!ESCRITORIO) return path.join(os.homedir(), "geeper-data");
  // Documentos es lo que una persona encuentra sola; la carcasa pasa la ruta real (OneDrive, otro idioma).
  return path.join(process.env.GEEPER_DOCUMENTOS ?? path.join(os.homedir(), "Documents"), "Geeper");
}

/** Carpeta de herramientas (ffmpeg, venvs de Python, CLIs de Craft, modelos). */
export function herramientasPorDefecto(): string {
  if (!ESCRITORIO) return path.join(os.homedir(), "dev", "video-tools");
  if (process.env.GEEPER_APPDATA) return path.join(process.env.GEEPER_APPDATA, "herramientas");
  if (SISTEMA === "windows") return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Geeper", "herramientas");
  if (SISTEMA === "mac") return path.join(os.homedir(), "Library", "Application Support", "Geeper", "herramientas");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "geeper", "herramientas");
}

/**
 * Programas que vienen dentro del instalador (ffmpeg, ffprobe): la carcasa pasa su carpeta en
 * GEEPER_RECURSOS. En desarrollo no hay: se usan los de siempre.
 */
export const RECURSOS = process.env.GEEPER_RECURSOS ?? null;

/**
 * Ejecutable de un CLI de Craft dentro de su carpeta `actual`. Cada sistema lo empaqueta distinto:
 * Windows (zip portable) lo trae en la raíz, macOS (zip del CLI) en la raíz de su carpeta, Linux en bin/.
 */
export function cliCraft(dirApp: string, nombre: string): string {
  if (SISTEMA === "linux") return path.join(dirApp, "actual", "bin", nombre);
  return path.join(dirApp, "actual", exe(nombre));
}

/**
 * Archivo de la release de un CLI de Craft para este sistema, cómo se descomprime y qué carpeta de
 * adentro queda como `actual` ("" = la carpeta donde se descomprimió: el zip de Windows no trae una).
 */
export function archivoCraft(app: string, version: string): { archivo: string; raiz: string; extraer: "tar" | "zip" } {
  if (SISTEMA === "windows") return { archivo: `${app}-${version}-windows-x64-portable.zip`, raiz: "", extraer: "zip" };
  if (SISTEMA === "mac") return { archivo: `${app}-cli-${version}-macos-universal.zip`, raiz: `${app}-cli-${version}-macos-universal`, extraer: "zip" };
  return { archivo: `${app}-${version}-linux-x86_64.tar.gz`, raiz: `${app}-${version}-linux-x86_64`, extraer: "tar" };
}
