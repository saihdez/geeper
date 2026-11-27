/**
 * Paleta de una imagen del disco (logo, foto de producto, captura): ffmpeg la reduce a como mucho
 * 128×128 píxeles RGBA y `paleta()` (median cut, de DesignCraft) saca hasta 5 colores. Lee PNG, JPEG,
 * WebP, GIF y SVG (librsvg de ffmpeg); de un video toma el primer fotograma.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { muestrasRgba, paleta, proponerRoles, type ColorPaleta, type Roles } from "./colores-marca";
import { ffmpeg } from "./media";

export async function paletaDeArchivo(ruta: string): Promise<{ colores: ColorPaleta[]; roles: Roles }> {
  const salida = path.join(os.tmpdir(), `geeper-paleta-${randomUUID()}.rgba`);
  try {
    await ffmpeg([
      "-v", "error", "-i", ruta, "-frames:v", "1",
      "-vf", "scale='min(128,iw)':'min(128,ih)':force_original_aspect_ratio=decrease:flags=area,format=rgba",
      "-f", "rawvideo", "-pix_fmt", "rgba", salida,
    ]);
    const colores = paleta(muestrasRgba(new Uint8Array(await fs.readFile(salida))));
    if (!colores.length) throw new Error("La imagen no tiene píxeles visibles");
    return { colores, roles: proponerRoles(colores) };
  } catch (e) {
    if (e instanceof Error && e.message.includes("píxeles visibles")) throw e;
    throw new Error("No se pudo leer la imagen. Prueba con un PNG, JPG, WebP o SVG.");
  } finally {
    await fs.rm(salida, { force: true });
  }
}
