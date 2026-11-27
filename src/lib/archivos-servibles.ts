/**
 * Qué puede servir /api/archivos (SEG-01). Lista blanca: sólo lo que cuelga de la carpeta de un proyecto
 * (la que tiene geeper.json) o de las carpetas de medios conocidas. Nada suelto en la raíz de los datos,
 * nunca claves/ ni respaldos/, ni la base (geeper.db, -wal, -shm, .respaldo…), ni llaves (.key, .pem),
 * ni nada con un punto delante (temporales, carpetas ocultas).
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Carpetas de medios de la raíz de datos que la UI muestra (imágenes, audio, video, vistas previas). */
export const CARPETAS_MEDIOS = new Set([
  "_fuentes", // material de los clips (videos y candidatos)
  "_subidos", // videos subidos para sacar clips
  "anuncios",
  "avatares",
  "color",
  "efectos",
  "plantillas", // logos de las plantillas
  "portadas",
  "voces",
  "workflows",
]);

const NUNCA = new Set(["claves", "respaldos"]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Nombre prohibido en cualquier nivel: la base y sus restos, llaves y cosas ocultas. */
export function nombreProhibido(nombre: string): boolean {
  const n = nombre.toLowerCase();
  return n.startsWith(".") || /\.db($|[-.])/.test(n) || /\.(key|pem)$/.test(n);
}

/**
 * Decide si `rel` (relativa a la carpeta de datos, ya sin «..») se puede servir. Mira el disco para
 * saber si la primera carpeta es un proyecto (tiene geeper.json).
 */
export async function servible(base: string, rel: string): Promise<boolean> {
  const partes = rel.split(/[\\/]+/).filter(Boolean);
  if (partes.length < 2) return false; // nada suelto en la raíz
  if (partes.some(nombreProhibido)) return false;
  const [primera] = partes as [string];
  const p = primera.toLowerCase();
  if (NUNCA.has(p)) return false;
  if (CARPETAS_MEDIOS.has(primera)) return true;
  if (!SLUG.test(primera)) return false;
  try {
    return (await fs.stat(path.join(base, primera, "geeper.json"))).isFile();
  } catch {
    return false;
  }
}
