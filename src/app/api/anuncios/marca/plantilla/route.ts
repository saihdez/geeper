import { z } from "zod";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { hacerLegible } from "@/lib/colores-marca";
import { logoDeMarcaWeb } from "@/lib/marca-web";
import { DatosPlantilla } from "@/lib/plantillas";
import { slugDe } from "@/lib/servicios";

export const dynamic = "force-dynamic";

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const Pedido = z.object({
  nombre: z.string().trim().min(1).max(80),
  base: z.string().min(1),
  marca: z.string().trim().min(1).max(60),
  acento1: Hex,
  acento2: Hex,
  activa: Hex,
  cta: z.string().trim().max(60).optional(),
  /** La letra de Google Fonts más parecida a la del sitio (libre y la descarga Hyperframes). */
  fuente: z.string().trim().max(60).regex(/^[\p{L}\p{N} ]+$/u).optional(),
  /** Logo leído del sitio (/api/anuncios/marca lo guarda en ~/geeper-data/marcas-web/). */
  logo: z.string().max(500).optional(),
  fuente_url: z.string().url().max(500),
});

/** Crea una plantilla nueva a partir de otra, con la marca confirmada por la persona. */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = Pedido.parse(await req.json());
    const base = await db.plantilla.findUniqueOrThrow({ where: { slug: d.base } });
    const datos = DatosPlantilla.parse(base.datos);
    datos.descripcion = `Desde ${new URL(d.fuente_url).hostname} (${new Date().toISOString().slice(0, 10)}), sobre «${base.nombre}». Colores confirmados a mano.`;
    datos.marca = { ...datos.marca, texto: d.marca };
    datos.colores = hacerLegible({ ...datos.colores, acento1: d.acento1, acento2: d.acento2, activa: d.activa });
    if (d.logo) datos.marca = { ...datos.marca, logo: logoDeMarcaWeb(d.logo) };
    if (d.cta) datos.cta = d.cta;
    if (d.fuente) datos.tipografia = { ...datos.tipografia, titulos: d.fuente };
    datos.tarjetaFinal = { ...datos.tarjetaFinal, titulo: d.marca };
    const slug = slugDe(d.nombre);
    const p = await db.plantilla.create({ data: { slug, nombre: d.nombre, datos: DatosPlantilla.parse(datos) } });
    return json({ plantilla: { slug: p.slug, nombre: p.nombre } }, 201);
  });
}
