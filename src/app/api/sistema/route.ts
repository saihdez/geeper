import { diagnosticar } from "@/lib/doctor";
import { json } from "@/lib/http";
import { memoConPlazo } from "@/lib/memo-plazo";

export const dynamic = "force-dynamic";

/** El diagnóstico lanza unos 11 procesos y mide la IP: una sola revisión a la vez y guardada 60 s. */
const revisar = memoConPlazo(diagnosticar, 60_000);

/** GET /api/sistema → la última revisión (≤ 60 s); `?forzar` vuelve a revisar ahora («Volver a revisar»). */
export async function GET(req: Request) {
  const forzar = new URL(req.url).searchParams.has("forzar");
  const { valor, cuando } = await revisar(forzar);
  return json({ chequeos: valor, revisado: new Date(cuando).toISOString() });
}
