import { z } from "zod";
import { json, manejar } from "@/lib/http";
import { MAX_CARACTERES_DEMO } from "@/lib/demo-web";
import { crearDemo } from "@/lib/servicios";

export const dynamic = "force-dynamic";

const Pedido = z.object({
  url: z.string().trim().min(8, "Pega el link de la página"),
  formato: z.enum(["9:16", "16:9"]),
  estilo: z.enum(["3d", "plano"]),
  texto: z.string().trim().min(3, "Escribe qué quieres que diga el video").max(MAX_CARACTERES_DEMO, `El texto es muy largo (hasta ${MAX_CARACTERES_DEMO} caracteres, unos 45 s)`),
  plantilla: z.string().min(1),
  nombre: z.string().max(120).optional(),
  propio: z.boolean().optional(),
});

/** «Nuevo → Desde una página web»: encola la demo (voz, toma, proyecto) y después el render con QC. */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = Pedido.parse(await req.json());
    const url = /^https?:\/\//i.test(d.url) ? d.url : `https://${d.url}`;
    return json({ proyecto: await crearDemo({ ...d, url }) }, 201);
  });
}
