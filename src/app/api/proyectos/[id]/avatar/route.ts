import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CuerpoAvatar, EJEMPLOS_ACCION, ENCUADRES, guardarAvatarDelVideo, leerAvatarDelVideo, PedidoActuar, PedidoStreamer } from "@/lib/actuar";
import { leerAvatar, listarAvatares, vistaAvatar } from "@/lib/avatares";
import { estadoPresentador } from "@/lib/presentador";
import { escenasProtagonista, hablaConSuVoz, minutosProtagonista } from "@/lib/protagonista";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { revisarWan2gp } from "@/lib/instalar-wan2gp";
import { versionDeProyecto } from "@/lib/render";
import { dirProyecto } from "@/lib/rutas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const TIPOS = ["avatar.actuar", "avatar.streamer", "avatar.escenas"] as const;
const activos = (id: string) =>
  db.trabajo.findMany({ where: { proyectoId: id, tipo: { in: [...TIPOS] }, estado: { in: ["pendiente", "corriendo"] } }, select: { id: true, tipo: true, estado: true, etapa: true, progreso: true, payload: true } });

/** Lo que necesitan los paneles del avatar: la biblioteca, el avatar del video, el plan de protagonista y lo que está en curso. */
export async function GET(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const avatares = (await listarAvatares()).map(vistaAvatar);
    const delVideo = await leerAvatarDelVideo(fila.slug);
    const q = new URL(req.url).searchParams;
    const elegido = q.get("avatar") ?? delVideo?.avatar ?? avatares[0]?.id ?? null;
    // Protagonista (protagonista.ts): cuántas tomas, cuánto tarda y si antes cambia la voz.
    let plan: { escenas: number; tomas: number; segundos: number; minutos: number; voz: string | null; error: string | null } | null = null;
    // Ya es protagonista y después cambió lo que se dice: la boca quedó desfasada.
    let desfasado = false;
    if (elegido && fila.versionActual > 0) {
      const { p } = await versionDeProyecto(id);
      desfasado = estadoPresentador(p).viejoPantalla;
      const a = avatares.find((x) => x.id === elegido);
      const voz = a?.voz && !hablaConSuVoz(p.voz, a.voz) ? a.voz.nombre : null;
      try {
        const s = escenasProtagonista(p).map((e) => e.segundos);
        plan = { escenas: Object.keys(p.escenas).length, tomas: s.length, segundos: Math.round(s.reduce((x, y) => x + y, 0)), minutos: minutosProtagonista(s) + (voz ? 3 : 0), voz, error: null };
      } catch (e) {
        plan = { escenas: Object.keys(p.escenas).length, tomas: 0, segundos: 0, minutos: 0, voz, error: (e as Error).message };
      }
    }
    const w = revisarWan2gp();
    return json({
      wan2gp: { listo: !w.falta, falta: w.falta },
      avatares,
      delVideo,
      encuadres: Object.fromEntries(Object.entries(ENCUADRES).map(([k, v]) => [k, v.nombre])),
      ejemplos: EJEMPLOS_ACCION,
      plan,
      desfasado,
      trabajos: (await activos(id)).map((t) => ({ id: t.id, tipo: t.tipo, estado: t.estado, etapa: t.etapa, progreso: t.progreso, escena: (t.payload as { escena?: string }).escena ?? null })),
    });
  });
}

const Accion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("escena"), escena: z.string().min(1).max(64), pedido: PedidoActuar }),
  z.object({ accion: z.literal("streamer"), pedido: PedidoStreamer }),
  z.object({ accion: z.literal("proponer"), avatar: z.string().regex(/^[a-z0-9-]+$/), producto: z.string().regex(/^assets\/[\w.-]+$/).optional(), cuerpo: CuerpoAvatar.optional() }),
]);

const IMAGEN = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * JSON: encola el avatar en una escena, como streamer (lo pide el «Presentador») o en todo el video.
 * Multipart con `producto`: guarda la foto del producto en el proyecto y devuelve su ruta.
 */
export async function POST(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const f = (await req.formData()).get("producto");
      if (!(f instanceof File) || !f.size) throw new Error("Falta la foto del producto");
      const ext = path.extname(f.name).toLowerCase();
      if (!IMAGEN.has(ext)) throw new Error("La foto del producto tiene que ser PNG, JPG o WebP");
      if (f.size > 25 * 1024 ** 2) throw new Error("La foto pasa de 25 MB");
      const datos = Buffer.from(await f.arrayBuffer());
      const ruta = `assets/producto-${createHash("sha256").update(datos).digest("hex").slice(0, 12)}${ext}`;
      await fs.mkdir(path.join(dirProyecto(fila.slug), "assets"), { recursive: true });
      await fs.writeFile(path.join(dirProyecto(fila.slug), ruta), datos);
      return json({ producto: ruta }, 201);
    }
    const d = Accion.parse(await req.json());
    if (fila.versionActual < 1) throw new Error("El video todavía se está generando: espera a que termine.");
    if (revisarWan2gp().falta) throw new Error("Falta instalar Wan2GP: ve a Sistema y pulsa «Instalar» en «Wan2GP».");
    const avatar = d.accion === "proponer" ? d.avatar : d.pedido.avatar;
    await leerAvatar(avatar).catch(() => { throw new Error("Ese avatar ya no está en la biblioteca."); });
    const enCurso = await activos(id);
    if (d.accion === "escena") {
      if (enCurso.some((t) => (t.payload as { escena?: string }).escena === d.escena)) throw new Error("Tu avatar ya se está poniendo en esa escena: mira el avance aquí mismo.");
      return json({ trabajo: await encolar(id, "avatar.actuar", { escena: d.escena, pedido: d.pedido, cadena: [] }) }, 201);
    }
    if (d.accion === "streamer") {
      if (enCurso.some((t) => t.tipo === "avatar.streamer")) throw new Error("Tu avatar streamer ya está en camino.");
      return json({ trabajo: await encolar(id, "avatar.streamer", { pedido: d.pedido, cadena: [] }) }, 201);
    }
    if (enCurso.some((t) => t.tipo === "avatar.escenas")) throw new Error("Geeper ya está poniendo a tu avatar en el video.");
    await guardarAvatarDelVideo(fila.slug, { avatar: d.avatar, producto: d.producto, cuerpo: d.cuerpo });
    return json({ trabajo: await encolar(id, "avatar.escenas", { cadena: [] }) }, 201);
  });
}
