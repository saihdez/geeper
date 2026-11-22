import { TIPOS } from "@/lib/cola";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Cuánto sigue a la vista una tarea que terminó, para que se vea que acabó (o que falló). */
const RECIENTE_MS = 20_000;

const nombreDe = (tipo: string) => (TIPOS as Record<string, { nombre: string }>)[tipo]?.nombre ?? tipo;

/** Tareas en curso (y las que acaban de terminar) para el panel flotante: liviano, se consulta seguido. */
export async function GET() {
  return manejar(async () => {
    const ahora = Date.now();
    const [trabajos, latido] = await Promise.all([
      db.trabajo.findMany({
        where: { OR: [{ estado: { in: ["pendiente", "corriendo"] } }, { terminado: { gte: new Date(ahora - RECIENTE_MS) } }] },
        orderBy: { creado: "asc" },
        take: 30,
        select: { id: true, tipo: true, estado: true, etapa: true, progreso: true, error: true, creado: true, iniciado: true, terminado: true, proyecto: { select: { id: true, nombre: true } } },
      }),
      db.sistema.findUnique({ where: { clave: "worker.latido" } }),
    ]);
    return json({
      ahora,
      workerVivo: !!latido && ahora - new Date(latido.valor).getTime() < 60_000,
      trabajos: trabajos.map((t) => ({ ...t, nombre: nombreDe(t.tipo) })),
    });
  });
}
