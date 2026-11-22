import fs from "node:fs/promises";
import { dentroDe } from "@/lib/archivos";
import { db } from "@/lib/db";
import { manejar } from "@/lib/http";
import { dirDatos } from "@/lib/rutas";

export const dynamic = "force-dynamic";

const TEXTO = { "content-type": "text/plain; charset=utf-8" };

/** Cuántas líneas: 200 si no viene o no es un número; entre 1 y 5000. */
function cuantasLineas(valor: string | null): number {
  const n = Math.floor(Number(valor ?? 200));
  return Number.isFinite(n) ? Math.min(5000, Math.max(1, n)) : 200;
}

/** Últimas líneas del log de un trabajo (SRV-02: si falla la base, sale un error legible). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const t = await db.trabajo.findUnique({ where: { id } });
    if (!t?.log) return new Response("(sin log todavía)", { headers: TEXTO });
    const lineas = cuantasLineas(new URL(req.url).searchParams.get("lineas"));
    try {
      const texto = await fs.readFile(dentroDe(dirDatos(), t.log), "utf8");
      return new Response(texto.split("\n").slice(-lineas).join("\n"), { headers: TEXTO });
    } catch {
      return new Response("(no se pudo leer el log)", { headers: TEXTO });
    }
  });
}
