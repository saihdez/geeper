import path from "node:path";
import { z } from "zod";
import { versionBlender } from "@/lib/blender";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { archivosCorrida3d, listarCorridas3d, Pedido3d, prepararCorrida3d } from "@/lib/escenas3d";
import { json, manejar } from "@/lib/http";
import { estadoInstalacionBlender } from "@/lib/instalar-blender";
import { llamaDisponible } from "@/lib/llm-local";

export const dynamic = "force-dynamic";

const MAX_ARCHIVO = 25 * 1024 * 1024;
const EXT = [".png", ".jpg", ".jpeg", ".webp", ".svg"];

/** Si Blender está listo, las escenas hechas y las que se están haciendo. */
export async function GET() {
  return manejar(async () => {
    const version = await versionBlender();
    const instalacion = estadoInstalacionBlender();
    const trabajos = await db.trabajo.findMany({
      where: { tipo: "escena3d.crear", estado: { in: ["pendiente", "corriendo"] } },
      select: { id: true, estado: true, etapa: true, progreso: true, payload: true, proyectoId: true },
      orderBy: { creado: "asc" },
    });
    const corridas = (await listarCorridas3d()).slice(0, 40).map((c) => ({ ...c, ...archivosCorrida3d(c) }));
    return json({
      blender: { listo: !!version, version, instalacion },
      describirConIa: llamaDisponible(),
      corridas,
      trabajos: trabajos.map((t) => ({ id: t.id, estado: t.estado, etapa: t.etapa, progreso: t.progreso, corrida: (t.payload as { corrida?: string }).corrida ?? null, proyecto: t.proyectoId, escena: (t.payload as { escena?: string }).escena ?? null })),
    });
  });
}

/**
 * Crea una escena 3D: multipart con `pedido` (JSON), `archivo` opcional (foto o logo), `fondo` opcional
 * (la foto de fondo), `voz` opcional (la grabación del personaje) y, si viene del
 * editor, `proyecto` y `escena` (cuando termine se pone sola en esa escena).
 */
export async function POST(req: Request) {
  return manejar(async () => {
    if (!(await versionBlender())) throw new Error("Primero instala Blender (botón «Instalar con un clic»).");
    const form = await req.formData();
    const pedido = Pedido3d.parse(JSON.parse(String(form.get("pedido") ?? "{}")));
    const leer = async (campo: string, extensiones: string[]) => {
      const f = form.get(campo);
      if (!(f instanceof File) || !f.size) return undefined;
      const ext = path.extname(f.name).toLowerCase();
      if (!extensiones.includes(ext)) throw new Error(campo === "voz" ? "Esa grabación no sirve: sube un MP3, WAV, M4A u OGG." : "Ese archivo no sirve: sube una imagen PNG, JPG o WebP, o un logo SVG.");
      if (f.size > MAX_ARCHIVO) throw new Error("La imagen pasa de 25 MB: usa una más liviana.");
      return { nombre: f.name, datos: Buffer.from(await f.arrayBuffer()) };
    };
    const archivo = await leer("archivo", EXT);
    const fondo = await leer("fondo", EXT.filter((e) => e !== ".svg"));
    const voz = await leer("voz", [".mp3", ".wav", ".m4a", ".ogg", ".webm"]);
    const destino = z.object({ proyecto: z.string().min(1), escena: z.string().min(1) }).safeParse({ proyecto: form.get("proyecto"), escena: form.get("escena") });
    if (destino.success) await db.proyecto.findUniqueOrThrow({ where: { id: destino.data.proyecto } });
    const c = await prepararCorrida3d(pedido, archivo, fondo, voz);
    const t = await encolar(destino.success ? destino.data.proyecto : null, "escena3d.crear", { corrida: c.id, ...(destino.success ? { escena: destino.data.escena } : {}) });
    return json({ corrida: c.id, trabajo: t.id }, 201);
  });
}
