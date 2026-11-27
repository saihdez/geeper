import { creditosDe } from "@/lib/creditos";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";

export const dynamic = "force-dynamic";

/** Si hace falta dar crédito al publicar este video y qué texto pegar (src/lib/creditos.ts). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) return json({ listo: false });
    const { p } = await versionDeProyecto(id);
    return json({ listo: true, ...creditosDe(p) });
  });
}
