/**
 * Procesos largos que usan la tarjeta (ComfyUI, Wan2GP) y viven en su propio grupo. Si el proceso que los
 * lanzó muere a mitad (worker caído, terminal cerrada a la fuerza), nadie los cierra: la tarjeta queda
 * tomada y la IA de MPT apagada hasta reiniciar (WRK-04). Por eso cada uno queda anotado en
 * `<datos>/_procesos/<pid>.json` mientras vive, y al arrancar el worker se cierran los que quedaron sin dueño.
 *
 * Sólo SIGTERM al grupo, nunca SIGKILL: gpu-solo necesita su `trap` para volver a encender la IA de MPT (y
 * si no llegó a hacerlo, mpt.generar y títulos la encienden al necesitarla, ver ia-mpt.ts).
 * Sólo POSIX: en Windows no se anota nada.
 */
import type { ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dirDatos } from "./rutas";

export const dirProcesos = () => path.join(dirDatos(), "_procesos");

interface Anotado {
  pid: number;
  nombre: string;
  /** Hora de arranque del proceso según el sistema (`/proc/<pid>/stat`), para no confundirlo con un PID reciclado. */
  inicio: string | null;
  dueno: number;
  inicioDueno: string | null;
}

/** Hora de arranque de un proceso (campo 22 de /proc/<pid>/stat, en ticks desde el arranque). Null si no se sabe. */
export function inicioDe(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // El nombre (campo 2) va entre paréntesis y puede traer espacios: se cuenta desde el último «)».
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const grupoVivo = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

/** ¿Sigue vivo el mismo proceso (no otro con su PID)? Sin hora de arranque, basta con que viva. */
const mismo = (pid: number, inicio: string | null) => vivo(pid) && (inicio === null || inicioDe(pid) === inicio);

/**
 * Anota un proceso lanzado con `detached` (su PID es el de su grupo) mientras vive. Se borra solo al cerrarse.
 */
export function anotarProceso(hijo: ChildProcess, nombre: string): void {
  if (process.platform === "win32" || !hijo.pid) return;
  const pid = hijo.pid;
  const archivo = path.join(dirProcesos(), `${pid}.json`);
  const dato: Anotado = { pid, nombre, inicio: inicioDe(pid), dueno: process.pid, inicioDueno: inicioDe(process.pid) };
  try {
    mkdirSync(dirProcesos(), { recursive: true });
    writeFileSync(archivo, JSON.stringify(dato));
  } catch {
    return; // anotar es una ayuda; no debe impedir el trabajo
  }
  hijo.once("close", () => rmSync(archivo, { force: true }));
}

/**
 * Cierra (SIGTERM al grupo) los procesos anotados cuyo dueño ya murió y borra sus notas. Los de un dueño vivo
 * (p. ej. el ComfyUI del editor, que lanza la web) no se tocan. Devuelve los nombres de los que cerró.
 */
export function cerrarHuerfanos(log?: (l: string) => void): string[] {
  if (process.platform === "win32") return [];
  let nombres: string[];
  try {
    nombres = readdirSync(dirProcesos()).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const cerrados: string[] = [];
  for (const n of nombres) {
    const archivo = path.join(dirProcesos(), n);
    let a: Anotado;
    try {
      a = JSON.parse(readFileSync(archivo, "utf8")) as Anotado;
      if (!Number.isInteger(a.pid) || a.pid <= 1) throw new Error("nota inválida");
    } catch {
      rmSync(archivo, { force: true });
      continue;
    }
    if (a.dueno === process.pid || mismo(a.dueno, a.inicioDueno)) continue;
    // El que lo lanzó (gpu-lock) puede haber muerto con el grupo vivo: mientras el grupo exista, su número
    // no se reasigna, así que el grupo sigue siendo el nuestro. Si el líder vive, se compara su arranque.
    const nuestro = vivo(a.pid) ? mismo(a.pid, a.inicio) : grupoVivo(a.pid);
    if (nuestro) {
      try {
        process.kill(-a.pid, "SIGTERM");
        cerrados.push(a.nombre);
        log?.(`${a.nombre} (grupo ${a.pid}) quedó sin dueño: se cierra para liberar la tarjeta`);
      } catch {
        /* ya terminó */
      }
    }
    rmSync(archivo, { force: true });
  }
  return cerrados;
}
