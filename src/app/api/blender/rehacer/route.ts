import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { blendDeEscena } from "@/lib/blender-editar";
import { encolar } from "@/lib/cola";
import { dirCorrida3d, leerCorrida3d } from "@/lib/escenas3d";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";

export const dynamic = "force-dynamic";

const Pedido = z.union([
  z.object({ corrida: z.string().regex(/^[a-z0-9-]+$/) }),
  z.object({ proyecto: z.string().min(1), escena: z.string().min(1) }),
]);

/**
 * «Poner mis cambios»: vuelve a dibujar el .blend que la persona cambió en Blender. Una escena 3D de la
 * biblioteca se rehace en su lugar; la escena de un video queda con el resultado en una versión nueva.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const p = Pedido.parse(await req.json());
    if ("corrida" in p) {
      const c = await leerCorrida3d(p.corrida);
      if (!c || !existsSync(path.join(dirCorrida3d(p.corrida), "escena.blend"))) throw new Error("Esta escena 3D no tiene su archivo de Blender.");
      const t = await encolar(null, "escena3d.crear", { corrida: c.id, desdeBlend: true });
      return json({ trabajo: t.id }, 201);
    }
    const { p: proyecto } = await versionDeProyecto(p.proyecto);
    if (!blendDeEscena(proyecto, p.escena)) throw new Error("Esta escena no tiene un archivo de Blender.");
    const t = await encolar(p.proyecto, "blender.rehacer", { escena: p.escena });
    return json({ trabajo: t.id }, 201);
  });
}
