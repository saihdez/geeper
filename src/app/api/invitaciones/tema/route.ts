import { z } from "zod";
import { MODELO_GANCHOS } from "@/lib/ganchos";
import { json, manejar } from "@/lib/http";
import { Tipo } from "@/lib/invitaciones/esquema";
import { normalizarTema, promptTema, TemaIa, temaPorPalabras } from "@/lib/invitaciones/tema";
import { ErrorLlm, pedirJson } from "@/lib/llm-local";

export const dynamic = "force-dynamic";

/**
 * «Diseñar mi tema»: la IA local elige colores, letras, adornos, animación y textos para la idea.
 * Si la IA no puede (tarjeta ocupada, modelo apagado o respuesta rara), se arma con las palabras de la
 * idea y se avisa: la persona nunca se queda sin tema.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const d = z.object({
      idea: z.string().trim().min(3, "Escribe tu idea con un poco más de detalle").max(300),
      tipo: Tipo,
      nombres: z.string().trim().max(80).default(""),
      sinIa: z.boolean().default(false),
    }).parse(await req.json());
    if (d.sinIa) return json({ tema: temaPorPalabras(d.idea, d.tipo), conIa: false });
    try {
      const r = await pedirJson(MODELO_GANCHOS, promptTema({ ...d, nombres: d.nombres || "quien invita" }), TemaIa, { tarea: "tema de invitación", temperatura: 0.9 });
      return json({ tema: normalizarTema(r.datos, d.idea), conIa: true });
    } catch (e) {
      const motivo = e instanceof ErrorLlm ? e.message : "La IA no respondió bien.";
      console.warn(`[tema de invitación] sin IA: ${e instanceof Error ? e.message : e}`);
      return json({
        tema: temaPorPalabras(d.idea, d.tipo),
        conIa: false,
        aviso: `${motivo.replace(/\s*$/, "")} Armé el tema con las palabras de tu idea; puedes probar con la IA otra vez más tarde.`,
      });
    }
  });
}
