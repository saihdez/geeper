import { db } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const proyectoId = u.searchParams.get("proyecto") ?? undefined;
  const trabajos = await db.trabajo.findMany({
    where: proyectoId ? { proyectoId } : {},
    orderBy: { creado: "desc" },
    take: 200,
    include: { proyecto: { select: { nombre: true, slug: true } } },
  });
  const latido = await db.sistema.findUnique({ where: { clave: "worker.latido" } });
  const ahora = Date.now();
  // La sesión de subida de una publicación permite subir a la cuenta: no sale por la API.
  for (const t of trabajos) {
    if (t.payload && typeof t.payload === "object" && "sesion" in t.payload) t.payload = { ...(t.payload as object), sesion: "[oculto]" };
  }
  // `ahora` sólo sirve para la duración de lo que empezó y no terminó: si no hay nada así va fijo, para
  // que la respuesta sea idéntica mientras nada cambie y la pantalla no se repinte (useSondeo compara).
  const enCurso = trabajos.some((t) => t.iniciado && !t.terminado);
  return json({ trabajos, workerVivo: !!latido && ahora - new Date(latido.valor).getTime() < 60_000, ahora: enCurso ? ahora : 0 });
}
