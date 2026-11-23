import { z } from "zod";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";

/** Regenera la voz de una escena, de varias (`escenas`, un solo trabajo y un solo render) o del guion completo, realinea y vuelve a renderizar. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    // `escenas` (GPU-07): varias escenas en UN solo trabajo («Rehacer la voz de las escenas cambiadas»).
    const { escena, escenas } = z
      .object({ escena: z.string().nullable().optional(), escenas: z.array(z.string().min(1)).min(1, "Elige al menos una escena.").max(200).optional() })
      .refine((b) => b.escena !== undefined || b.escenas !== undefined, "Falta qué voz rehacer: una escena, varias o todo el guion.")
      .parse(await req.json());
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (p.versionActual < 1) throw new Error("El proyecto todavía no tiene geeper.json");
    const activo = await db.trabajo.findFirst({ where: { proyectoId: id, tipo: "voz.regenerar", estado: { in: ["pendiente", "corriendo"] } } });
    if (activo) throw new Error("Ya hay una voz regenerándose en este proyecto");
    const t = await encolar(id, "voz.regenerar", escenas ? { escenas: [...new Set(escenas)], cadena: ["render.entregar"] } : { escena: escena ?? null, cadena: ["render.entregar"] });
    return json({ trabajo: t }, 201);
  });
}
