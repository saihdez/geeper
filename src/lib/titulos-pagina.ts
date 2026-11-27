/** Títulos de pestaña de las páginas que dependen de un registro (proyecto, campaña). */
import { db } from "./db";

/** El nombre a mostrar en la pestaña; si no existe o la base falla, uno genérico (nunca rompe la página). */
export async function tituloDe(tipo: "proyecto" | "campana", id: string): Promise<string> {
  const generico = tipo === "proyecto" ? "Video" : "Anuncio";
  try {
    const fila = tipo === "proyecto"
      ? await db.proyecto.findUnique({ where: { id }, select: { nombre: true } })
      : await db.campana.findUnique({ where: { id }, select: { nombre: true } });
    const nombre = fila?.nombre.trim();
    return nombre ? nombre.slice(0, 60) : generico;
  } catch {
    return generico;
  }
}
