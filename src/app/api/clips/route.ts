import { z } from "zod";
import { Campania } from "@/lib/clips";
import { ultimoLatidoWorker } from "@/lib/cola";
import { db } from "@/lib/db";
import { Formato } from "@/lib/esquema";
import { leerFuente } from "@/lib/fuentes";
import { listarFuentes } from "@/lib/buscar-momentos";
import { ESCRITORIO } from "@/lib/plataforma";
import { json, manejar } from "@/lib/http";
import { ENCUADRES } from "@/lib/importador-clip";
import { crearClip } from "@/lib/servicios";

export const dynamic = "force-dynamic";

/** Fuentes con sus candidatos y las búsquedas de momentos en curso o recientes. */
export async function GET() {
  const trabajos = await db.trabajo.findMany({
    where: { tipo: "clip.momentos" },
    orderBy: { creado: "desc" },
    take: 10,
    select: { id: true, estado: true, etapa: true, progreso: true, error: true, payload: true, resultado: true, creado: true },
  });
  const latido = await ultimoLatidoWorker();
  const workerVivo = !!latido && Date.now() - latido.getTime() < 60_000;
  return json({ fuentes: await listarFuentes(), trabajos, workerVivo, escritorio: ESCRITORIO });
}

const Pedido = z.object({
  fuenteId: z.string().regex(/^[a-f0-9]{12}$/),
  inicio: z.number().nonnegative(),
  fin: z.number().positive(),
  encuadre: z.enum(ENCUADRES),
  idioma: z.string().min(2).max(5),
  formato: Formato,
  plantilla: z.string().min(1),
  titulo: z.string().max(160).optional(),
  gancho: z.string().max(160).optional(),
  permiso: z.string().max(300).optional(),
  glosario: z.string().max(400).optional(),
  campania: Campania.optional(),
  renderizar: z.boolean().optional(),
  mejorarVoz: z.boolean().optional(),
});

/** Crea un proyecto con un tramo de una fuente: importar → render → QC. */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = Pedido.parse(await req.json());
    const f = await leerFuente(d.fuenteId);
    const vacio = (s?: string) => (s?.trim() ? s.trim() : undefined);
    const p = await crearClip({ ...d, titulo: vacio(d.titulo), gancho: vacio(d.gancho), permiso: vacio(d.permiso), glosario: vacio(d.glosario) }, f.info.titulo);
    return json({ proyecto: p }, 201);
  });
}
