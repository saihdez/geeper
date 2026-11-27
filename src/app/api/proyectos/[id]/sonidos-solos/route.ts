import { z } from "zod";
import { guardarProyecto, registrarAssetsEnDb } from "@/lib/almacen";
import { momentosSonidosSolos, PISTA_SONIDOS_SOLOS, ponerSonidosSolos, quitarSonidosSolos } from "@/lib/audio-libre";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";
import { dirProyecto } from "@/lib/rutas";

export const dynamic = "force-dynamic";

/** Cuántos sonidos puso «Poner sonidos solos» y cuántos pondría ahora. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) return json({ puestos: 0, posibles: 0 });
    const { p } = await versionDeProyecto(id);
    const puestos = p.pistas.find((x) => x.id === PISTA_SONIDOS_SOLOS)?.clips.length ?? 0;
    return json({ puestos, posibles: momentosSonidosSolos(p).length });
  });
}

const Pedido = z.object({ quitar: z.boolean().default(false) });

/**
 * Un clic: un whoosh suave en cada cambio de escena y un pop cuando aparece un texto, con los sonidos
 * libres (sin tarjeta de video). Volver a pulsarlo los vuelve a poner; `quitar` los saca todos juntos.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const d = Pedido.parse(await req.json().catch(() => ({})));
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) throw new Error("El video todavía no está armado.");
    const { p } = await versionDeProyecto(id);
    if (d.quitar) {
      const version = await guardarProyecto(id, quitarSonidosSolos(p), "Sin los sonidos automáticos");
      return json({ version, puestos: 0 });
    }
    const r = await ponerSonidosSolos(dirProyecto(fila.slug), p);
    if (!r.puestos) throw new Error("Este video tiene una sola escena y ningún texto en pantalla: no hay dónde poner sonidos.");
    const version = await guardarProyecto(id, r.p, `${r.puestos} sonidos automáticos`);
    await registrarAssetsEnDb(id, r.p);
    return json({ version, puestos: r.puestos });
  });
}
