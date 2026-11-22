import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dirFuentes, leerFuente } from "@/lib/fuentes";
import { json, manejar } from "@/lib/http";
import { ffmpeg, probar } from "@/lib/media";
import { dirDatos } from "@/lib/rutas";
import { limpiarVoz, VERSION_FILTRO_VOZ } from "@/lib/voz-limpia";

export const dynamic = "force-dynamic";

/** Segundos que se escuchan en «antes / después». */
const MUESTRA = 8;

/**
 * «Escuchar antes / después» del paso 3 de Clips: 8 s del medio del tramo, tal cual y con «Mejorar la
 * voz». Se guardan junto a la fuente y se reutilizan si se pide el mismo tramo otra vez.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = z.object({ fuenteId: z.string().regex(/^[a-f0-9]{12}$/), inicio: z.number().nonnegative(), fin: z.number().positive() }).parse(await req.json());
    if (!(d.fin > d.inicio)) throw new Error("El tramo está vacío");
    const f = await leerFuente(d.fuenteId);
    if (!(await fs.stat(f.video).then((s) => s.isFile(), () => false))) {
      throw new Error("El video de esta fuente ya no está en la PC: vuelve a analizarlo desde el paso 1.");
    }
    const dur = Math.min(MUESTRA, d.fin - d.inicio);
    const desde = d.inicio + (d.fin - d.inicio - dur) / 2;
    const dir = path.join(dirFuentes(), d.fuenteId, "pruebas-voz");
    await fs.mkdir(dir, { recursive: true });
    const base = `${desde.toFixed(1)}-${dur.toFixed(1)}`;
    const antes = path.join(dir, `${base}-antes.wav`);
    const despues = path.join(dir, `${base}-${VERSION_FILTRO_VOZ}.wav`);
    const hay = async (p: string) => fs.stat(p).then((s) => s.size > 0, () => false);
    if (!(await hay(antes))) {
      await ffmpeg(["-ss", desde.toFixed(3), "-t", dur.toFixed(3), "-i", f.video, "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", antes]);
      if ((await probar(antes)).duracion < 1) {
        await fs.rm(antes, { force: true });
        throw new Error("Ese tramo no tiene sonido (o cae fuera del video).");
      }
    }
    if (!(await hay(despues))) await limpiarVoz(antes, despues);
    const rel = (p: string) => path.relative(dirDatos(), p).split(path.sep).join("/");
    return json({ antes: rel(antes), despues: rel(despues), desde, dur });
  });
}
