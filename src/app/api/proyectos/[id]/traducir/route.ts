import { z } from "zod";
import { crearCarpetas } from "@/lib/almacen";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { pista, validarProyecto } from "@/lib/esquema";
import { json, manejar } from "@/lib/http";
import { slugDe } from "@/lib/servicios";
import { IDIOMAS, IdiomaTraduccion } from "@/lib/traducir";

/**
 * Crea una copia del proyecto en otro idioma y encola su traducción (Gemma + Kokoro + whisper) y el
 * render. El original no cambia. Devuelve el proyecto nuevo para abrirlo y ver el avance.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const { idioma } = z.object({ idioma: IdiomaTraduccion }).parse(await req.json());
    const o = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (o.versionActual < 1) throw new Error("Este video todavía no está armado: espera a que termine antes de traducirlo.");
    const v = await db.version.findUniqueOrThrow({ where: { proyectoId_numero: { proyectoId: id, numero: o.versionActual } } });
    const p = validarProyecto(JSON.parse(v.json));
    if (pista(p, "voz").clips.some((c) => p.assets[c.asset]?.regenerar.origen === "clip")) {
      throw new Error("Este video es un clip: la voz es la de la persona que lo grabó y no se puede traducir con otra voz.");
    }
    const info = IDIOMAS[idioma];
    const base = o.nombre.replace(/\s+\((ES|EN|PT|FR|IT)\)$/, "");
    const nombre = `${base} (${info.sufijo})`;
    const nuevo = await db.proyecto.create({
      data: { slug: slugDe(`${base} ${idioma}`), nombre, tema: o.tema, formato: o.formato, plantilla: o.plantilla, flujo: "traduccion", estado: "generando" },
    });
    await crearCarpetas(nuevo.slug);
    const t = await encolar(nuevo.id, "proyecto.traducir", { origen: id, idioma, cadena: ["render.entregar"] });
    return json({ proyecto: { id: nuevo.id, nombre }, trabajo: t }, 201);
  });
}
