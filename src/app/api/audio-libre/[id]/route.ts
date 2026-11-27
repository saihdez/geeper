import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { rutaSonidoLibre, sonidoLibre } from "@/lib/audio-libre";

export const dynamic = "force-dynamic";

/**
 * Sirve una muestra de la música o los efectos libres (audio-libre/) para escucharla antes de elegirla.
 * Sólo ids de la biblioteca: no se arma ninguna ruta con lo que llega.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = sonidoLibre(decodeURIComponent(id));
  if (!s) return new Response("No existe", { status: 404 });
  const abs = rutaSonidoLibre(s);
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return new Response("No existe", { status: 404 });
  }
  const flujo = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  // Los archivos no cambian dentro de una versión de Geeper.
  return new Response(flujo, { headers: { "content-type": "audio/ogg", "content-length": String(st.size), "cache-control": "public, max-age=86400" } });
}
