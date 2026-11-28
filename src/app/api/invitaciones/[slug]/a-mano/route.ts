import { json, manejar } from "@/lib/http";
import { guardarCambiosMano, htmlEditor } from "@/lib/invitaciones/construir";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

/** «Corregir a mano»: la página terminada con los textos editables (va a un iframe aislado con srcDoc). */
export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => json({ html: await htmlEditor((await ctx.params).slug) }));
}

/** Guarda los textos corregidos y las partes ocultas, y rehace la invitación. */
export async function PUT(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { inv, avisos } = await guardarCambiosMano((await ctx.params).slug, await req.json());
    return json({ invitacion: inv, avisos });
  });
}
