import { limpiarRespuestaChat, PedidoChat, promptChat, RespuestaChatIa } from "@/lib/chat-asistente";
import { MODELO_GANCHOS } from "@/lib/ganchos";
import { json, manejar } from "@/lib/http";
import { pedirJson } from "@/lib/llm-local";

export const dynamic = "force-dynamic";

/**
 * «Preguntarle a la IA» del chat del asistente. Sólo cuando la persona lo pulsa: toma la tarjeta gráfica
 * sin esperar (si está ocupada, lo dice) y la IA sólo puede devolver ids de las acciones que mandó la
 * página (src/lib/chat-asistente.ts).
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = PedidoChat.parse(await req.json());
    const r = await pedirJson(MODELO_GANCHOS, promptChat(d), RespuestaChatIa, { tarea: "asistente: chat", temperatura: 0.3, timeoutMs: 180_000 });
    return json(limpiarRespuestaChat(r.datos, d.acciones.map((a) => a.id)));
  });
}
