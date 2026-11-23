/**
 * «Liberar espacio» (UX-33, decisión 4 b de la auditoría): cuánto ocupa cada cosa y qué se puede borrar.
 *
 * Se conserva siempre, de cada proyecto y formato, el último video y el último aprobado, y todo video que
 * tenga una publicación (publicar exige su ruta y su huella). Lo demás se puede borrar cuando tiene más de
 * 30 días: los videos viejos, los crudos del render (se rehacen al renderizar) y lo que lleva 30 días en la
 * papelera. Nada se borra solo: sólo con `liberar()`, que llama la pantalla Sistema después de que la
 * persona confirma. No toca un proyecto con trabajos en la fila o corriendo.
 *
 * DSC-11, lo que queda fuera de los proyectos:
 * - Videos largos para sacar clips (los bajados en `_fuentes/<id>/fuente.mp4` y los subidos en
 *   `_subidos/`) que nadie usó en 30 días y que ningún trabajo pendiente nombra. Cada clip ya creado
 *   guarda su tramo en el proyecto (`assets/tramo.mp4`): sólo se pierde sacar más clips sin volver a
 *   bajar o subir el video. Se quedan la ficha y los momentos encontrados. También las subidas y
 *   bajadas cortadas (`.subiendo-*`, `.fuente.*`) de hace más de un día.
 * - Copias repetidas de la IA: el video de Wan2GP que quedó en `build/planos/` y ya está copiado en
 *   `assets/wan-<huella>` del proyecto, y lo que ComfyUI dejó en su carpeta `output/` y ya está copiado
 *   en el resultado de su receta (mismo nombre y misma huella). Son copias idénticas: no esperan 30 días.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { dirPapelera } from "./eliminar-proyecto";
import { sha256Archivo } from "./archivos";
import { COMFYUI_DIR, dirResultados } from "./comfyui";
import { espacioLibre, type MedidaDisco } from "./espacio";
import { dirFuentes, idFuente } from "./fuentes";
import { dirDatos, dirProyecto } from "./rutas";

/** Días que se guarda lo que se puede borrar (decisión del dueño). */
export const DIAS_GUARDAR = 30;
const DIA = 86_400_000;

export type QueLiberar = "renders" | "crudos" | "papelera" | "fuentes" | "copias";

export interface EspacioProyecto {
  id: string;
  nombre: string;
  /** Todo lo que ocupa la carpeta del proyecto. */
  total: number;
  /** Los videos terminados (renders/). */
  videos: number;
  /** Los crudos del render (build/crudo-*.mp4). */
  crudos: number;
}

export interface Borrable { cuantos: number; bytes: number }

export interface Espacio {
  proyectos: EspacioProyecto[];
  papelera: { total: number; elementos: { nombre: string; bytes: number; dias: number }[] };
  /** Lo que se puede borrar hoy con confirmación, por tipo. */
  borrable: Record<QueLiberar, Borrable>;
  dias: number;
  /** Lo libre donde están los datos (DSC-05); en WSL, lo de C: si es menos (DSC-06). Null si no se pudo medir. */
  disco: MedidaDisco | null;
}

/** Bytes de un archivo o carpeta, sin seguir enlaces simbólicos. */
export async function tamano(ruta: string): Promise<number> {
  const st = await fs.lstat(ruta).catch(() => null);
  if (!st) return 0;
  if (!st.isDirectory()) return st.isSymbolicLink() ? 0 : st.size;
  const hijos = await fs.readdir(ruta).catch(() => [] as string[]);
  let n = 0;
  for (const h of hijos) n += await tamano(path.join(ruta, h));
  return n;
}

/** Fecha en que algo entró a la papelera: la del nombre (`<slug>-AAAA-MM-DD-hh-mm-ss`) o, si no, la del archivo. */
export function fechaEnPapelera(nombre: string, respaldo: Date): Date {
  const m = /-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(nombre);
  if (!m) return respaldo;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(d.getTime()) ? respaldo : d;
}

interface RenderFila { id: string; perfil: string; ruta: string; estado: string; creado: Date }

/**
 * De los renders de un proyecto, los que se pueden borrar: no son el último ni el último aprobado de su
 * formato, no tienen publicación, tienen más de `dias` días y no comparten archivo con uno que se guarda.
 */
