import { z } from "zod";
import { db } from "@/lib/db";
import { preguntarModeloLocal } from "@/lib/ganchos";
import { json, manejar } from "@/lib/http";
import { duracionEscenas, escenasEnLinea } from "@/lib/linea";
import { textoADecir } from "@/lib/regenerar";
import { versionDeProyecto } from "@/lib/render";
import { armarSugerencia, promptPublicacion } from "@/lib/texto-publicacion";

export const dynamic = "force-dynamic";

/** Crédito del creador si el proyecto es un clip (`origen.clip.credito`). */
function creditoDe(origen: Record<string, unknown>): string | undefined {
  const c = (origen.clip as { credito?: unknown } | undefined)?.credito;
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

/** «✨ Sugerir título y descripción» del panel Publicar: modelo local, la persona revisa antes de publicar. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const { red } = z.object({ red: z.enum(["youtube", "tiktok", "instagram"]) }).parse(await req.json());
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) throw new Error("El proyecto todavía no tiene contenido");
    const { p } = await versionDeProyecto(id);
    const guion = escenasEnLinea(p).map((x) => textoADecir(x.escena)).join(" ").replace(/\s+/g, " ").trim();
    if (!guion) throw new Error("El video no tiene palabras para resumir: escribe el título a mano.");
    const datos = { red, guion, nombre: p.nombre, duracion: duracionEscenas(p), credito: creditoDe(p.origen) };
    const crudo = await preguntarModeloLocal(promptPublicacion(datos), "sugerir texto de publicación", "escríbelo a mano");
    return json(armarSugerencia(crudo, datos));
  });
}
