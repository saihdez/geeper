/**
 * Pasos del empaquetado de escritorio (scripts/escritorio/empaquetar.ts) que se pueden probar sin armar
 * la app entera: qué se copia del servidor standalone y la guarda de tamaño (ESC-15).
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Lo único que el servidor necesita del standalone de Next. El resto que trae (la raíz del repo que Next
 * rastrea: src/, docs/, py/, scripts/… y hasta dist-escritorio/ con los instaladores viejos) sobra: `py/` y
 * `docs/` se leen de la raíz de la app (GEEPER_REPO), y node_modules va aparte, plano, en la app.
 */
export const DEL_STANDALONE = ["server.js", "package.json", ".next-escritorio"] as const;

/**
 * Copia del standalone sólo DEL_STANDALONE. Los paquetes con nombre con hash de Turbopack
 * (`.next-escritorio/node_modules`) tampoco: se instalan como alias en la raíz de la app.
 */
export function copiarStandalone(de: string, a: string): void {
  for (const nombre of DEL_STANDALONE) {
    const origen = path.join(de, nombre);
    if (!fs.existsSync(origen)) throw new Error(`Falta ${nombre} en el standalone de Next (${de}).`);
    const aliases = path.join(de, ".next-escritorio", "node_modules");
    fs.cpSync(origen, path.join(a, nombre), { recursive: true, dereference: true, filter: (f) => f !== aliases });
  }
}

/** Bytes de una carpeta, sin seguir enlaces. */
export function tamanoCarpeta(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) total += fs.statSync(path.join(e.parentPath, e.name)).size;
  }
  return total;
}

/**
 * Falla si el servidor que va en la app trae algo que no debe: un `.env*` (secretos de quien empaqueta) o
 * más de `maxBytes` (señal de que volvió a colarse la raíz del repo o los instaladores viejos).
 */
export function revisarStandalone(dir: string, maxBytes = 30 * 1024 * 1024): void {
  const env = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.name.startsWith(".env"))
    .map((e) => path.join(e.parentPath, e.name));
  if (env.length) throw new Error(`El servidor de la app trae archivos .env (no se empaquetan secretos): ${env.join(", ")}`);
  const bytes = tamanoCarpeta(dir);
  if (bytes > maxBytes) {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    throw new Error(`El servidor de la app pesa ${mb(bytes)} (tope ${mb(maxBytes)}): algo de más se coló en ${dir}.`);
  }
}

/** Motores de Prisma para bases que Geeper no usa (sólo SQLite). */
const PRISMA_OTRAS_BASES = /(cockroachdb|mysql|postgresql|sqlserver)/;

/**
 * Borra de node_modules de la app lo que no se usa al correr (ESC-04), tras `npm install` y la
 * recompilación de better-sqlite3: el compilador de Next (@next/swc-*, sólo hace falta para `next build`),
 * sharp y @img (Geeper no usa next/image), los motores de Prisma para otras bases y, de better-sqlite3, el
 * código fuente de SQLite y los objetos intermedios de la compilación (queda el .node ya armado).
 * Devuelve lo borrado, relativo a `nm`.
 */
export function podarNodeModules(nm: string): string[] {
  const borrar: string[] = [];
  const hay = (rel: string) => fs.existsSync(path.join(nm, rel));
  const listar = (rel: string) => (hay(rel) ? fs.readdirSync(path.join(nm, rel)) : []);
  for (const n of listar("@next")) if (n.startsWith("swc-")) borrar.push(path.join("@next", n));
  for (const rel of ["@img", "sharp"]) if (hay(rel)) borrar.push(rel);
  // @prisma/client y sus alias con hash de Turbopack (@prisma/client-ad5a…).
  for (const n of listar("@prisma")) {
    if (!n.startsWith("client")) continue;
    const runtime = path.join("@prisma", n, "runtime");
    for (const f of listar(runtime)) if (PRISMA_OTRAS_BASES.test(f)) borrar.push(path.join(runtime, f));
  }
  for (const rel of ["deps", "src"]) if (hay(path.join("better-sqlite3", rel))) borrar.push(path.join("better-sqlite3", rel));
  const release = path.join("better-sqlite3", "build", "Release");
  for (const n of listar(release)) if (n.startsWith("obj")) borrar.push(path.join(release, n));
  for (const rel of borrar) fs.rmSync(path.join(nm, rel), { recursive: true, force: true });
  return borrar;
}

/**
 * Lo que el código lee del disco en tiempo de ejecución y tiene que viajar en la app (ESC-01): si falta,
 * la falla se ve en el equipo de alguien («En vivo» con una ruta en vez del video). Devuelve lo que falta.
 */
export function faltantesApp(app: string): string[] {
  const falta: string[] = [];
  const necesarios = [
    path.join("node_modules", "hyperframes", "dist", "hyperframe.runtime.iife.js"),
    path.join("node_modules", "hyperframes", "bin", "hyperframes.mjs"),
    path.join("docs", "fuentes.json"),
    "esquema.sql",
    path.join("standalone", "server.js"),
    "main.cjs",
    "worker.mjs",
    "preparar-db.mjs",
    "vigia.mjs",
  ];
  for (const rel of necesarios) {
    const f = path.join(app, rel);
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) falta.push(rel);
  }
  const py = path.join(app, "py");
  if (!fs.existsSync(py) || !fs.readdirSync(py).some((n) => n.endsWith(".py"))) falta.push(path.join("py", "*.py"));
  return falta;
}