export function rendersBorrables(renders: RenderFila[], conPublicacion: Set<string>, ahora: Date, dias = DIAS_GUARDAR): RenderFila[] {
  const guardar = new Set<string>();
  const orden = [...renders].sort((a, b) => b.creado.getTime() - a.creado.getTime());
  const vistos = new Set<string>();
  const aprobados = new Set<string>();
  for (const r of orden) {
    if (!vistos.has(r.perfil)) { vistos.add(r.perfil); guardar.add(r.id); }
    if (r.estado === "aprobado" && !aprobados.has(r.perfil)) { aprobados.add(r.perfil); guardar.add(r.id); }
    if (conPublicacion.has(r.id)) guardar.add(r.id);
    if (ahora.getTime() - r.creado.getTime() < dias * DIA) guardar.add(r.id);
  }
  const rutasGuardadas = new Set(renders.filter((r) => guardar.has(r.id)).map((r) => r.ruta));
  return renders.filter((r) => !guardar.has(r.id) && !rutasGuardadas.has(r.ruta));
}

/** Archivos de un render en renders/: el MP4, sus subtítulos, el informe, la carpeta de la hoja de contacto y el máster. */
async function archivosDeRender(dir: string, ruta: string): Promise<string[]> {
  const abs = path.resolve(dir, ruta);
  const carpeta = path.join(dir, "renders");
  if (path.dirname(abs) !== carpeta || !abs.endsWith(".mp4")) return [];
  const base = path.basename(abs, ".mp4");
  const nombres = await fs.readdir(carpeta).catch(() => [] as string[]);
  return nombres.filter((n) => n === `${base}.mp4` || n.startsWith(`${base}.`) || n.startsWith(`${base}-`)).map((n) => path.join(carpeta, n));
}

async function crudosViejos(dir: string, ahora: Date, dias: number): Promise<string[]> {
  const build = path.join(dir, "build");
  const nombres = await fs.readdir(build).catch(() => [] as string[]);
  const out: string[] = [];
  for (const n of nombres) {
    if (!/^crudo-.+\.mp4$/.test(n)) continue;
    const st = await fs.lstat(path.join(build, n)).catch(() => null);
    if (st?.isFile() && ahora.getTime() - st.mtime.getTime() >= dias * DIA) out.push(path.join(build, n));
  }
  return out;
}

async function enPapelera(ahora: Date): Promise<{ ruta: string; nombre: string; dias: number }[]> {
  const dir = dirPapelera();
  const nombres = await fs.readdir(dir).catch(() => [] as string[]);
  const out: { ruta: string; nombre: string; dias: number }[] = [];
  for (const n of nombres) {
    const ruta = path.join(dir, n);
    const st = await fs.lstat(ruta).catch(() => null);
    if (!st) continue;
    const d = Math.floor((ahora.getTime() - fechaEnPapelera(n, st.mtime).getTime()) / DIA);
    out.push({ ruta, nombre: n, dias: d });
  }
  return out;
}

async function proyectosLibres() {
  const ps = await db.proyecto.findMany({ select: { id: true, nombre: true, slug: true }, orderBy: { creado: "asc" } });
  const ocupados = new Set(
    (await db.trabajo.findMany({ where: { estado: { in: ["pendiente", "corriendo"] }, proyectoId: { not: null } }, select: { proyectoId: true } }))
      .map((t) => t.proyectoId!),
  );
  return { ps, ocupados };
}

/**
 * Lo que nombran los trabajos en la fila o corriendo (rutas, ids de fuentes y de recetas). Con `recientes`,
 * también los creados en los últimos `dias` días en cualquier estado (DSC-11): sacar un clip sólo lee
 * fuente.mp4 y no cambia ninguna fecha del archivo, así que un video del que se sacaron clips ayer no es
 * un video «sin usar», aunque se haya bajado hace 40 días.
 */
export async function enUso(recientes?: { ahora: Date; dias: number }): Promise<string> {
  const activos = { estado: { in: ["pendiente", "corriendo"] } };
  const where = recientes ? { OR: [activos, { creado: { gte: new Date(recientes.ahora.getTime() - recientes.dias * DIA) } }] } : activos;
  const ts = await db.trabajo.findMany({ where, select: { payload: true } });
  return ts.map((t) => JSON.stringify(t.payload ?? null)).join("\n");
}

