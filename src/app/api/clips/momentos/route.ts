import { z } from "zod";
import { encolar } from "@/lib/cola";
import { srcAceptable } from "@/lib/fuentes";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

const Pedido = z.object({
  src: z.string().trim().min(1, "Pega una URL o la ruta de un archivo"),
  top: z.number().int().min(1).max(20).default(8),
  min: z.number().min(3).max(120).default(15),
  max: z.number().min(3).max(180).default(40),
  idioma: z.string().min(2).max(5).default("es"),
  maxMinutos: z.number().int().min(1).max(600).default(90),
});

/** Encola la búsqueda de momentos (bajar, medir, transcribir candidatos): puede tardar minutos. */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = Pedido.parse(await req.json());
    if (d.max < d.min) throw new Error("La duración máxima no puede ser menor que la mínima");
    if (!srcAceptable(d.src)) {
      throw new Error("Pega el enlace completo del video (empieza con https://) o súbelo con «Subir un video».");
    }
    const t = await encolar(null, "clip.momentos", d);
    return json({ trabajo: t.id }, 201);
  });
}
