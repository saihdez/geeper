import { z } from "zod";
import { json, manejar } from "@/lib/http";
import { aPerfilMarca, leerYGuardarMarca } from "@/lib/marca-web";

export const dynamic = "force-dynamic";

/** Lee un sitio público y devuelve lo observado y lo inferido de su marca, y su logo (no cambia nada). */
export async function POST(req: Request) {
  return manejar(async () => {
    const { url } = z.object({ url: z.string().trim().min(1).max(2000) }).parse(await req.json());
    const { lectura, logo } = await leerYGuardarMarca(url, req.signal);
    return json({ perfil: aPerfilMarca(lectura), logo });
  });
}
