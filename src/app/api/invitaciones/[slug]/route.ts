import { z } from "zod";
import { json, manejar } from "@/lib/http";
import { borrarInvitacion, guardarInvitacion, leerInvitacion, ponerUrlPublica } from "@/lib/invitaciones/construir";
import { leerFormulario } from "@/lib/invitaciones/formulario";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => json({ invitacion: await leerInvitacion((await ctx.params).slug) }));
}

/** Cambiar datos (mismo multipart que al crear): se rehace todo desde el json. */
export async function PUT(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    const { datos, subidas } = await leerFormulario(req);
    const { avisos } = await guardarInvitacion(datos, subidas, slug);
    return json({ slug, avisos });
  });
}

/** Dirección donde quedó publicada (o `null` para quitarla): rehace el QR y la vista previa. */
export async function PATCH(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    const { urlPublica } = z.object({ urlPublica: z.string().trim().nullable() }).parse(await req.json());
    const { inv, avisos } = await ponerUrlPublica(slug, urlPublica || null);
    return json({ invitacion: inv, avisos });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    await borrarInvitacion((await ctx.params).slug);
    return json({ ok: true });
  });
}
