import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { abrirEnBlender, blendDeEscena } from "@/lib/blender-editar";
import { dirCorrida3d } from "@/lib/escenas3d";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";

export const dynamic = "force-dynamic";

/** Escena 3D de la biblioteca (`corrida`) o la escena de un video (`proyecto` + `escena`). */
const Pedido = z.union([
  z.object({ corrida: z.string().regex(/^[a-z0-9-]+$/) }),
  z.object({ proyecto: z.string().min(1), escena: z.string().min(1) }),
]);

/** El .blend que corresponde (la ruta nunca viene del navegador: se busca aquí). */
async function buscar(p: z.infer<typeof Pedido>): Promise<string | null> {
  if ("corrida" in p) {
    const abs = path.join(dirCorrida3d(p.corrida), "escena.blend");
    return existsSync(abs) ? abs : null;
  }
  const { p: proyecto } = await versionDeProyecto(p.proyecto);
  return blendDeEscena(proyecto, p.escena)?.abs ?? null;
}

/** ¿Tiene archivo de Blender? (para mostrar los botones). */
export async function GET(req: Request) {
  return manejar(async () => {
    const u = new URL(req.url).searchParams;
    const p = Pedido.parse(u.get("corrida") ? { corrida: u.get("corrida") } : { proyecto: u.get("proyecto"), escena: u.get("escena") });
    return json({ blend: !!(await buscar(p)) });
  });
}

/** Lo abre en Blender, con su ventana, en esta PC. */
export async function POST(req: Request) {
  return manejar(async () => {
    const abs = await buscar(Pedido.parse(await req.json()));
    if (!abs) throw new Error("Esto no tiene un archivo de Blender para abrir (se hizo antes de que Geeper los guardara).");
    await abrirEnBlender(abs);
    return json({ abierto: true });
  });
}
