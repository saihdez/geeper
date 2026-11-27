import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { crearPropuesta, ESTILOS, FONDOS, listarAvatares, MAX_DESCRIPCION, Pedido, TEXTO_CONSENTIMIENTO, vistaAvatar } from "@/lib/avatares";
import { retoquesVisibles } from "@/lib/asistente-avatar";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { guardarImagenSubida } from "@/lib/imagen-subida";
import { revisarWan2gp } from "@/lib/instalar-wan2gp";
import { LOOKS, LUCES, NOMBRES } from "@/lib/prompt-camara";

export const dynamic = "force-dynamic";

const FOTOS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** Biblioteca de avatares y lo que hace falta para crear uno (estilos, fondos, luces, looks). */
export async function GET() {
  return manejar(async () => {
    const w = revisarWan2gp();
    const sel = { id: true, tipo: true, estado: true, etapa: true, progreso: true, error: true, payload: true, creado: true } as const;
    const avatares = await listarAvatares();
    const proponer = await db.trabajo.findMany({ where: { tipo: "avatar.proponer", estado: { in: ["pendiente", "corriendo"] } }, orderBy: { creado: "desc" }, select: sel });
    // Retoques: el más nuevo de cada avatar, también si falló después de su último cambio (UX-13).
    const retocar = retoquesVisibles(
      await db.trabajo.findMany({ where: { tipo: "avatar.retocar", estado: { in: ["pendiente", "corriendo", "fallido"] } }, orderBy: { creado: "desc" }, take: 100, select: sel }),
      Object.fromEntries(avatares.map((a) => [a.id, a.actualizado])),
    );
    const trabajos = [...proponer, ...retocar];
    return json({
      wan2gp: { listo: !w.falta, falta: w.falta, instalando: w.corriendo },
      avatares: avatares.map(vistaAvatar),
      estilos: Object.entries(ESTILOS).map(([id, e]) => ({ id, nombre: e.nombre, detalle: e.detalle })),
      fondos: Object.entries(FONDOS).map(([id, f]) => ({ id, nombre: f.nombre })),
      luces: Object.keys(LUCES).map((id) => ({ id, nombre: NOMBRES.luz[id as keyof typeof LUCES] })),
      looks: Object.keys(LOOKS).map((id) => ({ id, nombre: NOMBRES.look[id as keyof typeof LOOKS] })),
      consentimiento: TEXTO_CONSENTIMIENTO,
      maxDescripcion: MAX_DESCRIPCION,
      trabajos: trabajos.map((t) => ({ id: t.id, tipo: t.tipo, estado: t.estado, etapa: t.etapa, progreso: t.progreso, error: t.estado === "fallido" ? (t.error ?? "").split("\n")[0]!.slice(0, 300) : null, avatar: (t.payload as { avatar?: string }).avatar ?? null, propuesta: (t.payload as { propuesta?: string }).propuesta ?? null })),
    });
  });
}

/**
 * Empieza un avatar: con una descripción (4 retratos) o con una foto (2 versiones, con consentimiento).
 * Multipart: `pedido` (JSON), `foto` (opcional) y `consiento` («si»). Encola `avatar.proponer`.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const w = revisarWan2gp();
    if (w.falta) throw new Error("Falta instalar Wan2GP: ve a Sistema y pulsa «Instalar» en «Wan2GP».");
    const form = await req.formData();
    const pedido = Pedido.parse(JSON.parse(String(form.get("pedido") ?? "{}")));
    const foto = form.get("foto");
    let rutaFoto: string | undefined;
    let consentimiento: { texto: string; fecha: string } | undefined;
    if (foto instanceof File && foto.size > 0) {
      if (!FOTOS.has(path.extname(foto.name).toLowerCase())) throw new Error("La foto tiene que ser PNG, JPG o WebP.");
      if (z.literal("si").safeParse(form.get("consiento")).success !== true) throw new Error("Para usar una foto, confirma que eres tú o que tienes permiso de la persona.");
      consentimiento = { texto: TEXTO_CONSENTIMIENTO, fecha: new Date().toISOString() };
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-foto-"));
      try {
        rutaFoto = (await guardarImagenSubida(foto, tmp, "foto")).abs;
        const propuesta = await crearPropuesta({ pedido, foto: rutaFoto, consentimiento });
        const t = await encolar(null, "avatar.proponer", { propuesta });
        return json({ propuesta, trabajo: t.id }, 201);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    }
    const propuesta = await crearPropuesta({ pedido });
    const t = await encolar(null, "avatar.proponer", { propuesta });
    return json({ propuesta, trabajo: t.id }, 201);
  });
}
