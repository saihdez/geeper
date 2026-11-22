/**
 * Respaldo diario (SEG-03). Dos pasos:
 *  1. La base: `VACUUM INTO` a <datos>/respaldos/geeper-AAAA-MM-DD.db (una copia coherente aunque la web y
 *     el worker estén escribiendo). Se conservan las 7 más nuevas.
 *  2. La carpeta de datos entera a otro disco (por defecto /mnt/d/geeper-respaldo, o GEEPER_RESPALDO), en
 *     <destino>/geeper-AAAA-MM-DD/. Lo que no cambió desde la copia anterior se enlaza (enlace duro) en vez
 *     de copiarse, así siete copias ocupan poco más que una. Se conservan 7.
 * Fuera de la copia: la base viva y sus restos (va la del paso 1), claves/ (no se copian llaves a un disco
 * que lee Windows; las cuentas se reconectan), modelos/ (se vuelven a bajar) y lo que empieza con punto.
 *
 * El worker lo llama con `respaldarSiToca()` al arrancar y cada hora; `pnpm run respaldo` lo fuerza.
 */
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { dirDatos, rutaBaseDatos } from "./rutas";

export const CONSERVAR = 7;
export const DESTINO_POR_DEFECTO = "/mnt/d/geeper-respaldo";
/** Carpetas de la raíz de datos que no van a la copia externa. */
export const EXCLUIR_RAIZ = new Set(["claves", "modelos", "respaldos"]);
const HORAS_ENTRE_RESPALDOS = 20;
const DIAS_AVISO = 2;

export type OpcionesRespaldo = {
  datos?: string;
  baseDatos?: string;
  /** Carpeta externa; null = sólo la base, sin copia externa. */
  destino?: string | null;
  conservar?: number;
  ahora?: Date;
};

export type ResultadoRespaldo = {
  fecha: string;
  base: string;
  copia: { ruta: string; archivos: number; copiados: number; enlazados: number } | null;
  /** Si la copia externa falló, por qué (la base igual quedó respaldada). */
  error: string | null;
};

export function destinoRespaldo(): string {
  return process.env.GEEPER_RESPALDO ?? DESTINO_POR_DEFECTO;
}

const dosDig = (n: number) => String(n).padStart(2, "0");
/** AAAA-MM-DD en hora local. */
export function fechaDe(d: Date): string {
  return `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}`;
}

const rutaEstado = (datos: string) => path.join(datos, "respaldos", "ultimo.json");

/** Copia coherente de la base con VACUUM INTO (a un temporal y luego renombra: nunca queda una a medias). */
export async function respaldarBase(baseDatos: string, carpeta: string, fecha: string): Promise<string> {
  await fs.mkdir(carpeta, { recursive: true });
  const destino = path.join(carpeta, `geeper-${fecha}.db`);
  const tmp = path.join(carpeta, `.geeper-${fecha}-${process.pid}.db.tmp`);
  await fs.rm(tmp, { force: true });
  const con = new Database(baseDatos, { fileMustExist: true });
  try {
    con.pragma("busy_timeout = 10000");
    con.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  } finally {
    con.close();
  }
  await fs.rename(tmp, destino);
  return destino;
}

/** Borra las más viejas de una carpeta (por nombre, que lleva la fecha), dejando `conservar`. */
async function podar(carpeta: string, patron: RegExp, conservar: number): Promise<void> {
  const nombres = (await fs.readdir(carpeta).catch(() => [] as string[])).filter((n) => patron.test(n)).sort();
  for (const n of nombres.slice(0, Math.max(0, nombres.length - conservar))) {
    await fs.rm(path.join(carpeta, n), { recursive: true, force: true });
  }
}

function excluido(rel: string, esDir: boolean): boolean {
  const partes = rel.split(path.sep);
  const nombre = partes[partes.length - 1]!;
  if (nombre.startsWith(".")) return true;
  if (partes.length === 1) {
    if (esDir && EXCLUIR_RAIZ.has(nombre)) return true;
    if (!esDir && /\.db($|[-.])/i.test(nombre)) return true;
  }
  return false;
}

