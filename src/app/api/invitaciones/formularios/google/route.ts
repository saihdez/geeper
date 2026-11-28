import { json, manejar } from "@/lib/http";
import { desconectarGoogle, estadoGoogle, guardarAppGoogle } from "@/lib/invitaciones/google";

export const dynamic = "force-dynamic";

/** Carga la app de Google (ID de cliente y secreto). Nunca se devuelven. */
export async function PUT(req: Request) {
  return manejar(async () => {
    guardarAppGoogle(await req.json());
    return json({ google: estadoGoogle() });
  });
}

/** Quita el permiso de Google (lo revoca en Google y borra el token de esta PC). */
export async function DELETE() {
  return manejar(async () => {
    await desconectarGoogle();
    return json({ google: estadoGoogle() });
  });
}
