import fs from "node:fs/promises";
import path from "node:path";
import { dirInvitacion } from "@/lib/invitaciones/construir";
import { dirPropuestas, NOMBRE_PROPUESTA } from "@/lib/invitaciones/imagenes";

export const dynamic = "force-dynamic";

/** Una propuesta de IA (sólo nombres conocidos de `propuestas/`). */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; nombre: string }> }) {
  const { slug, nombre } = await ctx.params;
  if (!NOMBRE_PROPUESTA.test(nombre)) return new Response("No encontrado", { status: 404 });
  try {
    const datos = await fs.readFile(path.join(dirPropuestas(dirInvitacion(slug)), nombre));
    return new Response(new Uint8Array(datos), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
