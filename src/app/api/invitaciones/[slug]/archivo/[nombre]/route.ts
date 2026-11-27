import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ARCHIVOS_PUBLICOS, dirInvitacion, leerInvitacion } from "@/lib/invitaciones/construir";
import { pngQrBase } from "@/lib/invitaciones/imagenes";

export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "invitacion.ics": "text/calendar; charset=utf-8",
  "portada-og.jpg": "image/jpeg",
  "qr.svg": "image/svg+xml",
  "qr.png": "image/png",
  "invitacion.zip": "application/zip",
};

/** Lo que hay en `publicar/` (sólo los nombres conocidos). `?descargar=1` lo baja como archivo. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; nombre: string }> }) {
  const { slug, nombre } = await ctx.params;
  if (!(ARCHIVOS_PUBLICOS as readonly string[]).includes(nombre)) return new Response("No encontrado", { status: 404 });
  let datos: Buffer;
  try {
    // Invitaciones de antes del QR en PNG: se hace la primera vez que se pide.
    const ruta = path.join(dirInvitacion(slug), "publicar", nombre);
    if (nombre === "qr.png" && !existsSync(ruta)) {
      const inv = await leerInvitacion(slug);
      if (inv.urlPublica) await pngQrBase(inv.urlPublica, ruta, 1024);
    }
    datos = await fs.readFile(path.join(dirInvitacion(slug), "publicar", nombre));
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
  const descargar = new URL(req.url).searchParams.has("descargar") || nombre.endsWith(".ics") || nombre.endsWith(".zip");
  const headers: Record<string, string> = { "content-type": TIPOS[nombre]!, "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (descargar) headers["content-disposition"] = `attachment; filename="${nombre === "invitacion.zip" ? `invitacion-${slug}.zip` : nombre}"`;
  // La página corre aislada (sin acceso al origen de Geeper) aunque se abra directo en una pestaña.
  if (nombre === "index.html" || nombre === "qr.svg") headers["content-security-policy"] = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads";
  return new Response(new Uint8Array(datos), { headers });
}
