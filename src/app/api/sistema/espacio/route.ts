import { z } from "zod";
import { json, manejar } from "@/lib/http";
import { liberar, medirEspacio } from "@/lib/liberar-espacio";

export const dynamic = "force-dynamic";

/** GET /api/sistema/espacio → cuánto ocupa cada cosa y cuánto se puede liberar (no borra nada; UX-33). */
export async function GET() {
  return manejar(async () => json(await medirEspacio()));
}

const Pedido = z.object({ que: z.enum(["renders", "crudos", "papelera"]), confirmo: z.literal(true) });

/** POST /api/sistema/espacio { que, confirmo: true } → borra ese tipo, sólo tras la confirmación de la persona. */
export async function POST(req: Request) {
  return manejar(async () => {
    const { que, confirmo } = Pedido.parse(await req.json());
    return json(await liberar(que, confirmo));
  });
}
