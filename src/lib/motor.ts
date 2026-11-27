/** El motor (worker) deja un latido en la base; si el último tiene más de un minuto, está apagado. */
export const LATIDO_MAX_MS = 60_000;

export function motorVivo(latido: Date | null, ahora: number): boolean {
  return !!latido && ahora - latido.getTime() < LATIDO_MAX_MS;
}
