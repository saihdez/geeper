import path from "node:path";

/**
 * Archivos de los que depende la captura de Hyperframes: todos los del proyecto menos la mezcla de
 * audio (REN-07). El sonido de la entrega sale del WAV, así que cambiar sólo el audio no recaptura.
 * El crudo queda con el audio de cuando se capturó: no se usa para nada más.
 */
export function entradasCaptura(archivos: string[], rutaMezcla: string): string[] {
  const mezcla = path.resolve(rutaMezcla);
  return archivos.filter((a) => path.resolve(a) !== mezcla);
}
