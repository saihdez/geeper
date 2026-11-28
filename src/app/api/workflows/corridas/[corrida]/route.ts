import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { dirCorrida, entradasDeCorrida, leerCorrida, PedidoWorkflow } from "@/lib/workflows";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ corrida: string }> };

/** Los trabajos de Workflows que corrieron una corrida, del más nuevo al más viejo. */
async function trabajosDe(corrida: string, estados?: string[]) {
  const ts = await db.trabajo.findMany({
    where: { tipo: "workflow.correr", ...(estados ? { estado: { in: estados } } : {}) },
    orderBy: { creado: "desc" },
    take: 300,
    select: { id: true, payload: true },
  });
  return ts.filter((t) => (t.payload as { corrida?: string } | null)?.corrida === corrida);
}

/**
 * Lo que se pidió en una corrida, para «Editar»: la receta, los textos que la persona cambió y los archivos
 * que subió (se vuelven a usar si no sube otros). Las corridas viejas no guardaban los textos: se toman
 * del trabajo que la corrió.
 */
export async function GET(_: Request, ctx: Ctx) {
  return manejar(async () => {
    const { corrida } = await ctx.params;
    const c = await leerCorrida(corrida);
    if (!c) throw new Error("Ese resultado ya no está.");
    let textos = c.textos;
    if (!textos) {
      const [t] = await trabajosDe(corrida);
      const p = PedidoWorkflow.safeParse((t?.payload as { pedido?: unknown } | null)?.pedido);
      textos = p.success ? p.data.textos : [];
    }
    return json({ corrida: c.id, workflow: c.workflow, textos, archivos: await entradasDeCorrida(c.id) });
  });
}

/** Elimina un resultado de «Lo que estás creando» (borra su carpeta). Lo que ya se puso en un video queda en el video. */
export async function DELETE(_: Request, ctx: Ctx) {
  return manejar(async () => {
    const { corrida } = await ctx.params;
    const c = await leerCorrida(corrida);
    if (!c) return json({ ok: true });
    if ((await trabajosDe(corrida, ["pendiente", "corriendo"])).length) throw new Error("Todavía se está creando: cancélalo primero.");
    await fs.rm(dirCorrida(corrida), { recursive: true, force: true });
    return json({ ok: true });
  });
}
