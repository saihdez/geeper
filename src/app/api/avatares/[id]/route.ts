import { z } from "zod";
import { borrarAvatar, cambiarVozAvatar, deshacerRetoque, elegirRetoque, leerAvatar, renombrarAvatar, vistaAvatar, VozAvatar } from "@/lib/avatares";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { revisarWan2gp } from "@/lib/instalar-wan2gp";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const retoques = (id: string) =>
  db.trabajo.findMany({ where: { tipo: "avatar.retocar", estado: { in: ["pendiente", "corriendo", "fallido"] } }, orderBy: { creado: "desc" }, take: 20, select: { id: true, estado: true, etapa: true, progreso: true, error: true, payload: true, creado: true } })
    .then((ts) => ts.filter((t) => (t.payload as { avatar?: string }).avatar === id));

export async function GET(_: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const ts = await retoques(id);
    const a = await leerAvatar(id);
    // Un retoque fallido sólo importa si es más nuevo que el último cambio del avatar.
    const vivos = ts.filter((t) => t.estado !== "fallido" || t.creado.toISOString() > a.actualizado);
    return json({ avatar: vistaAvatar(a), trabajos: vivos.map((t) => ({ id: t.id, estado: t.estado, etapa: t.etapa, progreso: t.progreso, error: t.error, instruccion: (t.payload as { instruccion?: string }).instruccion ?? "" })) });
  });
}

/** Retocar con una instrucción («ponle lentes»): encola `avatar.retocar`. */
export async function POST(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const d = z.object({ instruccion: z.string().trim().min(3, "Escribe qué quieres cambiar").max(400), semilla: z.number().int().min(0).optional() }).parse(await req.json());
    await leerAvatar(id);
    if (revisarWan2gp().falta) throw new Error("Falta instalar Wan2GP: ve a Sistema y pulsa «Instalar» en «Wan2GP».");
    if ((await retoques(id)).some((t) => t.estado !== "fallido")) throw new Error("Ya hay un retoque en curso para este avatar: espera a que termine.");
    const t = await encolar(null, "avatar.retocar", { avatar: id, instruccion: d.instruccion, semilla: d.semilla });
    return json({ trabajo: t.id }, 201);
  });
}

/** Renombrar, cambiar la voz, elegir una opción del retoque (o quedarse con el actual) o deshacer el último. */
export async function PATCH(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const d = z
      .union([
        z.object({ nombre: z.string() }),
        z.object({ deshacer: z.literal(true) }),
        z.object({ voz: VozAvatar.nullable() }),
        z.object({ elegirRetoque: z.number().int().min(1).max(9).nullable() }),
      ])
      .parse(await req.json());
    const a = "nombre" in d ? await renombrarAvatar(id, d.nombre)
      : "voz" in d ? await cambiarVozAvatar(id, d.voz)
      : "elegirRetoque" in d ? await elegirRetoque(id, d.elegirRetoque)
      : await deshacerRetoque(id);
    return json({ avatar: vistaAvatar(a) });
  });
}

export async function DELETE(_: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    await borrarAvatar(id);
    return json({ ok: true });
  });
}
