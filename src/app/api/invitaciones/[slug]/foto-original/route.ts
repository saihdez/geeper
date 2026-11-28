import fs from "node:fs/promises";
import { rutaFotoOriginal } from "@/lib/invitaciones/construir";

export const dynamic = "force-dynamic";

/** El tipo de imagen por sus primeros bytes (el original se guarda sin extensión). */
function tipoDe(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "application/octet-stream";
}

/** La foto del sobre sin ajustes, para el editor de ajustes. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const ruta = await rutaFotoOriginal((await ctx.params).slug);
    if (!ruta) return new Response("No encontrado", { status: 404 });
    const datos = new Uint8Array(await fs.readFile(ruta));
    return new Response(datos, { headers: { "content-type": tipoDe(datos), "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
