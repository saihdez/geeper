import { filasDePasos, spansDeTrabajo } from "@/lib/trazas";

export const dynamic = "force-dynamic";

/** Los pasos de un trabajo con su duración, leídos de las trazas (src/lib/trazas.ts). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json({ pasos: filasDePasos(spansDeTrabajo(id)) });
}
