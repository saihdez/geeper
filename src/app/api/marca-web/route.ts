import { z } from "zod";
import { json, manejar } from "@/lib/http";
import { leerYGuardarMarca } from "@/lib/marca-web";

export const dynamic = "force-dynamic";

/**
 * Lee la marca de una página pública (colores, letras, logo y botón principal; src/lib/marca-web.ts).
 * El logo queda en ~/geeper-data/marcas-web/; no cambia ninguna plantilla: quien llama decide qué usar.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const { url } = z.object({ url: z.string().trim().min(1).max(2000) }).parse(await req.json());
    return json(await leerYGuardarMarca(url, req.signal));
  });
}
