import { z } from "zod";
import { usarEscena3d } from "@/lib/escenas3d";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

const Pedido = z.object({ corrida: z.string().regex(/^[a-z0-9-]+$/), proyecto: z.string().min(1), escena: z.string().min(1) });

/** Pone una escena 3D terminada como el video de una escena de un proyecto (versión nueva). */
export async function POST(req: Request) {
  return manejar(async () => {
    const p = Pedido.parse(await req.json());
    return json({ version: await usarEscena3d(p.corrida, p.proyecto, p.escena) }, 201);
  });
}
