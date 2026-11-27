/**
 * Junta lo que necesita `recomendar` desde la base (proyecto, último render, trabajos, publicaciones).
 * Lo usan la ruta `/api/proyectos/<id>/asistente` y `scripts/recomendar.ts`.
 */
import { db } from "./db";
import { validarProyecto } from "./esquema";
import { obtenerPlantilla } from "./plantillas";
import { recomendar, type Recomendacion, type ReglaQcV } from "./recomendaciones";

export interface InformeAsistente {
  proyecto: { id: string; slug: string; nombre: string; version: number };
  recomendaciones: Recomendacion[];
}

export async function asistenteDe(where: { id: string } | { slug: string }): Promise<InformeAsistente | null> {
  const fila = await db.proyecto.findUnique({
    where,
    include: {
      renders: { orderBy: { creado: "desc" }, take: 1 },
      trabajos: { where: { estado: { in: ["pendiente", "corriendo"] } }, select: { id: true } },
      _count: { select: { publicaciones: true } },
    },
  });
  if (!fila) return null;
  const proyecto = { id: fila.id, slug: fila.slug, nombre: fila.nombre, version: fila.versionActual };
  if (fila.versionActual < 1) return { proyecto, recomendaciones: [] };
  const v = await db.version.findUniqueOrThrow({ where: { proyectoId_numero: { proyectoId: fila.id, numero: fila.versionActual } } });
  const p = validarProyecto(JSON.parse(v.json));
  const plantilla = await obtenerPlantilla(p.plantilla).catch(() => null);
  const r = fila.renders[0];
  const reglas = (r?.informeQc as { reglas?: ReglaQcV[] } | null)?.reglas;
  const recomendaciones = recomendar({
    p,
    tarjeta: plantilla?.datos.tarjetaFinal.duracion ?? 0,
    versionActual: fila.versionActual,
    render: r ? { versionNumero: r.versionNumero, estado: r.estado, reglas } : null,
    trabajosActivos: fila.trabajos.length,
    publicaciones: fila._count.publicaciones,
  });
  return { proyecto, recomendaciones };
}

export interface Siguiente {
  proyecto: InformeAsistente["proyecto"];
  recomendacion: Recomendacion;
  /** Cuántas cosas más hay en ese proyecto. */
  mas: number;
}

/**
 * «Lo siguiente» de Inicio: lo más importante de los proyectos tocados hace poco, uno por proyecto,
 * primero lo que bloquea. Las ideas no entran: aquí sólo va lo que conviene hacer.
 */
export async function siguientes(cuantos = 4, revisar = 8): Promise<Siguiente[]> {
  const filas = await db.proyecto.findMany({ where: { versionActual: { gt: 0 } }, orderBy: { actualizado: "desc" }, take: revisar, select: { id: true } });
  const out: Siguiente[] = [];
  for (const f of filas) {
    const inf = await asistenteDe({ id: f.id }).catch(() => null);
    const utiles = inf?.recomendaciones.filter((r) => r.prioridad !== "idea") ?? [];
    if (inf && utiles[0]) out.push({ proyecto: inf.proyecto, recomendacion: utiles[0], mas: utiles.length - 1 });
  }
  const peso = { bloquea: 0, mejora: 1, idea: 2 } as const;
  // Orden estable: dentro de la misma prioridad, el proyecto tocado más recientemente primero.
  return out.sort((a, b) => peso[a.recomendacion.prioridad] - peso[b.recomendacion.prioridad]).slice(0, cuantos);
}
