/**
 * Reglas de la carcasa de escritorio (escritorio/main.ts) sin Electron, para poder probarlas.
 */

/**
 * ¿Se puede volver a lanzar el worker? La misma regla que `pnpm run dev:up` (scripts/dev-up.ts): hasta
 * `max` reinicios en `ventanaMs`. Si se puede, anota este reinicio en `historial`.
 */
export function permitirReinicio(historial: number[], ahora: number, max = 5, ventanaMs = 10 * 60_000): boolean {
  const recientes = historial.filter((t) => ahora - t < ventanaMs);
  historial.splice(0, historial.length, ...recientes);
  if (historial.length >= max) return false;
  historial.push(ahora);
  return true;
}
