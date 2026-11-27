import { asistenteDe } from "@/lib/asistente";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Recomendaciones del asistente para el proyecto (src/lib/recomendaciones.ts). Sólo lee: no usa la GPU. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const informe = await asistenteDe({ id: (await ctx.params).id });
    if (!informe) return json({ error: "No existe" }, 404);
    return json(informe);
  });
}
