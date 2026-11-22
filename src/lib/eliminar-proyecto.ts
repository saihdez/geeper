/**
 * Eliminar un proyecto. No se borra nada del disco: la carpeta del proyecto pasa a la papelera
 * (`<datos>/papelera/<slug>-<fecha>`), de donde se puede recuperar a mano o borrar del todo. En la base
 * se borra la fila y, en cascada, sus versiones, assets, trabajos, renders y publicaciones.
 *
 * No se puede mientras tenga trabajos en la fila o corriendo (el worker escribiría en una carpeta que ya
 * no está): primero hay que esperarlos o cancelarlos.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { dirDatos, dirProyecto } from "./rutas";

export const dirPapelera = () => path.join(dirDatos(), "papelera");

/** Nombre en la papelera: el slug y la fecha (sin «:» para que sirva en Windows). */
export function nombreEnPapelera(slug: string, fecha = new Date()): string {
  return `${slug}-${fecha.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
}

export async function eliminarProyecto(id: string): Promise<{ nombre: string; papelera: string | null }> {
  const p = await db.proyecto.findUnique({ where: { id } });
  if (!p) throw new Error("Ese proyecto ya no existe");
  const activos = await db.trabajo.count({ where: { proyectoId: id, estado: { in: ["pendiente", "corriendo"] } } });
  if (activos) throw new Error(`«${p.nombre}» tiene ${activos === 1 ? "un trabajo" : `${activos} trabajos`} en curso: espera a que termine${activos === 1 ? "" : "n"} o cancéla${activos === 1 ? "lo" : "los"} en Trabajos y vuelve a intentarlo.`);
  const origen = dirProyecto(p.slug);
  let papelera: string | null = null;
  if (existsSync(origen)) {
    await fs.mkdir(dirPapelera(), { recursive: true });
    papelera = path.join(dirPapelera(), nombreEnPapelera(p.slug));
    // Mover primero: si falla, el proyecto queda como estaba (la fila sigue).
    await fs.rename(origen, papelera).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES") {
        throw new Error(`Hay un archivo de «${p.nombre}» abierto (en la vista previa, FilmCraft u otro programa): ciérralo y vuelve a intentarlo.`);
      }
      throw e;
    });
  }
  await db.proyecto.delete({ where: { id } });
  return { nombre: p.nombre, papelera };
}
