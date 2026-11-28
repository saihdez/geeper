import { z } from "zod";
import { json, manejar } from "@/lib/http";
import { ajustarFoto, dirInvitacion, usarPropuesta } from "@/lib/invitaciones/construir";
import { descartarPropuestas, leerPropuestas } from "@/lib/invitaciones/imagenes";
import { pedirImagen, PedidoImagen, trabajosDe } from "@/lib/invitaciones/trabajos";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

/** Las propuestas de IA (fotos y QR que escanean) y los trabajos en curso de esta invitación. */
export async function GET(_req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    // Las propuestas están en disco: se muestran aunque no se pueda leer la cola.
    const trabajos = await trabajosDe(slug).catch((e: unknown) => {
      console.warn(`[invitaciones] no pude leer los trabajos de ${slug}: ${e instanceof Error ? e.message : e}`);
      return [];
    });
    return json({ ...(await leerPropuestas(dirInvitacion(slug))), trabajos });
  });
}

/** Encola la foto del sobre o el QR con dibujo (usan la tarjeta: esperan su turno). */
export async function POST(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    const t = await pedirImagen(slug, PedidoImagen.parse(await req.json()));
    return json({ trabajo: t.id }, 201);
  });
}

/**
 * Usa una propuesta: `{ archivo }` (foto-… o qr-…). Con `ajustes` (sólo fotos), la usa ajustada; con
 * `ajustes` y sin `archivo`, vuelve a ajustar la foto que ya tiene la invitación.
 */
export async function PUT(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    const { archivo, ajustes } = z.object({ archivo: z.string().optional(), ajustes: z.unknown().optional() }).parse(await req.json());
    if (ajustes !== undefined) {
      const { inv, avisos } = await ajustarFoto(slug, { archivo, ajustes });
      return json({ invitacion: inv, avisos });
    }
    if (!archivo) throw new Error("Elige una imagen.");
    const { inv, avisos } = await usarPropuesta(slug, archivo);
    return json({ invitacion: inv, avisos });
  });
}

/** Descarta todas las fotos (`?que=foto`) o todos los QR (`?que=qr`) propuestos. */
export async function DELETE(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { slug } = await ctx.params;
    const que = z.enum(["foto", "qr"]).parse(new URL(req.url).searchParams.get("que"));
    return json({ borradas: await descartarPropuestas(dirInvitacion(slug), que) });
  });
}
