import { json, manejar } from "@/lib/http";
import { vistaProyecto } from "@/lib/vista";

export const dynamic = "force-dynamic";

/** GET /api/proyectos/[id] → la vista del proyecto; un fallo (base ocupada, geeper.json roto) sale legible (SRV-02). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const v = await vistaProyecto(id);
    if (!v) return json({ error: "Ese video ya no existe (quizá se borró). Vuelve a la lista y ábrelo de nuevo." }, 404);
    return json(v);
  });
}
