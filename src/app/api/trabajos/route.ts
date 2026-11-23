import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { ESCRITORIO } from "@/lib/plataforma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return manejar(() => listar(req));
}

async function listar(req: Request) {
  const u = new URL(req.url);
  const proyectoId = u.searchParams.get("proyecto") ?? undefined;
  const trabajos = await db.trabajo.findMany({
    where: proyectoId ? { proyectoId } : {},
    orderBy: { creado: "desc" },
    take: 200,
    // Lo que pinta lista-trabajos: sin payload (la sesión de subida no sale), resultado ni log.
    select: {
      id: true, tipo: true, motor: true, estado: true, etapa: true, progreso: true, error: true, intentos: true, usaGpu: true,
      creado: true, iniciado: true, terminado: true, proyectoId: true,
      proyecto: { select: { nombre: true, slug: true } },
    },
  });
  const latido = await db.sistema.findUnique({ where: { clave: "worker.latido" } });
  const ahora = Date.now();
  // `ahora` sólo sirve para la duración de lo que empezó y no terminó: si no hay nada así va fijo, para
  // que la respuesta sea idéntica mientras nada cambie y la pantalla no se repinte (useSondeo compara).
  const enCurso = trabajos.some((t) => t.iniciado && !t.terminado);
  return json({ trabajos, workerVivo: !!latido && ahora - new Date(latido.valor).getTime() < 60_000, ahora: enCurso ? ahora : 0, escritorio: ESCRITORIO });
}
