/**
 * Lo que manda el canal de avisos (/api/eventos, WEB-13) y cómo una pantalla dice cuáles le tocan. Sin
 * nada del servidor: lo importan la ruta y el navegador.
 */
export type TipoCambio = "trabajos" | "proyecto" | "motor";

/**
 * Algo cambió en la base. `ids`: los proyectos afectados (vacío = trabajos sin proyecto); sin `ids`, no
 * se sabe cuáles (se borró algo o fueron muchos) y les toca a todos.
 */
export interface Cambio {
  tipo: TipoCambio;
  ids?: string[];
}

/**
 * Filtro de una pantalla: «trabajos», «proyecto» o «motor» (cualquier cambio de ese tipo), o
 * «trabajos:<id>» / «proyecto:<id>» (sólo los de ese proyecto, o uno sin `ids`).
 */
export type FiltroAviso = TipoCambio | `trabajos:${string}` | `proyecto:${string}`;

export function coincide(filtro: string, c: Cambio): boolean {
  const i = filtro.indexOf(":");
  const tipo = i < 0 ? filtro : filtro.slice(0, i);
  if (tipo !== c.tipo) return false;
  if (i < 0 || !c.ids) return true;
  return c.ids.includes(filtro.slice(i + 1));
}
