import { leerCatalogo } from "@/lib/comfyui";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { revisarComfyui } from "@/lib/instalar-comfyui";
import { aviso, bloqueo, listarCorridas, REINTENTABLES, trabajoPorCorrida } from "@/lib/workflows";

export const dynamic = "force-dynamic";

/** El catálogo (liviano, para buscar y filtrar en la página), las últimas corridas y lo que está en curso. */
export async function GET() {
  return manejar(async () => {
    const e = revisarComfyui();
    const comfy = { listo: !e.falta && !e.corriendo, falta: e.falta, instalando: e.corriendo, disponible: e.disponible };
    if (!comfy.listo) return json({ comfy, workflows: [], corridas: [], trabajos: [] });
    const { workflows } = await leerCatalogo();
    const trabajos = await db.trabajo.findMany({ where: { tipo: "workflow.correr", estado: { in: ["pendiente", "corriendo"] } }, select: { id: true, estado: true, etapa: true, progreso: true, payload: true } });
    // Para «Volver a intentar» una corrida que falló o se cortó (UX-30): el último trabajo que la corrió.
    const terminados = trabajoPorCorrida(await db.trabajo.findMany({ where: { tipo: "workflow.correr", estado: { in: [...REINTENTABLES] } }, orderBy: { creado: "desc" }, take: 100, select: { id: true, payload: true } }));
    return json({
      comfy,
      workflows: workflows.map((w) => ({
        id: w.id, titulo: w.titulo, descripcion: w.descripcion, categoria: w.categoria, tipo: w.tipo, etiquetas: w.etiquetas, modelos: w.modelos,
        tamano: w.tamano, local: w.local, bloqueo: bloqueo(w), aviso: aviso(w), comunidad: w.complementos.length > 0, entradas: w.entradas.length, uso: w.uso, fecha: w.fecha,
        miniatura: w.miniaturas[0] ? `/api/workflows/archivo/${encodeURIComponent(w.miniaturas[0])}` : null,
      })),
      corridas: (await listarCorridas()).slice(0, 30).map((c) => ({ ...c, trabajo: terminados[c.id] ?? null })),
      trabajos: trabajos.map((t) => ({ id: t.id, estado: t.estado, etapa: t.etapa, progreso: t.progreso, corrida: (t.payload as { corrida?: string }).corrida ?? null, workflow: (t.payload as { pedido?: { workflow?: string } }).pedido?.workflow ?? null })),
    });
  });
}