/** Copia `origen` en `destino`; lo que está igual en `anterior` (tamaño y fecha) se enlaza en vez de copiarse. */
async function copiarCarpeta(origen: string, destino: string, anterior: string | null) {
  const cuenta = { archivos: 0, copiados: 0, enlazados: 0 };
  async function recorrer(rel: string) {
    const entradas = await fs.readdir(path.join(origen, rel), { withFileTypes: true });
    await fs.mkdir(path.join(destino, rel), { recursive: true });
    for (const e of entradas) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (excluido(r, e.isDirectory())) continue;
      if (e.isDirectory()) {
        await recorrer(r);
        continue;
      }
      if (!e.isFile()) continue; // enlaces simbólicos y otros: fuera
      const src = path.join(origen, r);
      const dst = path.join(destino, r);
      const st = await fs.stat(src);
      cuenta.archivos++;
      if (anterior) {
        const prev = path.join(anterior, r);
        const sp = await fs.stat(prev).catch(() => null);
        if (sp && sp.size === st.size && Math.floor(sp.mtimeMs / 1000) === Math.floor(st.mtimeMs / 1000)) {
          try {
            await fs.link(prev, dst);
            cuenta.enlazados++;
            continue;
          } catch {
            // El disco no admite enlaces duros: se copia.
          }
        }
      }
      await fs.copyFile(src, dst);
      await fs.utimes(dst, st.atime, st.mtime);
      cuenta.copiados++;
    }
  }
  await recorrer("");
  return cuenta;
}

/** Hace el respaldo completo. Nunca lanza por la copia externa: lo anota en `error`. */
export async function respaldar(o: OpcionesRespaldo = {}): Promise<ResultadoRespaldo> {
  const datos = o.datos ?? dirDatos();
  const baseDatos = o.baseDatos ?? rutaBaseDatos();
  const destino = o.destino === undefined ? destinoRespaldo() : o.destino;
  const conservar = o.conservar ?? CONSERVAR;
  const fecha = fechaDe(o.ahora ?? new Date());
  const carpetaBases = path.join(datos, "respaldos");

  const base = await respaldarBase(baseDatos, carpetaBases, fecha);
  await podar(carpetaBases, /^geeper-\d{4}-\d{2}-\d{2}\.db$/, conservar);

  let copia: ResultadoRespaldo["copia"] = null;
  let error: string | null = null;
  if (destino) {
    const nombre = `geeper-${fecha}`;
    const final = path.join(destino, nombre);
    const tmp = path.join(destino, `.${nombre}-${process.pid}.parcial`);
    try {
      await fs.mkdir(destino, { recursive: true });
      await fs.rm(tmp, { recursive: true, force: true });
      // La más nueva (también la de hoy si se repite): lo que no cambió se enlaza desde ahí.
      const previas = (await fs.readdir(destino)).filter((n) => /^geeper-\d{4}-\d{2}-\d{2}$/.test(n) && n <= nombre).sort();
      const anterior = previas.length ? path.join(destino, previas[previas.length - 1]!) : null;
      const cuenta = await copiarCarpeta(datos, tmp, anterior);
      await fs.copyFile(base, path.join(tmp, "geeper.db"));
      await fs.rm(final, { recursive: true, force: true });
      await fs.rename(tmp, final);
      await podar(destino, /^geeper-\d{4}-\d{2}-\d{2}$/, conservar);
      copia = { ruta: final, ...cuenta };
    } catch (e) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      error = `No se pudo copiar a ${destino}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const r: ResultadoRespaldo = { fecha, base, copia, error };
  await fs.writeFile(rutaEstado(datos), JSON.stringify({ ...r, hecho: (o.ahora ?? new Date()).toISOString() }, null, 2) + "\n");
  return r;
}

export type EstadoRespaldo = { hecho: string | null; dias: number | null; error: string | null; aviso: string | null };

/** Para Sistema: cuándo fue el último respaldo y si hay que avisar (más de 2 días o la copia falló). */
export async function estadoRespaldo(datos = dirDatos(), ahora = new Date()): Promise<EstadoRespaldo> {
  let u: { hecho?: string; error?: string | null } = {};
  try {
    u = JSON.parse(await fs.readFile(rutaEstado(datos), "utf8"));
  } catch {
    // Nunca se hizo.
  }
  const hecho = u.hecho ?? null;
  const dias = hecho ? (ahora.getTime() - Date.parse(hecho)) / 86_400_000 : null;
  const aviso =
    dias === null
      ? "Todavía no hay ninguna copia de seguridad."
      : dias > DIAS_AVISO
        ? `La última copia de seguridad es de hace ${Math.floor(dias)} días.`
        : u.error
          ? "La última copia de seguridad no llegó al otro disco."
          : null;
  return { hecho, dias, error: u.error ?? null, aviso };
}

/** Respalda si pasaron 20 h desde el último (o nunca hubo). Pensado para el arranque del worker y cada hora. */
export async function respaldarSiToca(o: OpcionesRespaldo = {}): Promise<ResultadoRespaldo | null> {
  const ahora = o.ahora ?? new Date();
  const e = await estadoRespaldo(o.datos ?? dirDatos(), ahora);
  if (e.dias !== null && e.dias * 24 < HORAS_ENTRE_RESPALDOS) return null;
  return respaldar({ ...o, ahora });
}
