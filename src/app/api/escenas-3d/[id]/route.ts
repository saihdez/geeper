import { db } from "@/lib/db";
import { borrarCorrida3d, leerCorrida3d } from "@/lib/escenas3d";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Borra una escena 3D de la lista (los videos donde ya se usó la conservan: tienen su copia). */
export async function DELETE(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    if (!(await leerCorrida3d(id))) throw new Error("Esa escena 3D ya no existe.");
    const activos = await db.trabajo.findMany({ where: { tipo: "escena3d.crear", estado: { in: ["pendiente", "corriendo"] } }, select: { payload: true } });
    if (activos.some((t) => (t.payload as { corrida?: string }).corrida === id)) throw new Error("Todavía se está haciendo: cancélala primero.");
    await borrarCorrida3d(id);
    return json({ ok: true });
  });
}
