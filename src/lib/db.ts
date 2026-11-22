import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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

function crear(): PrismaClient {
  const ruta = rutaBaseDatos();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
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
