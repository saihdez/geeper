import { json, manejar } from "@/lib/http";
import { abrirEnAvnac, archivoAvnac } from "@/lib/invitaciones/construir";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

/** «Editar en Avnac Studio»: deja el diseño en la carpeta Avnac, abre el programa y muestra el archivo. */
export async function POST(_req: Request, ctx: Ctx) {
  return manejar(async () => json(await abrirEnAvnac((await ctx.params).slug)));
}

/** El mismo diseño para descargar (queda en Descargas, a mano desde «Import» de Avnac). */
export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { nombre, contenido } = await archivoAvnac((await ctx.params).slug);
    return new Response(contenido, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="invitacion.workspace.avnac"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "cache-control": "no-store",
      },
    });
  });
}
