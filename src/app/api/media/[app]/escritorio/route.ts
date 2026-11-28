import { z } from "zod";
import { abrirAvnac, AVNAC, instalarAvnac } from "@/lib/avnac";
import { abrirEscritorio, appEscritorio, instalarEscritorio } from "@/lib/craft-escritorio";
import { json, manejar } from "@/lib/http";

export const dynamic = "force-dynamic";

const Pedido = z.object({ accion: z.enum(["instalar", "abrir"]) }).strict();

/** Instala (vuelve enseguida; el avance sale en GET /api/media) o abre el programa de escritorio de una app Craft. */
export async function POST(req: Request, ctx: { params: Promise<{ app: string }> }) {
  return manejar(async () => {
    const app = (await ctx.params).app;
    const texto = await req.text();
    const { accion } = Pedido.parse(texto ? JSON.parse(texto) : {});
    if (app === AVNAC.id) {
      if (accion === "abrir") {
        await abrirAvnac();
        return json({ ok: true });
      }
      return json(instalarAvnac(), 202);
    }
    const a = appEscritorio(app);
    if (!a) return json({ error: "Esa app no es de escritorio" }, 404);
    if (accion === "abrir") {
      abrirEscritorio(a);
      return json({ ok: true });
    }
    return json(instalarEscritorio(a), 202);
  });
}
