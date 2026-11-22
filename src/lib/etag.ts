/**
 * Validadores HTTP para archivos del disco (WEB-07): ETag `"tamaño-mtime"` y Last-Modified. Con ellos el
 * navegador pregunta con If-None-Match y, si nada cambió, recibe un 304 sin cuerpo en vez de bajar todo
 * otra vez. Se sigue mandando `no-cache`: el navegador siempre pregunta, así nunca muestra algo viejo.
 */
import type { Stats } from "node:fs";

export function etagDe(st: Pick<Stats, "size" | "mtimeMs">): string {
  return `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
}

export function cabecerasValidador(st: Pick<Stats, "size" | "mtimeMs" | "mtime">): Record<string, string> {
  return { etag: etagDe(st), "last-modified": st.mtime.toUTCString() };
}

/** ¿El navegador ya tiene esta versión? (If-None-Match manda sobre If-Modified-Since, como dice la norma). */
export function sinCambios(req: Request, st: Pick<Stats, "size" | "mtimeMs" | "mtime">): boolean {
  const inm = req.headers.get("if-none-match");
  if (inm !== null) {
    const etag = etagDe(st);
    return inm.split(",").some((t) => {
      const v = t.trim();
      return v === "*" || v === etag || v === `W/${etag}`;
    });
  }
  const ims = req.headers.get("if-modified-since");
  if (ims) {
    const fecha = Date.parse(ims);
    return !Number.isNaN(fecha) && Math.floor(st.mtimeMs / 1000) * 1000 <= fecha;
  }
  return false;
}

/** If-Range: el pedido parcial sólo vale si el archivo sigue igual; si cambió, se manda entero. */
export function rangoVigente(req: Request, st: Pick<Stats, "size" | "mtimeMs" | "mtime">): boolean {
  const ir = req.headers.get("if-range");
  if (!ir) return true;
  if (ir.startsWith('"') || ir.startsWith("W/")) return ir === etagDe(st);
  const fecha = Date.parse(ir);
  return !Number.isNaN(fecha) && Math.floor(st.mtimeMs / 1000) * 1000 === fecha;
}

/** 304 sin cuerpo con los validadores y las cabeceras de caché que llevaría la respuesta entera. */
export function noModificado(st: Pick<Stats, "size" | "mtimeMs" | "mtime">, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 304, headers: { ...extra, ...cabecerasValidador(st) } });
}
