import fs from "node:fs/promises";
import path from "node:path";
import { leerProyecto } from "@/lib/almacen";
import { db } from "@/lib/db";
import { manifiestoFilmcraft, nombreGuardado } from "@/lib/filmcraft-host";
import { json, manejar } from "@/lib/http";
import { pngsParaOtio } from "@/lib/otio-svg";
import { obtenerPlantilla } from "@/lib/plantillas";
import { dirProyecto } from "@/lib/rutas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function proyecto(id: string) {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
  const p = await leerProyecto(fila.slug);
  if (!p) throw new Error("El proyecto todavía no tiene geeper.json");
  return { fila, p, dir: dirProyecto(fila.slug) };
}

/** Lo que «Abrir en FilmCraft» le manda al editor: la línea de tiempo (con textos y gráficos) y la lista de medios. */
export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { fila, p, dir } = await proyecto((await ctx.params).id);
    // Sin la plantilla (borrada) igual se abre: sólo los medios, con los subtítulos en el .srt.
    const plantilla = await obtenerPlantilla(fila.plantilla).then((x) => x.datos, () => undefined);
    const { manifiesto } = await manifiestoFilmcraft(p, fila.slug, dir, await pngsParaOtio(p, dir), plantilla);
    return json(manifiesto);
  });
}

/** Lo que FilmCraft guarda o exporta (`filmcraft:save`) queda en `<proyecto>/editor/<nombre>`. */
export async function POST(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { fila, dir } = await proyecto((await ctx.params).id);
    const nombre = nombreGuardado(new URL(req.url).searchParams.get("nombre") ?? "");
    const bytes = Buffer.from(await req.arrayBuffer());
    if (!bytes.length) throw new Error("FilmCraft mandó un archivo vacío");
    const destino = path.join(dir, "editor", nombre);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(`${destino}.tmp`, bytes);
    await fs.rename(`${destino}.tmp`, destino);
    return json({ ruta: path.join("proyectos", fila.slug, "editor", nombre).split(path.sep).join("/"), carpeta: path.dirname(destino), bytes: bytes.length }, 201);
  });
}
