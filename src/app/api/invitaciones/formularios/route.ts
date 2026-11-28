import { json, manejar } from "@/lib/http";
import { crearPedido, listarPedidos } from "@/lib/invitaciones/formularios";
import { estadoGoogle } from "@/lib/invitaciones/google";

export const dynamic = "force-dynamic";

/** Cómo está la conexión con Google y los formularios pedidos. Sin secretos. */
export async function GET() {
  return manejar(async () => json({ google: estadoGoogle(), pedidos: await listarPedidos() }));
}

/** Crea un formulario de Google para que el cliente llene los datos de su invitación. */
export async function POST(req: Request) {
  return manejar(async () => json({ pedido: await crearPedido(await req.json()) }, 201));
}
