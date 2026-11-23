/**
 * UX-41: cómo decir en la lista de Trabajos que un trabajo ya se intentó antes. Sin nada del servidor:
 * lo usa la pantalla con lo que entrega /api/trabajos (`anteriores`, que guarda `relanzar` de cola.ts).
 */
import { segundos } from "./formato";

/** Lo que se guarda de cada intento que terminó mal (la misma forma que IntentoAnterior de cola.ts). */
export interface IntentoPrevio {
  estado: string;
  error: string | null;
  iniciado: string | null;
  terminado: string | null;
}

const QUE_PASO: Record<string, string> = { fallido: "falló", interrumpido: "se cortó", cancelado: "se canceló" };

/**
 * «2.º intento (el 1.º falló a los 6 min 36 s)»; con más de uno, se nombra el último. null si es el
 * primer intento.
 */
export function textoIntentos(anteriores: readonly IntentoPrevio[] | null | undefined): string | null {
  if (!anteriores?.length) return null;
  const n = anteriores.length;
  const ultimo = anteriores[n - 1]!;
  const paso = QUE_PASO[ultimo.estado] ?? "no terminó";
  const ini = ultimo.iniciado ? Date.parse(ultimo.iniciado) : NaN;
  const fin = ultimo.terminado ? Date.parse(ultimo.terminado) : NaN;
  const cuando = Number.isFinite(ini) && Number.isFinite(fin) ? ` a los ${segundos(Math.max(0, (fin - ini) / 1000))}` : ultimo.iniciado ? "" : " antes de empezar";
  return `${n + 1}.º intento (el ${n}.º ${paso}${cuando})`;
}
