import { json, manejar } from "@/lib/http";
import { abrirEnAvnac, archivoAvnac, traerDeAvnac } from "@/lib/invitaciones/construir";

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

const MAX_ARCHIVO = 60 * 1024 ** 2;

/**
 * «Traer los cambios de Avnac»: sin archivo, lo lee de la carpeta de Avnac; con un archivo exportado de
 * Avnac (.avnac / .json, multipart `archivo`), de ahí. Pasa textos, partes borradas, colores, letras y foto.
 */
export async function PUT(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    let raw: unknown;
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const archivo = (await req.formData()).get("archivo");
      if (!(archivo instanceof File) || !archivo.size) throw new Error("Elige el archivo que exportaste de Avnac.");
      if (archivo.size > MAX_ARCHIVO) throw new Error("Ese archivo es demasiado grande (más de 60 MB).");
      try {
        raw = JSON.parse(await archivo.text());
      } catch {
        throw new Error("Ese archivo no es un diseño de Avnac Studio. Expórtalo desde Avnac (Export, como .avnac) y vuelve a intentar.");
      }
    }
    return json(await traerDeAvnac(slug, raw));
  });
}