/** Última vez que se tocó algo directamente dentro de una carpeta (0 si no existe). Sin los temporales (`.…`). */
async function ultimoUso(dir: string): Promise<number> {
  const nombres = await fs.readdir(dir).catch(() => [] as string[]);
  let t = 0;
  for (const n of nombres) {
    if (n.startsWith(".")) continue;
    const st = await fs.lstat(path.join(dir, n)).catch(() => null);
    if (st) t = Math.max(t, st.mtimeMs);
  }
  return t;
}

const UN_DIA = DIA;

/** Videos largos para sacar clips que se pueden borrar (DSC-11). */
async function fuentesViejas(ahora: Date, dias: number, usado: string): Promise<string[]> {
  const out: string[] = [];
  const viejo = (t: number, d: number) => ahora.getTime() - t >= d;
  const base = dirFuentes();
  for (const id of await fs.readdir(base).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{12}$/.test(id) || usado.includes(id)) continue;
    const dir = path.join(base, id);
    const nombres = await fs.readdir(dir).catch(() => [] as string[]);
    for (const n of nombres.filter((x) => x.startsWith(".fuente."))) {
      const st = await fs.lstat(path.join(dir, n)).catch(() => null);
      if (st?.isFile() && viejo(st.mtimeMs, UN_DIA)) out.push(path.join(dir, n));
    }
    const video = path.join(dir, "fuente.mp4");
    const st = await fs.lstat(video).catch(() => null);
    if (st?.isFile() && viejo(await ultimoUso(dir), dias * DIA)) out.push(video);
  }
  const subidos = path.join(dirDatos(), "_subidos");
  for (const n of await fs.readdir(subidos).catch(() => [] as string[])) {
    const ruta = path.join(subidos, n);
    const st = await fs.lstat(ruta).catch(() => null);
    if (!st?.isFile() || usado.includes(ruta)) continue;
    if (n.startsWith(".subiendo-")) {
      if (viejo(st.mtimeMs, UN_DIA)) out.push(ruta);
      continue;
    }
    const id = idFuente(ruta);
    if (usado.includes(id)) continue;
    if (viejo(Math.max(st.mtimeMs, await ultimoUso(path.join(base, id))), dias * DIA)) out.push(ruta);
  }
  return out;
}

const VIDEO_IA = /\.(mp4|webm|mkv|mov)$/i;

/** Archivos de una carpeta y sus subcarpetas (hasta `hondo` niveles), sin seguir enlaces. */
async function archivosDe(dir: string, hondo = 4): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const r = path.join(dir, e.name);
    if (e.isFile()) out.push(r);
    else if (e.isDirectory() && hondo > 0) out.push(...(await archivosDe(r, hondo - 1)));
  }
  return out;
}

/**
 * Videos de Wan2GP en build/planos/ que ya están copiados en assets/ (misma huella). La huella (leer todo
 * el video) sólo se calcula si el tamaño coincide con el de algún `assets/wan-*`: Sistema mide esto en
 * cada visita (DSC-11).
 */
async function planosRepetidos(dir: string): Promise<string[]> {
  const out: string[] = [];
  const nombres = await fs.readdir(path.join(dir, "assets")).catch(() => [] as string[]);
  const assets = new Set(nombres);
  const tamanos = new Set<number>();
  for (const n of nombres.filter((x) => x.startsWith("wan-"))) {
    const st = await fs.lstat(path.join(dir, "assets", n)).catch(() => null);
    if (st?.isFile()) tamanos.add(st.size);
  }
  if (!tamanos.size) return out;
  for (const f of (await archivosDe(path.join(dir, "build", "planos"))).filter((x) => VIDEO_IA.test(x))) {
    const st = await fs.lstat(f).catch(() => null);
    if (!st || !tamanos.has(st.size)) continue;
    const h = (await sha256Archivo(f).catch(() => "")).slice(0, 12);
    if (h && assets.has(`wan-${h}${path.extname(f).toLowerCase()}`)) out.push(f);
  }
  return out;
}

