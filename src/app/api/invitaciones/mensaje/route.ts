import { z } from "zod";
import { tomarGpu } from "@/lib/gpu";
import { json, manejar } from "@/lib/http";
import { Tipo } from "@/lib/invitaciones/esquema";
import { leerMensajes, promptMensaje } from "@/lib/invitaciones/mensaje";
import { preguntarLlama } from "@/lib/llm-local";

export const dynamic = "force-dynamic";

/** «Escríbelo por mí con IA»: tres mensajes del modelo local (toma la tarjeta un momento y la suelta). */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = z.object({ tipo: Tipo, nombres: z.string().trim().min(1).max(80), tono: z.string().trim().max(60).optional() }).parse(await req.json());
    const candado = await tomarGpu("mensaje de invitación", { esperar: false });
    if (!candado) throw new Error("La tarjeta de video está ocupada (renderizando o generando). Prueba en un rato o elige uno de los mensajes listos.");
    let crudo: string | null;
    try {
      crudo = await preguntarLlama(promptMensaje(d), { timeout: 150_000, log: (l) => console.info(`[mensaje de invitación] ${l}`) });
    } finally {
      candado.liberar();
    }
    if (crudo === null) throw new Error("El modelo de texto de tu PC no está listo. Elige uno de los mensajes listos o escríbelo a mano.");
    const mensajes = leerMensajes(crudo);
    if (!mensajes.length) throw new Error("El modelo no dio mensajes que sirvan: prueba otra vez o elige uno de los listos.");
    return json({ mensajes });
  });
}
