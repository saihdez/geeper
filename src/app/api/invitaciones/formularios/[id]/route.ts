import { json, manejar } from "@/lib/http";
import { borrarPedido, leerPedido, revisarPedido } from "@/lib/invitaciones/formularios";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => json({ pedido: await leerPedido((await ctx.params).id) }));
}

/** Busca la respuesta del cliente y, si hay una nueva, arma la invitación. */
export async function POST(_req: Request, ctx: Ctx) {
  return manejar(async () => json(await revisarPedido((await ctx.params).id)));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    await borrarPedido((await ctx.params).id);
    return json({ ok: true });
  });
}
