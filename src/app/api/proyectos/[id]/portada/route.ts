import { z } from "zod";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { versionPhotocraft } from "@/lib/photocraft";
import { obtenerPlantilla } from "@/lib/plantillas";
import { crearOpciones, datosParaTitulos, elegirOpcion, ESTILOS_PORTADA, guardarTitulos, imagenesPorEscena, leerPortada } from "@/lib/portada";
import { versionDeProyecto } from "@/lib/render";
import { proponerTitulos } from "@/lib/titulos";

export const dynamic = "force-dynamic";

/** Estado de la portada + una imagen por escena para elegir + los estilos disponibles. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const estado = await leerPortada(fila.slug);
    let escenas: { escena: number; miniatura: string; cara: boolean }[] = [];
    if (fila.versionActual >= 1) {
      const { p } = await versionDeProyecto(id);
      escenas = imagenesPorEscena(p).map((x) => ({
        escena: x.escena,
        miniatura: `/api/miniatura?p=${encodeURIComponent(fila.slug)}&ruta=${encodeURIComponent(x.ruta)}&t=${x.segundo.toFixed(1)}`,
        cara: x.foco !== null,
      }));
    }
    const { datos } = await obtenerPlantilla(fila.plantilla);
    return json({
      ...estado,
      escenas,
      estilos: Object.entries(ESTILOS_PORTADA).map(([id, e]) => ({ id, ...e })),
      estilo: datos.portada.estilo,
      disenoPropio: !!datos.portada.plantillas[fila.formato as "9:16"],
      herramienta: !!(await versionPhotocraft()),
    });
  });
}

const Pedido = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("titulos") }),
  z.object({
    accion: z.literal("crear"),
    titulos: z.array(z.string().trim().max(140)).min(1).max(3),
    escena: z.number().int().min(0).optional(),
    estilo: z.enum(["abajo", "centro", "banda"]).optional(),
  }),
  z.object({ accion: z.literal("elegir"), indice: z.number().int().min(0).max(2) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const pedido = Pedido.parse(await req.json());
    if (pedido.accion === "titulos") {
      const d = await datosParaTitulos(id);
      const propuesta = await proponerTitulos(d);
      await guardarTitulos(d.slug, propuesta);
      return json(propuesta);
    }
    if (pedido.accion === "crear") {
      if (!(await versionPhotocraft())) throw new Error("Falta la herramienta de portadas. Instálala con un clic en Sistema.");
      return json(await crearOpciones(id, pedido), 201);
    }
    return json(await elegirOpcion(id, pedido.indice));
  });
}
