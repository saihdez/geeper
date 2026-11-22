/**
 * «Liberar espacio» (UX-33, decisión 4 b de la auditoría): cuánto ocupa cada cosa y qué se puede borrar.
 *
 * Se conserva siempre, de cada proyecto y formato, el último video y el último aprobado, y todo video que
 * tenga una publicación (publicar exige su ruta y su huella). Lo demás se puede borrar cuando tiene más de
 * 30 días: los videos viejos, los crudos del render (se rehacen al renderizar) y lo que lleva 30 días en la
 * papelera. Nada se borra solo: sólo con `liberar()`, que llama la pantalla Sistema después de que la
 * persona confirma. No toca un proyecto con trabajos en la fila o corriendo.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { dirPapelera } from "./eliminar-proyecto";
import { dirProyecto } from "./rutas";

/** Días que se guarda lo que se puede borrar (decisión del dueño). */
export const DIAS_GUARDAR = 30;
const DIA = 86_400_000;

export type QueLiberar = "renders" | "crudos" | "papelera";

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

/** Qué se borraría de cada proyecto (sin borrar nada). */
async function candidatos(ahora: Date, dias: number) {
  const { ps, ocupados } = await proyectosLibres();
  const publicados = new Set((await db.publicacion.findMany({ select: { renderId: true } })).map((x) => x.renderId));
  const renders: { proyectoId: string; renderIds: string[]; archivos: string[] }[] = [];
  const crudos: { proyectoId: string; archivos: string[] }[] = [];
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
  }
  const papelera = (await enPapelera(ahora)).filter((x) => x.dias >= dias);
  return { renders, crudos, papelera };
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
    },
    dias,
  };
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
      bytes += await sumar(x.archivos);
      // La hoja de contacto es una carpeta (`<base>-hoja/`, con los fotogramas): va entera.
      for (const a of x.archivos) await fs.rm(a, { recursive: true, force: true });
      await db.render.deleteMany({ where: { id: { in: x.renderIds } } });
      cuantos += x.renderIds.length;
    }
  } else if (que === "crudos") {
    for (const x of c.crudos) {
      if (await ocupado(x.proyectoId)) continue;
      bytes += await sumar(x.archivos);
      for (const a of x.archivos) await fs.rm(a, { force: true });
      cuantos += x.archivos.length;
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
