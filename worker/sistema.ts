/** Tareas periódicas del worker que no son de un trabajo concreto (separadas para poder probarlas). */
import { latido, recuperarVencidos } from "@/lib/cola";

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
