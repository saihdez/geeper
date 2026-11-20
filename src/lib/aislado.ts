/**
 * Aislamiento con bubblewrap para el material que viene de fuera (D2 de docs/STACK-AGENTICO.md).
 *
 * Los demuxers de ffmpeg y las librerías de imagen tienen CVE cada año, y leer un archivo hostil es
 * justo donde pegan. Cuando ffmpeg o ffprobe leen algo de `_fuentes/` (lo bajado de internet) o de
 * `_subidos/` (lo que se arrastró a la web), corren dentro de `bwrap`: **sin red**, con todo el sistema
 * de archivos en sólo lectura salvo la carpeta de salida, `/tmp` propio y sin sobrevivir al padre.
 *
 * Si `bwrap` no está (o el kernel no deja crear el espacio de nombres), se corre como siempre y el
 * doctor lo avisa. `GEEPER_AISLAR=0` lo apaga.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { correr, type OpcionesCorrer, type Resultado } from "./proceso";
import { dirDatos } from "./rutas";

export const BWRAP = process.env.GEEPER_BWRAP ?? "/usr/bin/bwrap";

/** Carpetas cuyo contenido viene de fuera. */
export const dirsExternos = () => [path.join(dirDatos(), "_fuentes"), path.join(dirDatos(), "_subidos")];

export function esExterno(ruta: string): boolean {
  const abs = path.resolve(ruta);
  return dirsExternos().some((d) => abs === d || abs.startsWith(`${d}${path.sep}`));
}

/** Argumentos de bwrap para correr `cmd` sin red y escribiendo sólo en `escribibles` (función pura). */
export function argsBwrap(cmd: string, args: string[], escribibles: string[]): string[] {
  const unicos = [...new Set(escribibles.map((d) => path.resolve(d)))];
  return [
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-uts",
    "--die-with-parent",
    "--new-session",
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    ...unicos.flatMap((d) => ["--bind", d, d]),
    "--",
    cmd,
    ...args,
  ];
}

let disponible: Promise<boolean> | null = null;

/** ¿Se puede aislar? bwrap instalado y capaz de crear el espacio de nombres (se prueba una vez). */
export function puedeAislar(): Promise<boolean> {
  if (process.env.GEEPER_AISLAR === "0") return Promise.resolve(false);
  disponible ??= existsSync(BWRAP)
    ? correr(BWRAP, argsBwrap("/bin/true", [], []), { permitirFallo: true, timeout: 10_000 }).then((r) => r.codigo === 0, () => false)
    : Promise.resolve(false);
  return disponible;
}

/** Sólo para pruebas: olvida la detección. */
export function reiniciarDeteccion(): void {
  disponible = null;
}

/** El comando a correr: aislado si hace falta y se puede, tal cual si no. */
export async function comando(cmd: string, args: string[], entradas: string[], escribibles: string[]): Promise<{ cmd: string; args: string[]; aislado: boolean }> {
  if (!entradas.some(esExterno) || !(await puedeAislar())) return { cmd, args, aislado: false };
  return { cmd: BWRAP, args: argsBwrap(cmd, args, escribibles), aislado: true };
}

/** `correr` con aislamiento si alguna entrada viene de fuera. */
export async function correrSiExterno(cmd: string, args: string[], entradas: string[], escribibles: string[], op: OpcionesCorrer = {}): Promise<Resultado> {
  const c = await comando(cmd, args, entradas, escribibles);
  return correr(c.cmd, c.args, op);
}

/** Entradas (`-i <ruta>`) y carpeta de salida (último argumento) de una línea de ffmpeg (función pura). */
export function entradasYSalida(args: string[]): { entradas: string[]; salidas: string[] } {
  const entradas = args.flatMap((a, i) => (args[i - 1] === "-i" && !/^[a-z]+:/i.test(a) ? [a] : []));
  const ultimo = args.at(-1);
  const salidas = ultimo && ultimo !== "-" && args.at(-2) !== "-i" && !/^pipe:/.test(ultimo) ? [path.dirname(path.resolve(ultimo))] : [];
  return { entradas, salidas };
}
