import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { dirCorrida, leerCorrida } from "@/lib/workflows";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ corrida: string }> };

/** Quita una corrida fallida de «Lo que estás creando» (borra su carpeta). Las que salieron bien no se tocan. */
export async function DELETE(_: Request, ctx: Ctx) {
  return manejar(async () => {
    const { corrida } = await ctx.params;
    const c = await leerCorrida(corrida);
    if (!c) return json({ ok: true });
    if (c.estado !== "fallida") throw new Error("Sólo se pueden quitar las que fallaron.");
    const activos = await db.trabajo.findMany({ where: { tipo: "workflow.correr", estado: { in: ["pendiente", "corriendo"] } }, select: { payload: true } });
    if (activos.some((t) => (t.payload as { corrida?: string }).corrida === corrida)) throw new Error("Todavía se está creando.");
    await fs.rm(dirCorrida(corrida), { recursive: true, force: true });
    return json({ ok: true });
  });
}
