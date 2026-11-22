/**
 * Rutas de archivos que guarda una plantilla (SEG-02): el logo y los PSD de portada. Sólo valen si están
 * dentro de la carpeta de datos, en su carpeta propia y con su extensión; si no, cualquiera que llegue a
 * la API podría poner `/home/<persona>/.ssh/id_rsa` como «logo» y leerlo desde la vista previa.
 * Va aparte de plantillas.ts porque ese archivo lo importa también la UI (aquí se usa node:path).
 */
import path from "node:path";
import type { DatosPlantilla } from "./plantillas";
import { dirDatos } from "./rutas";

export const EXT_LOGO = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
export const EXT_PORTADA = new Set([".psd", ".psb", ".pcraft"]);

function dentro(base: string, ruta: string): boolean {
  if (!path.isAbsolute(ruta)) return false;
  const rel = path.relative(base, path.resolve(ruta));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** El logo sólo puede estar en <datos>/plantillas/ y ser una imagen (lo que sube el editor). */
export function logoPermitido(ruta: string, datos = dirDatos()): boolean {
  return dentro(path.join(datos, "plantillas"), ruta) && EXT_LOGO.has(path.extname(ruta).toLowerCase());
}

/** El diseño de portada propio sólo puede estar en <datos>/portadas/propias/ y ser un PSD (o .pcraft). */
export function portadaPermitida(ruta: string, datos = dirDatos()): boolean {
  return dentro(path.join(datos, "portadas", "propias"), ruta) && EXT_PORTADA.has(path.extname(ruta).toLowerCase());
}

/** Lanza un error claro si la plantilla trae un logo o una portada fuera de su carpeta. */
export function revisarRutasPlantilla(d: DatosPlantilla, datos = dirDatos()): void {
  if (d.marca.logo && !logoPermitido(d.marca.logo, datos)) {
    throw new Error("El logo tiene que subirse desde el editor de la plantilla (PNG, JPG, WebP o SVG).");
  }
  for (const ruta of Object.values(d.portada.plantillas)) {
    if (ruta && !portadaPermitida(ruta, datos)) {
      throw new Error("El diseño de portada tiene que subirse desde el editor de la plantilla (archivo .psd).");
    }
  }
}
