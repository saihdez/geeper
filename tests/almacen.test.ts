import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-almacen-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const HIJO = path.join(process.cwd(), "tests", "ayudas", "guardar-hijo.ts");

type Db = typeof import("@/lib/db");
let db: Db["db"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  db = (await import("@/lib/db")).db;
  await (await import("@/lib/db")).prepararDb();
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
  fs.mkdirSync(path.join(dir, "p1"), { recursive: true });
}, 60_000);

function hijo(cuantos: number, quien: string): Promise<{ fallos: number; errores: string[] }> {
  return new Promise((resolve, reject) => {
    const h = spawn(TSX, [HIJO, "p1", String(cuantos), quien], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    let salida = "";
    h.stdout.on("data", (d) => (salida += d));
    h.on("error", reject);
    h.on("exit", () => {
      try {
        resolve(JSON.parse(salida));
      } catch (e) {
        reject(new Error(`Salida inválida del hijo: ${salida} (${String(e)})`));
      }
    });
  });
}

describe("guardarProyecto con varios procesos a la vez (SEG-04)", () => {
  it("ningún guardado falla y no se repite ningún número de versión", async () => {
    const N = 25;
    const r = await Promise.all([hijo(N, "web"), hijo(N, "worker"), hijo(N, "otro")]);
    expect({ fallos: r.reduce((s, x) => s + x.fallos, 0), errores: r.flatMap((x) => x.errores) }).toEqual({ fallos: 0, errores: [] });
    const versiones = await db.version.findMany({ where: { proyectoId: "p1" }, select: { numero: true, nota: true }, orderBy: { numero: "asc" } });
    expect(versiones.map((v) => v.numero)).toEqual(Array.from({ length: 3 * N }, (_, i) => i + 1));
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id: "p1" } });
    expect(fila.versionActual).toBe(3 * N);
    // El geeper.json en disco es el de la última versión (se escribe con la base bloqueada).
    const enDisco = JSON.parse(fs.readFileSync(path.join(dir, "p1", "geeper.json"), "utf8")) as { nombre: string };
    expect(enDisco.nombre).toBe(versiones[versiones.length - 1]!.nota);
  }, 120_000);
});
