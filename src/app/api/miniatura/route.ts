import fs from "node:fs/promises";
import path from "node:path";
import { dentroDe, existe } from "@/lib/archivos";
import { cabecerasValidador, noModificado, sinCambios } from "@/lib/etag";
import { fotograma } from "@/lib/media";
import { dirProyecto } from "@/lib/rutas";
import { CSP_SVG } from "@/lib/svg";

export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };

/**
 * Sirve un archivo con ETag/Last-Modified (WEB-07): si el navegador ya lo tiene, 304 sin cuerpo.
 * `cache` decide cuánto puede guardarlo sin preguntar.
 */
async function servir(req: Request, abs: string, cache: string, extra: Record<string, string> = {}): Promise<Response> {
  const st = await fs.stat(abs);
  const cabeceras = { "content-type": TIPOS[path.extname(abs).toLowerCase()] ?? "image/jpeg", "cache-control": cache, ...extra };
  if (sinCambios(req, st)) return noModificado(st, cabeceras);
  return new Response(new Uint8Array(await fs.readFile(abs)), { headers: { ...cabeceras, ...cabecerasValidador(st) } });
}

/** Miniatura de un asset de video (se guarda en assets/miniaturas/ la primera vez). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = u.searchParams.get("p") ?? "";
  const ruta = u.searchParams.get("ruta") ?? "";
  const t = Math.max(0, Number(u.searchParams.get("t") ?? 0.5));
  try {
    const dir = dirProyecto(slug);
    const origen = dentroDe(dir, ruta);
    // Una imagen se sirve tal cual: puede cambiar en el mismo lugar, así que el navegador siempre pregunta.
    if (/\.(jpe?g|png|webp)$/i.test(origen)) return await servir(req, origen, "no-cache");
    if (/\.svg$/i.test(origen)) return await servir(req, origen, "no-cache", { "content-security-policy": CSP_SVG });
    const destino = path.join(dir, "assets", "miniaturas", `${path.parse(ruta).name}-${t.toFixed(1)}.jpg`);
    if (!(await existe(destino))) {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      // A un temporal y después se renombra: un pedido a la vez no ve nunca una miniatura a medias.
      const tmp = path.join(path.dirname(destino), `.${path.basename(destino, ".jpg")}-${process.pid}-${Date.now()}.jpg`);
      try {
        await fotograma(origen, t, tmp, 240);
        await fs.rename(tmp, destino);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    return await servir(req, destino, "max-age=3600");
  } catch {
    return new Response("Sin miniatura", { status: 404 });
  }
}
