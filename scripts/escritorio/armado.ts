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
