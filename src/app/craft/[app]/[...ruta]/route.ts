import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { appCraft, archivoWeb, sinCache, tipoDe } from "@/lib/craft-web";
import { cabecerasValidador, noModificado, sinCambios } from "@/lib/etag";

export const dynamic = "force-dynamic";

/**
 * Sirve el sitio web de una app Craft instalada (/craft/<app>/index.html y sus archivos), con el
 * tipo correcto para el .wasm y las partes tal cual (ya vienen en gzip). Sólo lee dentro de su carpeta.
 */
export async function GET(req: Request, ctx: { params: Promise<{ app: string; ruta: string[] }> }) {
  const { app, ruta } = await ctx.params;
  if (!appCraft(app)) return new Response("No existe", { status: 404 });
  const partes = ruta.map((p) => decodeURIComponent(p));
  const abs = await archivoWeb(app, partes);
  if (!abs) {
    // Fuentes extra: opcionales. Sin manifiesto, la app usa las suyas (evita un 404 en cada arranque).
    if (partes.join("/") === "fonts/manifest.txt") return new Response("", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
    return new Response("No existe", { status: 404 });
  }
  const st = await fs.stat(abs);
  const rel = partes.join("/");
  const cabeceras = {
    "content-type": tipoDe(abs),
    "cache-control": sinCache(rel) ? "no-cache" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  // WEB-07: con ETag/Last-Modified, lo que va con `no-cache` (index.html, parts.txt…) contesta 304 si no cambió.
  if (sinCambios(req, st)) return noModificado(st, cabeceras);
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, {
    headers: { ...cabeceras, "content-length": String(st.size), ...cabecerasValidador(st) },
  });
}
