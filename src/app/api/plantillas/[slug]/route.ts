import { z } from "zod";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { DatosPlantilla } from "@/lib/plantillas";
import { revisarRutasPlantilla } from "@/lib/plantillas-rutas";

/**
 * Edita una plantilla. El cuerpo es `{ nombre?, datos }` (editor visual) o los datos solos (formato
 * anterior, sigue valiendo). Los datos se validan enteros con su esquema.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    const cuerpo = (await req.json()) as Record<string, unknown>;
    const envuelto = cuerpo && typeof cuerpo === "object" && "datos" in cuerpo;
    const datos = DatosPlantilla.parse(envuelto ? cuerpo.datos : cuerpo);
    revisarRutasPlantilla(datos);
    const nombre = envuelto && cuerpo.nombre !== undefined ? z.string().trim().min(1).max(80).parse(cuerpo.nombre) : undefined;
    const p = await db.plantilla.update({ where: { slug }, data: { datos, ...(nombre ? { nombre } : {}) } });
    return json({ plantilla: p });
  });
}
