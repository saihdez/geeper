import { siguientes } from "@/lib/asistente";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

/** «Lo siguiente» de Inicio: lo más importante de cada proyecto reciente. Sólo lee; sin GPU. */
export async function GET() {
  return manejar(async () => json({ siguientes: await siguientes() }));
}
