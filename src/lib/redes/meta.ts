/**
 * Lo que comparten Facebook e Instagram (las dos son Graph API de Meta, COD-09): la versión de Graph,
 * la lectura de los errores, el pedido con el token y la subida por tramos a rupload.facebook.com.
 * Cada red conserva sus códigos de error propios y sus rutas (facebook.ts, instagram.ts).
 */
import { TIMEOUT_SUBIDA_MS, errorDe, leerTramo, pedir, pedirJson } from "./http";
import { registrarSecreto, tapar } from "./secretos";
import { ErrorRed, type ArchivoVideo, type ResultadoTramo, type Sesion } from "./tipos";

/** Última versión estable de Graph API (v27.0, 4 nov. 2026; es la de los ejemplos de la doc de Meta). */
// VERIFICAR: la página de cambios de v27.0 aún daba 404 al implementar; la lista de versiones mostraba v26.0.
export const GRAPH_VERSION = "v27.0";

export interface ErrorGraph {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

/** Clasificador de un cuerpo de error (lo que reciben pedirJson y errorDe). */
export type Clasificador = (cuerpo: string) => ErrorRed | null;

/** Límites de llamadas comunes a Graph (4, 17, 32, 613): se espera 1 h. */
const LIMITES_LLAMADAS = new Set([4, 17, 32, 613]);

/** Error de cuota que se reintenta después de `ms`. */
export const cuota = (msg: string, ms: number) => new ErrorRed("cuota", msg, new Date(Date.now() + ms), 429);
export const HORA_MS = 60 * 60_000;

/**
 * Lee el error de Graph: 190/102 → auth; los códigos propios de la red (`propio`); límites de llamadas →
 * cuota 1 h. Lo demás queda para errorDe (error común de la red con el estado HTTP). El mensaje pasa por tapar.
 */
export function clasificarErrorGraph(contexto: string, propio?: (e: ErrorGraph, msg: string) => ErrorRed | null): Clasificador {
  return (cuerpo) => {
    let e: ErrorGraph | undefined;
    try {
      e = (JSON.parse(cuerpo) as { error?: ErrorGraph }).error;
    } catch {
      return null;
    }
    if (!e) return null;
    const msg = tapar(`${contexto}: ${e.message ?? "error de Graph"} (code ${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""})`);
    if (e.code === 190 || e.code === 102) return new ErrorRed("auth", msg, undefined, 401);
    const p = propio?.(e, msg);
    if (p) return p;
    if (e.code !== undefined && LIMITES_LLAMADAS.has(e.code)) return cuota(msg, HORA_MS);
    return null;
  };
}

/** Pedido a Graph (`base` = https://graph.<facebook|instagram>.com/<versión>) con el token en Authorization. */
export function crearGraph(base: string, clasificar: (contexto: string) => Clasificador) {
  return async function graph<T>(c: { acceso: string }, ruta: string, contexto: string, init: RequestInit = {}): Promise<T> {
    registrarSecreto(c.acceso); // por si el cuerpo de un error lo repite
    return pedirJson<T>(
      `${base}${ruta}`,
      { ...init, headers: { Authorization: `Bearer ${c.acceso}`, ...(init.headers as Record<string, string> | undefined) } },
      contexto,
      clasificar(contexto),
    );
  };
}

/** Un dato de texto de la sesión de subida, o error claro con el nombre de la red. */
export function textoSesion(s: Sesion, k: string, red: string): string {
  const v = s[k];
  if (typeof v !== "string" || !v) throw new ErrorRed("red", `La sesión de ${red} no tiene ${k}`);
  return v;
}

/**
 * URL de rupload; sólo se acepta https://rupload.facebook.com (ahí va el token). Si la red no mandó una
 * válida se arma la de siempre: `tipo` es video-upload (Facebook) o ig-api-upload (Instagram).
 */
export function uriSubida(uri: unknown, tipo: "video-upload" | "ig-api-upload", id: string): string {
  if (typeof uri === "string") {
    try {
      const u = new URL(uri);
      if (u.protocol === "https:" && u.hostname === "rupload.facebook.com") return uri;
    } catch {
      /* se arma abajo */
    }
  }
  return `https://rupload.facebook.com/${tipo}/${GRAPH_VERSION}/${id}`;
}

/** Sube el tramo [desde, hasta) a rupload con `offset` y `file_size`; Meta recibe todo en un solo tramo. */
export async function subirTramoRupload(uri: string, acceso: string, archivo: ArchivoVideo, desde: number, hasta: number, contexto: string, clasificar: Clasificador): Promise<ResultadoTramo> {
  const r = await pedir(uri, {
    method: "POST",
    headers: { Authorization: `OAuth ${acceso}`, offset: String(desde), file_size: String(archivo.bytes) },
    body: leerTramo(archivo.ruta, desde, hasta),
    duplex: "half",
    timeout: TIMEOUT_SUBIDA_MS,
  } as RequestInit & { duplex: "half"; timeout: number });
  if (!r.ok) throw await errorDe(r, contexto, clasificar);
  await r.text().catch(() => "");
  return { bytes: archivo.bytes };
}
