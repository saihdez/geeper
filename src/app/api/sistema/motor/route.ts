/** ¿Está andando el motor (worker)? Lo pregunta el aviso común de la barra cada 30 s: una lectura de la base. */
import { ultimoLatidoWorker } from "@/lib/cola";
import { json } from "@/lib/http";
import { motorVivo } from "@/lib/motor";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ vivo: motorVivo(await ultimoLatidoWorker(), Date.now()) });
}
