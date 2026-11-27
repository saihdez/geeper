import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { dentroDe } from "@/lib/archivos";
import { servible } from "@/lib/archivos-servibles";
import { cabecerasValidador, rangoVigente, sinCambios } from "@/lib/etag";
import { dirDatos } from "@/lib/rutas";
import { CSP_SVG, esSvg } from "@/lib/svg";

export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".log": "text/plain; charset=utf-8",
  ".webp": "image/webp", ".csv": "text/csv; charset=utf-8", ".srt": "application/x-subrip; charset=utf-8", ".woff2": "font/woff2",
};

/**
 * Sirve archivos de ~/geeper-data (con Range para los videos). Sólo lectura, sin salir de la carpeta y
 * sólo de las carpetas de proyectos y de medios (archivos-servibles.ts): nunca claves, respaldos ni la base.
 */
export async function GET(req: Request, ctx: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await ctx.params;
  let abs: string;
  try {
    abs = dentroDe(dirDatos(), ruta.map(decodeURIComponent).join("/"));
  } catch {
    return new Response("Ruta inválida", { status: 400 });
  }
  if (!(await servible(dirDatos(), path.relative(dirDatos(), abs)))) return new Response("Ese archivo no se puede abrir desde aquí.", { status: 403 });
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return new Response("No existe", { status: 404 });
  }
  if (!st.isFile()) return new Response("No es un archivo", { status: 400 });
  const tipo = TIPOS[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const descarga = new URL(req.url).searchParams.has("descargar");
  // no-cache: el navegador pregunta siempre; con el ETag la respuesta es un 304 vacío si nada cambió.
  const validador = cabecerasValidador(st);
  const cab: Record<string, string> = { "content-type": tipo, "accept-ranges": "bytes", "cache-control": "no-cache", ...validador };
  if (esSvg(abs)) cab["content-security-policy"] = CSP_SVG;
  if (descarga) cab["content-disposition"] = `attachment; filename="${encodeURIComponent(path.basename(abs))}"`;
  if (sinCambios(req, st)) return new Response(null, { status: 304, headers: { ...validador, "cache-control": "no-cache" } });
  const rango = rangoVigente(req, st) ? req.headers.get("range") : null;
  const m = rango ? /^bytes=(\d*)-(\d*)$/.exec(rango) : null;
  if (m && (m[1] || m[2])) {
    let ini = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let fin = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    ini = Math.max(0, ini);
    fin = Math.min(st.size - 1, fin);
    if (ini > fin) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    const flujo = Readable.toWeb(createReadStream(abs, { start: ini, end: fin })) as ReadableStream;
    return new Response(flujo, { status: 206, headers: { ...cab, "content-range": `bytes ${ini}-${fin}/${st.size}`, "content-length": String(fin - ini + 1) } });
  }
  const flujo = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(flujo, { headers: { ...cab, "content-length": String(st.size) } });
}
