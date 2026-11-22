/** Tareas periódicas del worker que no son de un trabajo concreto (separadas para poder probarlas). */
import { readFile } from "node:fs/promises";
import { latido, recuperarVencidos } from "@/lib/cola";
import { db } from "@/lib/db";
import { candadoArchivo, type Candado } from "@/lib/gpu";
import { rutaBaseDatos } from "@/lib/rutas";

/** Cada cuánto se mira si alguien canceló un trabajo en curso (el latido del lease va cada 15 s). */
export const REVISAR_CANCELADOS_MS = 2000;

/**
 * De los trabajos que corren aquí, los que ya no son nuestros: la persona los canceló (o otro los
 * recuperó). Una sola consulta liviana; así cancelar llega en ~2 s y no hasta 15 (WRK-13).
 */
export async function yaNoSonNuestros(enCurso: Iterable<string>, workerId: string): Promise<string[]> {
  const ids = [...enCurso];
  if (!ids.length) return [];
  const filas = await db.trabajo.findMany({ where: { id: { in: ids } }, select: { id: true, estado: true, workerId: true } });
  const nuestros = new Set(filas.filter((f) => f.estado === "corriendo" && f.workerId === workerId).map((f) => f.id));
  return ids.filter((id) => !nuestros.has(id));
}

/**
 * Barrido de leases vencidos sin cortar los trabajos propios (WRK-06). Tras una suspensión del equipo o un
 * Ctrl+Z de más de 90 s, todos los leases están vencidos, también los de este worker, y el barrido podía
 * tocar antes que el latido de cada trabajo: un render sano se cortaba o empezaba de cero. Por eso se
 * renuevan primero los leases de lo que corre aquí y después se barre.
 *
 * Devuelve los recuperados y los ids propios que ya no son nuestros (cancelados o recuperados por otro).
 */
export async function barrerLeases(enCurso: Iterable<string>, workerId: string): Promise<{ recuperados: number; perdidos: string[] }> {
  const ids = [...enCurso];
  const sigue = await Promise.all(ids.map((id) => latido(id, workerId)));
  const perdidos = ids.filter((_, i) => !sigue[i]);
  const recuperados = await recuperarVencidos();
  return { recuperados, perdidos };
}

/** Tope para que los trabajos cortados terminen al apagar (gpu-solo tarda en volver a encender MPT). */
export const TOPE_APAGAR_MS = 12_000;

/**
 * Espera a que `enCurso` quede vacío (cada trabajo lo deja en su `finally`, después de que sus procesos
 * salieron y de anotarse «interrumpido») o a que pase `topeMs`. Devuelve true si quedó vacío (WRK-07).
 */
export async function esperarVacio(enCurso: { readonly size: number }, topeMs = TOPE_APAGAR_MS, pasoMs = 100): Promise<boolean> {
  const limite = Date.now() + topeMs;
  while (enCurso.size > 0) {
    if (Date.now() >= limite) return false;
    await new Promise((ok) => setTimeout(ok, pasoMs));
  }
  return true;
}

/** Candado de «un worker por cola»: va junto a la base, así cada instancia (GEEPER_DB) tiene el suyo. */
export const rutaCandadoWorker = () => `${rutaBaseDatos()}.worker.lock`;

/**
 * Toma el candado de worker (WRK-10). Si otro worker vivo lo tiene, reintenta hasta `esperaMs` (en Windows los
 * PID se reciclan rápido: el latido del candado vence a los 60 s) y devuelve el PID del otro si no lo suelta.
 */
export async function tomarCandadoWorker(op: { archivo?: string; esperaMs?: number; pasoMs?: number } = {}): Promise<{ candado: Candado } | { otro: number | null }> {
  const archivo = op.archivo ?? rutaCandadoWorker();
  const limite = Date.now() + (op.esperaMs ?? 65_000);
  for (;;) {
    const candado = await candadoArchivo(archivo, "worker", { esperar: false });
    if (candado) return { candado };
    if (Date.now() >= limite) {
      const otro = await readFile(archivo, "utf8").then((t) => Number((JSON.parse(t) as { pid?: unknown }).pid) || null).catch(() => null);
      return { otro };
    }
    await new Promise((ok) => setTimeout(ok, op.pasoMs ?? 2000));
  }
}
