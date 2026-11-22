/**
 * Partes puras de Workflows que usan tanto la página como el servidor (sin `node:`): qué entradas se
 * quedan sin archivo y cómo decirlo en palabras simples (UX-04).
 */

/** Lo que pide cada tipo de entrada, en palabras simples. */
const TU_ARCHIVO: Record<string, string> = { image: "tu imagen", video: "tu video", audio: "tu audio" };
export const tuArchivo = (medio: string) => TU_ARCHIVO[medio] ?? "tu archivo";

/**
 * Si la receta trae de verdad el archivo de ejemplo de una entrada: está en su catálogo o ya en
 * `ComfyUI/input/` (función pura). Muchas recetas nombran un ejemplo que no viene con ComfyUI (UX-04).
 */
export function hayEjemplo(archivo: string | null, catalogo: Record<string, string>, enInput: (nombre: string) => boolean): boolean {
  return !!archivo && (Object.hasOwn(catalogo, archivo) || enInput(archivo));
}

/** Las entradas que se quedan sin nada: ni las subió la persona ni la receta trae ejemplo (función pura). */
export function entradasSinArchivo<E extends { nodo: number | string; archivo: string | null; medio: string }>(entradas: E[], subidos: (number | string)[], ejemplo: (e: E) => boolean): E[] {
  return entradas.filter((e) => !subidos.some((s) => String(s) === String(e.nodo)) && !ejemplo(e));
}

/** «Falta subir tu imagen.» (o «tu imagen y tu video»). */
export function textoFaltaArchivo(medios: string[]): string {
  const nombres = [...new Set(medios.map(tuArchivo))];
  return `Falta subir ${nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0]}.`;
}
