/**
 * VectorCraft (github.com/storytold/vectorcraft, MIT o Apache 2.0) como conversor sin ventana:
 *  - `aSvg`: un logo de Illustrator, PDF, EPS, Affinity, DXF o EMF pasa a SVG con el texto como
 *    contornos (no depende de las fuentes instaladas). Toma la primera mesa de trabajo.
 *  - `vectorizar`: un PNG/JPG/WebP (un logo plano, no una foto) pasa a trazos con Image Trace.
 * Siempre con `--safe-mode` (sin plug-ins) y en una carpeta temporal; lo que sale pasa por `revisarSvg`.
 * Medido en esta PC (2026-11-19): ~10 ms por archivo.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { correr } from "./proceso";
import { VECTORCRAFT_CLI, VECTORCRAFT_VERSION } from "./rutas";
import { esVector } from "./formatos-vector";
import { revisarSvg } from "./svg";

export { esVector } from "./formatos-vector";

const FALTA =
  "Para usar archivos de Illustrator, PDF, EPS o Affinity hace falta VectorCraft: instálalo en Sistema con «Instalar con un clic». O exporta el logo como SVG o PNG desde tu programa de diseño.";

export async function versionVectorcraft(): Promise<string | null> {
  try {
    const r = await correr(VECTORCRAFT_CLI, ["--version"], { permitirFallo: true, timeout: 20_000 });
    return r.codigo === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

async function exigirInstalado(): Promise<void> {
  if (!(await versionVectorcraft())?.includes(VECTORCRAFT_VERSION)) throw new Error(FALTA);
}

/** Corre la CLI en una carpeta temporal con la entrada copiada; devuelve el SVG que dejó en `salida.svg`. */
async function enTemporal(entrada: Buffer, ext: string, args: (dentro: string, fuera: string) => string[]): Promise<{ svg: Buffer; avisos: string[] }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-vc-"));
  try {
    const dentro = path.join(tmp, `entrada${ext}`);
    const fuera = path.join(tmp, "salida.svg");
    await fs.writeFile(dentro, entrada);
    const r = await correr(VECTORCRAFT_CLI, ["--safe-mode", ...args(dentro, fuera)], { cwd: tmp, permitirFallo: true, timeout: 120_000 });
    const svg = await fs.readFile(fuera).catch(() => null);
    if (r.codigo !== 0 || !svg) {
      const motivo = (r.stderr || r.stdout).trim().split("\n").pop()?.replace(/^vectorcraft-cli:\s*/, "").slice(0, 200);
      throw new Error(`No se pudo convertir el archivo${motivo ? ` (${motivo})` : ""}. Prueba exportarlo como SVG o PNG desde tu programa de diseño.`);
    }
    // Una línea JSON por paso; los avisos (fuentes que faltan, lo que no se pudo leer) se pasan a la persona.
    const avisos = r.stdout.split("\n").flatMap((l) => {
      try {
        const j = JSON.parse(l) as { warnings?: string[]; importWarnings?: string[]; result?: { warnings?: string[] } };
        return [...(j.warnings ?? []), ...(j.importWarnings ?? []), ...(j.result?.warnings ?? [])];
      } catch {
        return [];
      }
    });
    revisarSvg(svg.toString("utf8"));
    return { svg, avisos };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Logo vectorial (.ai, .pdf, .eps, Affinity…) → SVG con texto en contornos. */
export async function aSvg(entrada: Buffer, nombre: string): Promise<{ svg: Buffer; avisos: string[] }> {
  const ext = path.extname(nombre).toLowerCase();
  if (!esVector(nombre)) throw new Error(`${ext || "Ese archivo"} no es un formato vectorial que se pueda convertir`);
  await exigirInstalado();
  return enTemporal(entrada, ext, (dentro, fuera) => ["convert", dentro, fuera, "--outline-text"]);
}

/**
 * Imagen plana (logo, ícono) → SVG con Image Trace. Una foto da miles de trazos: no sirve para eso.
 * «Flat Logo» conserva los colores planos del logo («Default» de VectorCraft es blanco y negro).
 */
export async function vectorizar(entrada: Buffer, nombre: string, preset = "Flat Logo"): Promise<{ svg: Buffer; avisos: string[] }> {
  const ext = path.extname(nombre).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error("Sólo se vectoriza una imagen PNG, JPG o WebP");
  await exigirInstalado();
  return enTemporal(entrada, ext, (dentro, fuera) => [
    "run", "--in", dentro, "--cmd", "select.all",
    "--cmd", "imageTrace.makeAndExpand", "--params", JSON.stringify({ preset }),
    "--export", fuera,
  ]);
}