/** Lo que ComfyUI dejó en output/ y ya está copiado en el resultado de su receta (mismo nombre y huella). */
async function comfyRepetidos(usado: string): Promise<string[]> {
  const salidas = await archivosDe(path.join(COMFYUI_DIR, "output"));
  if (!salidas.length) return [];
  const porNombre = new Map<string, string[]>();
  for (const s of salidas) porNombre.set(path.basename(s), [...(porNombre.get(path.basename(s)) ?? []), s]);
  const out = new Set<string>();
  for (const id of await fs.readdir(dirResultados()).catch(() => [] as string[])) {
    if (usado.includes(id)) continue;
    const corrida = path.join(dirResultados(), id);
    for (const n of await fs.readdir(corrida).catch(() => [] as string[])) {
      if (n === "corrida.json") continue;
      const copia = path.join(corrida, n);
      const st = await fs.lstat(copia).catch(() => null);
      if (!st?.isFile()) continue;
      for (const o of porNombre.get(n) ?? []) {
        const so = await fs.lstat(o).catch(() => null);
        if (so?.size === st.size && (await sha256Archivo(o)) === (await sha256Archivo(copia))) out.add(o);
      }
    }
  }
  return [...out];
}

/** Qué se borraría de cada proyecto (sin borrar nada). */
async function candidatos(ahora: Date, dias: number) {
  const { ps, ocupados } = await proyectosLibres();
  const publicados = new Set((await db.publicacion.findMany({ select: { renderId: true } })).map((x) => x.renderId));
  const renders: { proyectoId: string; renderIds: string[]; archivos: string[] }[] = [];
  const crudos: { proyectoId: string; archivos: string[] }[] = [];
  const copias: { proyectoId: string | null; archivos: string[] }[] = [];
  for (const p of ps) {
    if (ocupados.has(p.id)) continue;
    const dir = dirProyecto(p.slug);
    if (!existsSync(dir)) continue;
    const filas = await db.render.findMany({ where: { proyectoId: p.id }, select: { id: true, perfil: true, ruta: true, estado: true, creado: true } });
    const viejos = rendersBorrables(filas, publicados, ahora, dias);
    if (viejos.length) {
      const archivos = [...new Set((await Promise.all(viejos.map((r) => archivosDeRender(dir, r.ruta)))).flat())];
      renders.push({ proyectoId: p.id, renderIds: viejos.map((r) => r.id), archivos });
    }
    const cs = await crudosViejos(dir, ahora, dias);
    if (cs.length) crudos.push({ proyectoId: p.id, archivos: cs });
    const planos = await planosRepetidos(dir);
    if (planos.length) copias.push({ proyectoId: p.id, archivos: planos });
  }
  const papelera = (await enPapelera(ahora)).filter((x) => x.dias >= dias);
  const usado = await enUso();
  const comfy = await comfyRepetidos(usado);
  if (comfy.length) copias.push({ proyectoId: null, archivos: comfy });
  const fuentes = await fuentesViejas(ahora, dias, await enUso({ ahora, dias }));
  return { renders, crudos, papelera, fuentes, copias };
}

async function sumar(rutas: string[]): Promise<number> {
  let n = 0;
  for (const r of rutas) n += await tamano(r);
  return n;
}

/** Cuánto ocupa cada cosa y cuánto se puede liberar. No borra nada. */
export async function medirEspacio(ahora = new Date(), dias = DIAS_GUARDAR): Promise<Espacio> {
  const ps = await db.proyecto.findMany({ select: { id: true, nombre: true, slug: true } });
  const proyectos: EspacioProyecto[] = [];
  for (const p of ps) {
    const dir = dirProyecto(p.slug);
    if (!existsSync(dir)) continue;
    const build = path.join(dir, "build");
    const nombres = await fs.readdir(build).catch(() => [] as string[]);
    proyectos.push({
      id: p.id,
      nombre: p.nombre,
      total: await tamano(dir),
      videos: await tamano(path.join(dir, "renders")),
      crudos: await sumar(nombres.filter((n) => /^crudo-.+\.mp4$/.test(n)).map((n) => path.join(build, n))),
    });
  }
  proyectos.sort((a, b) => b.total - a.total);
  const pap = await enPapelera(ahora);
  const elementos = await Promise.all(pap.map(async (x) => ({ nombre: x.nombre, dias: x.dias, bytes: await tamano(x.ruta) })));
  const c = await candidatos(ahora, dias);
  const archivosRenders = c.renders.flatMap((x) => x.archivos);
  return {
    proyectos,
    papelera: { total: elementos.reduce((s, x) => s + x.bytes, 0), elementos: elementos.sort((a, b) => b.dias - a.dias) },
    borrable: {
      renders: { cuantos: c.renders.reduce((s, x) => s + x.renderIds.length, 0), bytes: await sumar(archivosRenders) },
      crudos: { cuantos: c.crudos.reduce((s, x) => s + x.archivos.length, 0), bytes: await sumar(c.crudos.flatMap((x) => x.archivos)) },
      papelera: { cuantos: c.papelera.length, bytes: await sumar(c.papelera.map((x) => x.ruta)) },
      fuentes: { cuantos: c.fuentes.length, bytes: await sumar(c.fuentes) },
      copias: { cuantos: c.copias.reduce((s, x) => s + x.archivos.length, 0), bytes: await sumar(c.copias.flatMap((x) => x.archivos)) },
    },
    dias,
    disco: await espacioLibre(dirDatos()).catch(() => null),
  };
}

