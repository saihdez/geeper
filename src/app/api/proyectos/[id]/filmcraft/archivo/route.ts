import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { leerProyecto } from "@/lib/almacen";
import { tipoDe } from "@/lib/craft-web";
import { db } from "@/lib/db";
import { manifiestoFilmcraft, sustitutosExistentes } from "@/lib/filmcraft-host";
import { manejar } from "@/lib/http";
import { dirProyecto } from "@/lib/rutas";

export const dynamic = "force-dynamic";

/** Un medio del proyecto para FilmCraft, por el nombre del manifiesto (sólo los que nombra el .otio). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id: (await ctx.params).id } });
    const p = await leerProyecto(fila.slug);
    if (!p) throw new Error("El proyecto todavía no tiene geeper.json");
    const dir = dirProyecto(fila.slug);
    const nombre = new URL(req.url).searchParams.get("nombre") ?? "";
    const { medios } = await manifiestoFilmcraft(p, fila.slug, dir, sustitutosExistentes(p, dir));
    const m = medios.find((x) => x.nombre === nombre);
    if (!m) return new Response("Ese archivo no es parte del proyecto", { status: 404 });
    const st = await fs.stat(m.abs).catch(() => null);
    if (!st?.isFile()) return new Response("Falta ese archivo en la carpeta del proyecto", { status: 404 });
    return new Response(Readable.toWeb(createReadStream(m.abs)) as ReadableStream, {
      headers: { "content-type": tipoDe(m.abs), "content-length": String(st.size), "cache-control": "no-store" },
    });
  });
}
