/**
 * Digests OCI de las imágenes Docker de MoneyPrinterTurbo (D3 de docs/STACK-AGENTICO.md, Q5 de BRECHAS).
 *
 * MPT usa tags móviles (`ollama/ollama:latest`, `kokoro-fastapi-cpu:latest`): un `docker compose pull`
 * puede cambiar el modelo o el motor por debajo sin que nada en Geeper lo note. El doctor lee el digest
 * de la imagen de cada contenedor, lo guarda en `~/geeper-data/imagenes.json` y avisa si cambió desde la
 * última vez. El importador anota los digests conocidos en cada asset de MPT y el SBOM los incluye.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { escribirAtomico } from "./archivos";
import { correr } from "./proceso";
import { dirDatos } from "./rutas";

export const CONTENEDORES_MPT = ["moneyprinterturbo-api", "moneyprinterturbo-webui", "mpt-ollama", "mpt-kokoro", "mpt-image-server"] as const;

export interface ImagenContenedor {
  contenedor: string;
  /** Nombre con tag, tal como lo pide el compose. */
  imagen: string;
  /** sha256 del manifiesto en el registro (RepoDigests); null si la imagen se construyó en local. */
  digest: string | null;
  /** Id de la imagen local (sha256 de su configuración): cambia con cualquier reconstrucción. */
  id: string;
}

export interface RegistroImagenes {
  revisado: string;
  imagenes: Record<string, ImagenContenedor>;
}

const rutaRegistro = () => path.join(dirDatos(), "imagenes.json");

/** Lee el registro guardado (o null). No llama a Docker. */
export async function imagenesConocidas(): Promise<RegistroImagenes | null> {
  try {
    return JSON.parse(await fs.readFile(rutaRegistro(), "utf8")) as RegistroImagenes;
  } catch {
    return null;
  }
}

/** `contenedor → digest o id` de lo que se vio la última vez, para la procedencia de un asset de MPT. */
export async function huellaImagenesMpt(): Promise<Record<string, string> | null> {
  const r = await imagenesConocidas();
  if (!r) return null;
  return Object.fromEntries(Object.values(r.imagenes).map((i) => [i.contenedor, i.digest ?? i.id]));
}

type Ejecutor = (args: string[]) => Promise<{ codigo: number; stdout: string; stderr: string }>;
const docker: Ejecutor = (args) => correr("docker", args, { permitirFallo: true, timeout: 20_000 });

/** Pregunta a Docker por la imagen de cada contenedor de MPT. null si Docker no responde. */
export async function leerImagenes(ejecutar: Ejecutor = docker): Promise<Record<string, ImagenContenedor> | null> {
  const r = await ejecutar(["inspect", "--format", "{{.Name}}\t{{.Config.Image}}\t{{.Image}}", ...CONTENEDORES_MPT]);
  // inspect sale con 1 si falta alguno, pero imprime los que sí existen.
  if (!r.stdout.trim()) return r.codigo === 0 || /No such/i.test(r.stderr) ? {} : null;
  const salida: Record<string, ImagenContenedor> = {};
  for (const linea of r.stdout.trim().split("\n")) {
    const [nombre, imagen, id] = linea.split("\t");
    if (!nombre || !imagen || !id) continue;
    const contenedor = nombre.replace(/^\//, "");
    const repo = await ejecutar(["image", "inspect", "--format", "{{json .RepoDigests}}", id]);
    let digests: string[] = [];
    try {
      digests = JSON.parse(repo.stdout.trim() || "[]") as string[];
    } catch {
      /* sin digests */
    }
    const base = imagen.replace(/:[^/:]+$/, "");
    const propio = digests.find((d) => d.startsWith(`${base}@`)) ?? digests[0] ?? null;
    salida[contenedor] = { contenedor, imagen, digest: propio ? propio.slice(propio.indexOf("@") + 1) : null, id };
  }
  return salida;
}

export interface CambioImagen {
  contenedor: string;
  antes: string;
  ahora: string;
}

/** Qué cambió entre dos lecturas (función pura): digest si hay, si no el id local. */
export function compararImagenes(antes: Record<string, ImagenContenedor>, ahora: Record<string, ImagenContenedor>): CambioImagen[] {
  const huella = (i: ImagenContenedor) => i.digest ?? i.id;
  return Object.values(ahora)
    .filter((i) => antes[i.contenedor] && huella(antes[i.contenedor]!) !== huella(i))
    .map((i) => ({ contenedor: i.contenedor, antes: huella(antes[i.contenedor]!), ahora: huella(i) }));
}

/**
 * Lee las imágenes, las compara con el registro y guarda la lectura nueva. Lo usa el doctor.
 * Devuelve null si Docker no responde (no se toca el registro).
 */
export async function revisarImagenes(ejecutar?: Ejecutor): Promise<{ actuales: Record<string, ImagenContenedor>; cambios: CambioImagen[]; primeraVez: boolean } | null> {
  const actuales = await leerImagenes(ejecutar);
  if (!actuales) return null;
  const previo = await imagenesConocidas();
  const cambios = previo ? compararImagenes(previo.imagenes, actuales) : [];
  if (Object.keys(actuales).length) {
    // Se conservan los contenedores que hoy no están (detenidos o borrados) con su última huella.
    const imagenes = { ...(previo?.imagenes ?? {}), ...actuales };
    await escribirAtomico(rutaRegistro(), `${JSON.stringify({ revisado: new Date().toISOString(), imagenes }, null, 2)}\n`);
  }
  return { actuales, cambios, primeraVez: !previo };
}
