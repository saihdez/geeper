import { db } from "@/lib/db";
import { enlaceDeTrabajoDemo } from "@/lib/demo-web";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * «Cambiar el link» (UX-17): el enlace a Nuevo con lo que se escribió en un video de página web que
 * falló antes de armarse. `?trabajo=<id>` de un `demo.crear`.
 */
export async function GET(req: Request) {
  return manejar(async () => {
    const q = new URL(req.url).searchParams;
    const id = q.get("trabajo") ?? "";
    const t = id
      ? await db.trabajo.findUnique({ where: { id }, select: { tipo: true, payload: true, proyecto: { select: { formato: true, plantilla: true } } } })
      : null;
    if (!t || t.tipo !== "demo.crear") return json({ error: "No encontré ese video de página web. Vuelve a Nuevo y escribe el link otra vez." }, 404);
    return json({ enlace: enlaceDeTrabajoDemo(t.payload, t.proyecto, q.get("fuente") === "grabacion" ? "grabacion" : undefined) });
  });
}
