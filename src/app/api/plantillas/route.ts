import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { hacerLegible } from "@/lib/colores-marca";
import { aplicarEstilo, ESTILOS_PLANTILLA } from "@/lib/estilos-plantilla";
import { logoDeMarcaWeb } from "@/lib/marca-web";
import { DatosPlantilla } from "@/lib/plantillas";
import { dirDatos } from "@/lib/rutas";
import { slugDe } from "@/lib/servicios";

export const dynamic = "force-dynamic";

export async function GET() {
  const [plantillas, usos] = await Promise.all([
    db.plantilla.findMany({ orderBy: { nombre: "asc" } }),
    db.proyecto.groupBy({ by: ["plantilla"], _count: { _all: true } }),
  ]);
  const cuenta = new Map(usos.map((u) => [u.plantilla, u._count._all]));
  // El logo se puede ver en el editor si está dentro de ~/geeper-data (lo que sube el editor).
  const logoRuta = (datos: unknown) => {
    const logo = DatosPlantilla.safeParse(datos).data?.marca.logo;
    if (!logo) return null;
    const rel = path.relative(dirDatos(), logo);
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
  };
  return json({ plantillas: plantillas.map((p) => ({ ...p, usos: cuenta.get(p.slug) ?? 0, logoRuta: logoRuta(p.datos) })) });
}

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const Fuente = z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} ]+$/u);

/**
 * Crea una plantilla. Sin más datos, copia `base` (para probar cambios sin tocar la que usan los
 * proyectos). Con `estilo`, le pone uno de los estilos de partida; con `web`, la marca leída de una
 * página (/api/marca-web), con los colores ya ajustados para que se lean. Sin `base`, parte de la neutra.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = z
      .object({
        nombre: z.string().trim().min(1).max(80),
        base: z.string().min(1).optional(),
        estilo: z.string().min(1).optional(),
        web: z
          .object({
            url: z.string().url().max(2000),
            marca: z.string().trim().max(40),
            roles: z.object({ acento1: Hex.optional(), acento2: Hex.optional(), activa: Hex.optional() }),
            titulos: Fuente,
            texto: Fuente,
            logo: z.string().max(500).nullable(),
            cta: z.string().trim().max(40).nullable(),
          })
          .optional(),
      })
      .parse(await req.json());
    const base =
      (d.base ? await db.plantilla.findUnique({ where: { slug: d.base } }) : null) ??
      (await db.plantilla.findUnique({ where: { slug: "dimerso" } })) ??
      (await db.plantilla.findFirstOrThrow({ orderBy: { nombre: "asc" } }));
    if (d.base && base.slug !== d.base) throw new Error(`No existe la plantilla «${d.base}»`);
    let datos = DatosPlantilla.parse(base.datos);
    datos.descripcion = `Copia de «${base.nombre}».`;
    if (d.estilo) {
      const e = ESTILOS_PLANTILLA.find((x) => x.id === d.estilo);
      if (!e) throw new Error(`No existe el estilo «${d.estilo}»`);
      datos = aplicarEstilo(datos, e);
      datos.descripcion = `Estilo «${e.nombre}».`;
    }
    if (d.web) {
      const w = d.web;
      for (const [k, v] of Object.entries(w.roles)) if (v) datos.colores[k as keyof typeof w.roles] = v;
      datos.colores = hacerLegible(datos.colores);
      datos.tipografia = { ...datos.tipografia, titulos: w.titulos, texto: w.texto };
      if (w.marca) {
        datos.marca = { ...datos.marca, texto: w.marca };
        datos.tarjetaFinal = { ...datos.tarjetaFinal, titulo: w.marca };
      }
      if (w.logo) datos.marca = { ...datos.marca, logo: logoDeMarcaWeb(w.logo) };
      if (w.cta) datos.cta = w.cta;
      datos.descripcion = `Con la marca de ${new URL(w.url).hostname} (${new Date().toISOString().slice(0, 10)}).`;
    }
    const p = await db.plantilla.create({ data: { slug: slugDe(d.nombre), nombre: d.nombre, datos: DatosPlantilla.parse(datos) } });
    return json({ plantilla: { slug: p.slug, nombre: p.nombre } }, 201);
  });
}
