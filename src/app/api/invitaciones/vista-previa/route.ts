import { json, manejar } from "@/lib/http";
import { vistaPrevia } from "@/lib/invitaciones/construir";

export const dynamic = "force-dynamic";

/** «Ver cómo queda»: la invitación con lo que lleva el formulario, sin guardar nada. */
export async function POST(req: Request) {
  return manejar(async () => json({ html: await vistaPrevia(await req.json()) }));
}
