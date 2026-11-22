import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export async function sha256Archivo(ruta: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((ok, mal) => {
    createReadStream(ruta)
      .on("data", (d) => h.update(d))
      .on("end", () => ok())
      .on("error", mal);
  });
  return h.digest("hex");
}

export function sha256Texto(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

/** JSON estable (claves ordenadas) para calcular hashes reproducibles. */
export function jsonEstable(valor: unknown): string {
  return JSON.stringify(valor, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

export async function existe(ruta: string): Promise<boolean> {
  try {
    await fs.access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Ruta temporal hermana del destino (mismo sistema de archivos, así el rename es atómico). */
export function rutaTemporal(destino: string): string {
  const { dir, name, ext } = path.parse(destino);
  return path.join(dir, `.${name}.tmp-${randomBytes(4).toString("hex")}${ext}`);
}

/** Escribe con temporal + rename atómico: nunca queda un archivo a medias con el nombre final. */
export async function escribirAtomico(destino: string, contenido: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(destino), { recursive: true });
  const tmp = rutaTemporal(destino);
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(contenido);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, destino);
}

/** Resuelve una ruta relativa dentro de una base, rechazando escapes. */
export function dentroDe(base: string, relativa: string): string {
  const abs = path.resolve(base, relativa);
  const rel = path.relative(base, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Ruta fuera de ${base}: ${relativa}`);
  return abs;
}
