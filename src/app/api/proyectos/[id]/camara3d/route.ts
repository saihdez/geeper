import { z } from "zod";
import { faltaCamara3d } from "@/lib/camara3d";
import { INTENSIDADES_CAMARA3D, MOVIMIENTOS_CAMARA3D } from "@/lib/camara3d-catalogo";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const ids = <T extends readonly { id: string }[]>(xs: T) => xs.map((x) => x.id) as [T[number]["id"], ...T[number]["id"][]];

const Pedido = z.object({
  escena: z.string().min(1),
  opciones: z.object({
    movimiento: z.enum(ids(MOVIMIENTOS_CAMARA3D)).optional(),
    intensidad: z.enum(ids(INTENSIDADES_CAMARA3D)).optional(),
    calidad: z.enum(["rapida", "normal", "alta"]).optional(),
  }).strict().default({}),
}).strict();

/** Si se puede usar la cámara 3D y qué escenas la están haciendo ahora. */
export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const trabajos = await db.trabajo.findMany({
      where: { proyectoId: id, tipo: "camara3d.generar", estado: { in: ["pendiente", "corriendo"] } },
      select: { id: true, estado: true, etapa: true, progreso: true, payload: true },
    });
    return json({
      falta: await faltaCamara3d(),
      trabajos: trabajos.map((t) => ({ id: t.id, estado: t.estado, etapa: t.etapa, progreso: t.progreso, escena: (t.payload as { escena?: string }).escena ?? null })),
    });
  });
}

/** Pide la cámara 3D para una escena (trabajo en la fila de la GPU). */
export async function POST(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const pedido = Pedido.parse(await req.json());
    const falta = await faltaCamara3d();
    if (falta) throw new Error(falta);
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    const t = await encolar(id, "camara3d.generar", { escena: pedido.escena, opciones: pedido.opciones });
    return json({ trabajo: t.id }, 202);
  });
}
