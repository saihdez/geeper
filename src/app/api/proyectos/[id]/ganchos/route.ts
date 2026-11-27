import { db } from "@/lib/db";
import { sugerirGanchos } from "@/lib/ganchos";
import { json, manejar } from "@/lib/http";
import { escenasEnLinea } from "@/lib/linea";
import { textoADecir } from "@/lib/regenerar";
import { versionDeProyecto } from "@/lib/render";

export const dynamic = "force-dynamic";

/**
 * «Sugiéreme 3» del asistente: ganchos para los primeros segundos, a partir de lo que dice el video.
 * Usa la IA local (toma el candado de la tarjeta de video sin esperar: si está ocupada, lo dice). Sólo
 * cuando la persona lo pide; ella elige uno o escribe el suyo.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) throw new Error("El proyecto todavía no tiene contenido");
    const { p } = await versionDeProyecto(id);
    const texto = escenasEnLinea(p).map((x) => textoADecir(x.escena)).join(" ").replace(/\s+/g, " ").trim();
    const canal = (p.origen.clip as { canal?: unknown } | undefined)?.canal;
    const s = await sugerirGanchos({ texto, canal: typeof canal === "string" ? canal : null, idioma: p.voz.idioma, react: false });
    if (!s.ganchos.length) throw new Error("La IA no dio ganchos que cumplan las reglas: prueba otra vez o escribe el tuyo.");
    return json({ ganchos: s.ganchos });
  });
}
