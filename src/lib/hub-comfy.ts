/**
 * Las recetas del hub de Comfy (comfy.org/hub/workflows) que el paquete de pip no trae. El paquete
 * `comfyui-workflow-templates` deja fuera las que usan código de la comunidad y las que son sólo de la
 * nube (0.11.114: 693 de 776). El dueño pidió todas: se lee el índice del repositorio oficial
 * (Comfy-Org/workflow_templates, MIT) en el **mismo commit** que la versión del paquete instalada, se bajan
 * los .json de las recetas que faltan (~9 MB) y sus miniaturas y ejemplos se bajan la primera vez que se
 * piden (los ejemplos pesan ~560 MB en total). Todo va a `<ComfyUI>/geeper-hub/<commit>/`.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { CategoriaIndice, EntradaIndice } from "./comfyui";
import recetasEs from "./recetas-es.json";

/** Commit del repo de plantillas que corresponde a comfyui-workflow-templates 0.11.114 (bump en f77d47c). */
export const HUB_COMMIT = "f77d47c355f9a6a0bec0e129b78b194a92d8d65b";
export const VERSION_PLANTILLAS = "0.11.114";
export const urlHub = (ruta: string, commit = HUB_COMMIT) => `https://raw.githubusercontent.com/Comfy-Org/workflow_templates/${commit}/${ruta}`;
export const dirHub = (dir: string) => path.join(dir, "geeper-hub", HUB_COMMIT.slice(0, 12));
/** Prefijo de los archivos que todavía no están en disco: se bajan al pedirlos (`resolverArchivo`). */
export const PREFIJO_HUB = "hub:";

/** Archivos de una receta del repo (ruta en el repo): su .json, sus miniaturas y sus ejemplos (función pura). */
export function archivosDeReceta(t: EntradaIndice): { nombre: string; repo: string }[] {
  const out = [{ nombre: `${t.name}.json`, repo: `templates/${t.name}.json` }];
  // Sus miniaturas (en el repo, a menudo en thumbnail/) y la estándar `<nombre>-1.webp`, que casi todas tienen.
  const miniaturas = [...(t.thumbnail ?? []), `templates/${t.name}-1.webp`];
  for (const m of miniaturas) out.push({ nombre: path.posix.basename(m), repo: m.includes("/") ? m : `templates/${m}` });
  for (const e of t.io?.inputs ?? []) if (e.file) out.push({ nombre: e.file, repo: `input/${e.file}` });
  return out.filter((x) => /^[\w.() -]+$/.test(x.nombre) && !x.repo.includes(".."));
}

/**
 * Une el índice del paquete con el del hub (función pura): el del hub manda (es el mismo commit, con más
 * recetas); los archivos del paquete se conservan y los que faltan apuntan al hub (bajados o por bajar).
 */
export function unirHub(archivosPip: Record<string, string>, indiceHub: CategoriaIndice[], local: (repo: string) => string, existe: (ruta: string) => boolean) {
  const archivos = { ...archivosPip };
  const pip = new Set(Object.keys(archivosPip));
  const extra: string[] = [];
  for (const c of indiceHub) {
    for (const t of c.templates ?? []) {
      if (!t.name) continue;
      // El paquete tampoco trae los ejemplos de entrada de ninguna receta: también salen del repo.
      if (!pip.has(`${t.name}.json`)) extra.push(t.name);
      for (const a of archivosDeReceta(t)) {
        if (archivos[a.nombre]) continue;
        const ruta = local(a.repo);
        archivos[a.nombre] = existe(ruta) ? ruta : `${PREFIJO_HUB}${a.repo}`;
      }
    }
  }
  return { indice: indiceHub, archivos, extra };
}

async function bajarA(url: string, destino: string) {
  const r = await fetch(url, { headers: { "user-agent": "geeper" } });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} (${path.basename(destino)})`);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(`${destino}.part`, Buffer.from(await r.arrayBuffer()));
  await fs.rename(`${destino}.part`, destino);
}

/** Baja el índice del hub y los .json de las recetas que el paquete no trae. Devuelve el índice. */
export async function bajarHub(dir: string, archivosPip: Record<string, string>, log?: (l: string) => void): Promise<CategoriaIndice[]> {
  const base = dirHub(dir);
  const ruta = path.join(base, "templates", "index.json");
  if (!existsSync(ruta)) await bajarA(urlHub("templates/index.json"), ruta);
  const indice = JSON.parse(await fs.readFile(ruta, "utf8")) as CategoriaIndice[];
  const faltan = indice.flatMap((c) => c.templates ?? []).filter((t) => t.name && !archivosPip[`${t.name}.json`] && /^[\w.-]+$/.test(t.name) && !existsSync(path.join(base, "templates", `${t.name}.json`)));
  if (faltan.length) log?.(`Bajando ${faltan.length} recetas del hub que no vienen en el paquete…`);
  for (let i = 0; i < faltan.length; i += 8) {
    await Promise.all(faltan.slice(i, i + 8).map((t) => bajarA(urlHub(`templates/${t.name}.json`), path.join(base, "templates", `${t.name}.json`))));
  }
  return indice;
}

/** La ruta en disco de un archivo del catálogo; si es del hub y no está, lo baja (sólo rutas del repo fijado). */
export async function resolverArchivo(dir: string, ruta: string): Promise<string> {
  if (!ruta.startsWith(PREFIJO_HUB)) return ruta;
  const repo = ruta.slice(PREFIJO_HUB.length);
  if (!/^(templates|input|output|thumbnail)\/[\w.() -]+$/.test(repo)) throw new Error("Archivo del hub inválido");
  const destino = path.join(dirHub(dir), repo);
  if (!existsSync(destino)) await bajarA(urlHub(repo), destino);
  return destino;
}

/** Título y descripción en español de una receta, y el título en inglés del que salió. */
export interface RecetaEs { en: string; titulo: string; descripcion: string }

/**
 * Traducciones de las recetas del hub (UX-36), hechas una vez para el commit fijado (HUB_COMMIT) con
 * Nemotron y revisadas; donde la traducción salió mal se usó la española del mismo repositorio
 * (templates/index.es.json, MIT). Clave = id de la receta.
 */
export const RECETAS_ES: Record<string, RecetaEs> = recetasEs;

/**
 * La receta con el título y la descripción en español (función pura). `original` es el título en
 * inglés, para mostrarlo debajo y poder buscarlo; null si no se tradujo. Una receta nueva, o una cuyo
 * título cambió desde que se tradujo, queda como viene.
 */
export function traducirReceta<T extends { id: string; titulo: string; descripcion: string }>(w: T, tr: Record<string, RecetaEs> = RECETAS_ES): T & { original: string | null } {
  const es = Object.hasOwn(tr, w.id) ? tr[w.id] : undefined;
  if (!es || es.en.trim() !== w.titulo.trim()) return { ...w, original: null };
  const titulo = es.titulo.trim() || w.titulo;
  return { ...w, titulo, descripcion: es.descripcion.trim() || w.descripcion, original: titulo === w.titulo ? null : w.titulo };
}
