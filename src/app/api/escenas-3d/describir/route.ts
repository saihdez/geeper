import { z } from "zod";
import { interpretarDescripcion } from "@/lib/escenas3d";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

/** «Descríbelo y lo armo»: devuelve la plantilla y los ajustes que entendió (no crea nada todavía). */
export async function POST(req: Request) {
  return manejar(async () => {
    const { texto } = z.object({ texto: z.string().trim().min(3, "Cuéntame un poco más de lo que quieres.").max(600) }).parse(await req.json());
    return json(await interpretarDescripcion(texto, (l) => console.info(`[escena 3D] ${l}`)));
  });
}
