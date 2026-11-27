import { z } from "zod";
import { guardarProyecto, registrarAssetsEnDb } from "@/lib/almacen";
import { animoSugerido, ANIMOS, musicaLibre, musicaLibreActual, ponerMusicaLibre, quitarMusica, sonidoLibre } from "@/lib/audio-libre";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";
import { dirProyecto } from "@/lib/rutas";

export const dynamic = "force-dynamic";

/** Qué música suena, el ánimo que sugiere el tema y las canciones libres para escuchar y elegir. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) return json({ listo: false });
    const { p } = await versionDeProyecto(id);
    const actual = musicaLibreActual(p);
    return json({
      listo: true,
      hayMusica: p.pistas.some((x) => x.id === "musica"),
      actual: actual ? { id: actual.id, nombre: actual.nombre, animo: actual.grupo } : null,
      licencia: p.assets.musica?.licencia ?? null,
      sugerido: animoSugerido(`${p.tema} ${p.nombre}`),
      animos: ANIMOS,
      canciones: musicaLibre(null).map((s) => ({ id: s.id, nombre: s.nombre, animo: s.grupo, segundos: s.segundos, muestra: `/api/audio-libre/${s.id}` })),
    });
  });
}

const Pedido = z.union([z.object({ cancion: z.string().regex(/^[a-z0-9-]+$/) }), z.object({ quitar: z.literal(true) })]);

/** Cambia la música por una canción libre, o la quita. Al instante, sin tarjeta de video. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const d = Pedido.parse(await req.json());
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) throw new Error("El video todavía no está armado.");
    const { p } = await versionDeProyecto(id);
    if ("quitar" in d) {
      const version = await guardarProyecto(id, quitarMusica(p), "Sin música");
      return json({ version });
    }
    const s = sonidoLibre(d.cancion);
    if (!s || s.tipo !== "musica") throw new Error("Esa canción no está entre las que vienen con Geeper.");
    const nuevo = await ponerMusicaLibre(dirProyecto(fila.slug), p, s);
    const version = await guardarProyecto(id, nuevo, `Música: «${s.nombre}»`);
    await registrarAssetsEnDb(id, nuevo);
    return json({ version, nombre: s.nombre });
  });
}
