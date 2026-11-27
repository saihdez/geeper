import fs from "node:fs/promises";
import path from "node:path";
import { PERSONAJES_3D, PLANTILLAS_3D } from "@/lib/escenas3d-catalogo";
import { RAIZ_REPO } from "@/lib/rutas";

export const dynamic = "force-dynamic";

/**
 * Muestra de una plantilla (py/blender/previas/<plantilla>.mp4) o la miniatura de un personaje
 * (`personaje-<id>` → previas/personaje-<id>.jpg). Vienen con Geeper.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ plantilla: string }> }) {
  const { plantilla } = await ctx.params;
  const esPersonaje = PERSONAJES_3D.some((p) => `personaje-${p.id}` === plantilla);
  if (!esPersonaje && !(PLANTILLAS_3D as readonly string[]).includes(plantilla)) return new Response("No", { status: 404 });
  try {
    const datos = await fs.readFile(path.join(RAIZ_REPO, "py", "blender", "previas", `${plantilla}.${esPersonaje ? "jpg" : "mp4"}`));
    return new Response(new Uint8Array(datos), { headers: { "content-type": esPersonaje ? "image/jpeg" : "video/mp4", "cache-control": "public, max-age=86400", "content-length": String(datos.length) } });
  } catch {
    return new Response("Sin muestra", { status: 404 });
  }
}
