/**
 * Mensajes de error de las peticiones de la web, en palabras simples. El texto que manda el servidor
 * (`{ error }`) pasa tal cual; sólo se traducen los fallos sin texto (red caída, código HTTP pelado).
 */

export const SIN_CONEXION = "No hay conexión con Geeper. Revisa que siga abierto y vuelve a intentar.";
export const RECONECTANDO = "Se perdió la conexión con Geeper. Reconectando…";

/** El navegador no llegó al servidor (Geeper cerrado, reiniciándose o sin red local). */
export class ErrorConexion extends Error {
  constructor() {
    super(SIN_CONEXION);
    this.name = "ErrorConexion";
  }
}

/** Mensaje para una respuesta que no fue bien: el del servidor si lo hay, si no uno según el código. */
export function mensajeHttp(status: number, delServidor?: unknown): string {
  if (typeof delServidor === "string" && delServidor.trim()) return delServidor;
  if (status === 404) return "Eso ya no existe.";
  if (status === 413) return "El archivo es demasiado grande.";
  return "Algo falló dentro de Geeper. Vuelve a intentar.";
}

/** `fetch` que convierte el fallo de red en un `ErrorConexion` (una cancelación sigue siendo cancelación). */
export async function traer(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (init?.signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
    throw new ErrorConexion();
  }
}

/** Saca el `error` de un cuerpo JSON, si lo hay. */
export function errorDelCuerpo(texto: string): unknown {
  try {
    const d = JSON.parse(texto) as { error?: unknown } | null;
    return d && typeof d === "object" ? d.error : undefined;
  } catch {
    return undefined;
  }
}
