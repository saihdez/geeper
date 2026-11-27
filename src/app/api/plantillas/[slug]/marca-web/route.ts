import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { guardarImagenSubida } from "@/lib/imagen-subida";
import { capturarMarcaWeb } from "@/lib/marca-web";
import { dirDatos } from "@/lib/rutas";

export const dynamic = "force-dynamic";

/**
 * Lee la marca de una página web (colores, letras y logo; src/lib/marca-web.ts). El logo se guarda en
 * ~/geeper-data/plantillas/<slug>/ como uno subido a mano. No cambia la plantilla: el editor muestra la
 * propuesta y la persona decide qué usar y guarda.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    await db.plantilla.findUniqueOrThrow({ where: { slug } });
    const { url } = z.object({ url: z.string().trim().min(1).max(2000) }).parse(await req.json());
    const r = await capturarMarcaWeb(url, { signal: req.signal });
    let logo: { logo: string; ruta: string } | null = null;
    const avisos: string[] = [];
    if (r.logo) {
      try {
        const { abs } = await guardarImagenSubida(new File([new Uint8Array(r.logo.datos)], r.logo.nombre), path.join(dirDatos(), "plantillas", slug), "logo-web");
        logo = { logo: abs, ruta: path.relative(dirDatos(), abs) };
      } catch {
        avisos.push("Encontramos un logo, pero no se puede usar tal cual. Súbelo a mano si lo tienes.");
      }
    } else {
      avisos.push("No encontramos el logo en la página. Si lo tienes, súbelo a mano.");
    }
    return json({ marca: r.marca, logo, avisos, url: r.url });
  });
}
