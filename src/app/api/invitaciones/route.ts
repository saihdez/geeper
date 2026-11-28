import { json, manejar } from "@/lib/http";
import { guardarInvitacion, listarInvitaciones } from "@/lib/invitaciones/construir";
import { leerFormulario } from "@/lib/invitaciones/formulario";
import { enlazarPedido } from "@/lib/invitaciones/formularios";

export const dynamic = "force-dynamic";

export async function GET() {
  return manejar(async () => json({ invitaciones: await listarInvitaciones() }));
}

/** «Crear invitación»: multipart con `datos` (JSON del formulario) y, opcionales, `foto` y `audio`. */
export async function POST(req: Request) {
  return manejar(async () => {
    const { datos, subidas, formulario } = await leerFormulario(req);
    const { inv, avisos } = await guardarInvitacion(datos, subidas, undefined, { formulario });
    if (formulario) await enlazarPedido(formulario, inv);
    return json({ slug: inv.slug, avisos }, 201);
  });
}
