import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { rutaBaseDatos } from "./rutas";

const global_ = globalThis as unknown as { __geeperDb?: PrismaClient };

/**
 * Ajustes de cada conexión (la web y el worker abren la suya):
 * - WAL: la web lee mientras el worker escribe.
 * - busy_timeout: espera hasta 10 s en vez de fallar con «database is locked».
 * - synchronous=FULL (SRV-04): cada guardado espera a que el disco lo confirme. Con NORMAL (lo de antes)
 *   la base no se corrompe, pero un reinicio forzado de Windows podía deshacer los últimos guardados.
 */
export const PRAGMAS = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL;";

/** El adaptador no deja pasar PRAGMAs: se aplican al abrir cada conexión. */
class AdaptadorGeeper extends PrismaBetterSqlite3 {
  override async connect() {
    const conexion = await super.connect();
    await conexion.executeScript(PRAGMAS);
    return conexion;
  }
}

/**
 * Columnas agregadas a tablas que ya existían. La app de escritorio crea las tablas con IF NOT EXISTS y
 * `prisma db push` hay que correrlo a mano: sin esto, una base vieja no tendría la columna y cada consulta
 * a esa tabla fallaría. Sólo se agregan columnas opcionales (sin NOT NULL), que SQLite suma al instante.
 */
export const COLUMNAS_NUEVAS: readonly { tabla: string; columna: string; tipo: string }[] = [
  // UX-41: el intento anterior al «Volver a intentar».
  { tabla: "Trabajo", columna: "anteriores", tipo: "JSONB" },
];

/** Agrega a una base existente las columnas de COLUMNAS_NUEVAS que le falten. Devuelve las que agregó. */
export function completarColumnas(ruta: string): string[] {
  if (!fs.existsSync(ruta)) return [];
  const agregadas: string[] = [];
  const base = new Database(ruta, { timeout: 10_000 });
  try {
    for (const c of COLUMNAS_NUEVAS) {
      const cols = base.prepare(`PRAGMA table_info("${c.tabla}")`).all() as { name: string }[];
      // Sin la tabla, la crea entera quien arma la base (db push o esquema.sql), ya con la columna.
      if (!cols.length || cols.some((x) => x.name === c.columna)) continue;
      try {
        base.exec(`ALTER TABLE "${c.tabla}" ADD COLUMN "${c.columna}" ${c.tipo}`);
        agregadas.push(`${c.tabla}.${c.columna}`);
      } catch (e) {
        // Otro proceso (la web o el worker) la agregó al mismo tiempo.
        if (!/duplicate column/i.test(String(e))) throw e;
      }
    }
  } finally {
    base.close();
  }
  return agregadas;
}

function crear(): PrismaClient {
  const ruta = rutaBaseDatos();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  try {
    completarColumnas(ruta);
  } catch (e) {
    console.error(`No pude completar las columnas de la base: ${(e as Error).message}`);
  }
  const adapter = new AdaptadorGeeper({ url: `file:${ruta}`, timeout: 10_000 });
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = global_.__geeperDb ?? crear();
if (process.env.NODE_ENV !== "production") global_.__geeperDb = db;

let walListo = false;
/** Lo llama el worker al arrancar (los PRAGMAs ya van en cada conexión; esto lo deja explícito). */
export async function prepararDb(): Promise<void> {
  if (walListo) return;
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await db.$queryRawUnsafe("PRAGMA busy_timeout=10000;");
  await db.$executeRawUnsafe("PRAGMA synchronous=FULL;");
  walListo = true;
}