/** Borra un archivo o carpeta y devuelve cuánto liberó (0 si no se pudo: se sigue con lo demás). */
async function borrar(ruta: string): Promise<number> {
  const n = await tamano(ruta);
  try {
    await fs.rm(ruta, { recursive: true, force: true });
    return n;
  } catch {
    return 0;
  }
}

/**
 * Borra lo que se puede borrar de un tipo. Sólo la llama la pantalla Sistema con `confirmo: true`, después
 * de que la persona aceptó la pregunta. Vuelve a calcular todo aquí (no confía en una lista de fuera) y
 * vuelve a mirar los trabajos de cada proyecto justo antes de borrar.
 */
export async function liberar(que: QueLiberar, confirmo: boolean, ahora = new Date(), dias = DIAS_GUARDAR): Promise<{ cuantos: number; bytes: number }> {
  if (!confirmo) throw new Error("Para borrar hace falta que confirmes primero.");
  const c = await candidatos(ahora, dias);
  let cuantos = 0;
  let bytes = 0;
  const ocupado = async (proyectoId: string) => (await db.trabajo.count({ where: { proyectoId, estado: { in: ["pendiente", "corriendo"] } } })) > 0;
  if (que === "renders") {
    for (const x of c.renders) {
      if (await ocupado(x.proyectoId)) continue;
      // Primero las filas: si un archivo no se puede borrar, queda un archivo suelto (que no se ve ni se
      // ofrece) y no un video en la lista que apunta a un archivo que ya no está.
      await db.render.deleteMany({ where: { id: { in: x.renderIds } } });
      cuantos += x.renderIds.length;
      // La hoja de contacto es una carpeta (`<base>-hoja/`, con los fotogramas): va entera.
      for (const a of x.archivos) bytes += await borrar(a);
    }
  } else if (que === "crudos") {
    for (const x of c.crudos) {
      if (await ocupado(x.proyectoId)) continue;
      bytes += await sumar(x.archivos);
      for (const a of x.archivos) await fs.rm(a, { force: true });
      cuantos += x.archivos.length;
    }
  } else if (que === "fuentes") {
    // Se vuelve a mirar justo antes: un trabajo nuevo pudo pedir uno de estos videos.
    const frescos = new Set(await fuentesViejas(ahora, dias, await enUso({ ahora, dias })));
    for (const r of c.fuentes) {
      if (!frescos.has(r)) continue;
      bytes += await borrar(r);
      if (!existsSync(r)) cuantos++;
    }
  } else if (que === "copias") {
    const comfyOcupado = (await db.trabajo.count({ where: { tipo: "workflow.correr", estado: { in: ["pendiente", "corriendo"] } } })) > 0;
    for (const x of c.copias) {
      if (x.proyectoId ? await ocupado(x.proyectoId) : comfyOcupado) continue;
      for (const a of x.archivos) {
        bytes += await borrar(a);
        if (!existsSync(a)) cuantos++;
      }
    }
  } else {
    const base = path.resolve(dirPapelera());
    for (const x of c.papelera) {
      // Sólo lo que está directamente dentro de la papelera.
      if (path.dirname(path.resolve(x.ruta)) !== base) continue;
      bytes += await tamano(x.ruta);
      await fs.rm(x.ruta, { recursive: true, force: true });
      cuantos++;
    }
  }
  return { cuantos, bytes };
}
