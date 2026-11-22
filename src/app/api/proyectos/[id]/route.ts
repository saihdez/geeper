import { eliminarProyecto } from "@/lib/eliminar-proyecto";
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

/** Elimina el proyecto: su carpeta va a la papelera y se borra de la lista (eliminar-proyecto.ts). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => json(await eliminarProyecto((await ctx.params).id)));
}
