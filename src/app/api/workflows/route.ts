import { A_MEDIAS, leerCatalogo } from "@/lib/comfyui";
import { db } from "@/lib/db";
import { json, manejar } from "@/lib/http";
import { revisarComfyui } from "@/lib/instalar-comfyui";
import { aviso, bloqueo, listarCorridas, REINTENTABLES, trabajoPorCorrida } from "@/lib/workflows";
import { tipoMiniatura } from "@/lib/workflows-texto";

export const dynamic = "force-dynamic";

/** Ya se probó leer el catálogo de una ComfyUI «a medias» y falló: no se vuelve a correr Python en cada sondeo. */
const g = globalThis as { __comfyAMediasProbada?: string };

/** El catálogo (liviano, para buscar y filtrar en la página), las últimas corridas y lo que está en curso. */
export async function GET() {
  return manejar(async () => {
    let e = revisarComfyui();
    let detalle: string | undefined;
    // Una ComfyUI completa sin la marca del final (carpeta propia con GEEPER_COMFYUI o la caché borrada):
    // leer el catálogo es lo que escribe la marca. Se prueba una vez por proceso antes de dar la
    // instalación por «a medias»; si falla, se ofrece reparar como antes (UX-06).
    if (e.falta === A_MEDIAS && !e.corriendo && g.__comfyAMediasProbada === undefined) {
      try {
        await leerCatalogo();
        e = { ...e, falta: null };
      } catch (x) {
        detalle = x instanceof Error ? x.message : String(x);
        g.__comfyAMediasProbada = detalle;
      }
    } else if (e.falta === A_MEDIAS) detalle = g.__comfyAMediasProbada;
    const comfy = { listo: !e.falta && !e.corriendo, falta: e.falta, instalando: e.corriendo, disponible: e.disponible, aMedias: e.falta === A_MEDIAS, ...(detalle ? { detalle } : {}) };
    if (!comfy.listo) return json({ comfy, workflows: [], corridas: [], trabajos: [] });
    let workflows: Awaited<ReturnType<typeof leerCatalogo>>["workflows"];
    try {
      ({ workflows } = await leerCatalogo());
    } catch (x) {
      // Sin catálogo no hay salida desde la página: se ofrece reparar la instalación en vez de un error (UX-06).
      const detalle = x instanceof Error ? x.message : String(x);
      return json({ comfy: { ...comfy, listo: false, falta: A_MEDIAS, aMedias: true, detalle }, workflows: [], corridas: [], trabajos: [] });
    }
    const trabajos = await db.trabajo.findMany({ where: { tipo: "workflow.correr", estado: { in: ["pendiente", "corriendo"] } }, select: { id: true, estado: true, etapa: true, progreso: true, payload: true } });
    // Para «Volver a intentar» una corrida que falló o se cortó (UX-30): el último trabajo que la corrió.
    const ultimos = await db.trabajo.findMany({ where: { tipo: "workflow.correr", estado: { in: [...REINTENTABLES] } }, orderBy: { creado: "desc" }, take: 100, select: { id: true, estado: true, payload: true } });
    const terminados = trabajoPorCorrida(ultimos);
    // Un trabajo cancelado a propósito no se muestra como un fallo (retoque de UX-30).
    const estadoDe = new Map(ultimos.map((t) => [t.id, t.estado]));
    return json({
      comfy,
      workflows: workflows.map((w) => ({
        id: w.id, titulo: w.titulo, descripcion: w.descripcion, categoria: w.categoria, tipo: w.tipo, etiquetas: w.etiquetas, modelos: w.modelos,
        tamano: w.tamano, local: w.local, bloqueo: bloqueo(w), aviso: aviso(w), comunidad: w.complementos.length > 0, entradas: w.entradas.length, uso: w.uso, fecha: w.fecha,
        // Las que se pueden ver en la tarjeta, en orden: si una no carga, la página prueba la siguiente (UX-25).
        miniaturas: w.miniaturas.filter((m) => tipoMiniatura(m) !== "audio").slice(0, 3).map((m) => `/api/workflows/archivo/${encodeURIComponent(m)}`),
      })),
      corridas: (await listarCorridas()).slice(0, 30).map((c) => ({ ...c, trabajo: terminados[c.id] ?? null, cancelada: c.estado !== "hecha" && estadoDe.get(terminados[c.id] ?? "") === "cancelado" })),
      trabajos: trabajos.map((t) => ({ id: t.id, estado: t.estado, etapa: t.etapa, progreso: t.progreso, corrida: (t.payload as { corrida?: string }).corrida ?? null, workflow: (t.payload as { pedido?: { workflow?: string } }).pedido?.workflow ?? null })),
    });
  });
}
