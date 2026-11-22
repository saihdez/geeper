import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-eliminar-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

type Mod = typeof import("@/lib/eliminar-proyecto");
let m: Mod;
let db: typeof import("@/lib/db")["db"];
let dirProyecto: typeof import("@/lib/rutas")["dirProyecto"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  m = await import("@/lib/eliminar-proyecto");
  db = (await import("@/lib/db")).db;
  dirProyecto = (await import("@/lib/rutas")).dirProyecto;
}, 60_000);

async function crear(id: string) {
  await db.proyecto.create({ data: { id, slug: id, nombre: `Proyecto ${id}`, tema: "t", formato: "9:16", plantilla: "x" } });
  fs.mkdirSync(path.join(dirProyecto(id), "assets"), { recursive: true });
  fs.writeFileSync(path.join(dirProyecto(id), "geeper.json"), "{}");
}

describe("eliminar un proyecto", () => {
  it("su carpeta pasa a la papelera (no se borra) y la fila sale con sus trabajos y versiones", async () => {
    await crear("borrame");
    await db.trabajo.create({ data: { proyectoId: "borrame", tipo: "render.entregar", motor: "render", estado: "hecho", payload: {} } });
    const r = await m.eliminarProyecto("borrame");
    expect(r.nombre).toBe("Proyecto borrame");
    expect(fs.existsSync(dirProyecto("borrame"))).toBe(false);
    expect(r.papelera!.startsWith(m.dirPapelera())).toBe(true);
    expect(fs.readFileSync(path.join(r.papelera!, "geeper.json"), "utf8")).toBe("{}");
    expect(await db.proyecto.findUnique({ where: { id: "borrame" } })).toBeNull();
    expect(await db.trabajo.count({ where: { proyectoId: "borrame" } })).toBe(0);
  });

  it("no se puede con un trabajo en la fila o corriendo; el proyecto queda igual", async () => {
    await crear("ocupado");
    await db.trabajo.create({ data: { proyectoId: "ocupado", tipo: "render.entregar", motor: "render", estado: "corriendo", payload: {} } });
    await expect(m.eliminarProyecto("ocupado")).rejects.toThrow(/trabajo en curso/);
    expect(fs.existsSync(dirProyecto("ocupado"))).toBe(true);
    expect(await db.proyecto.findUnique({ where: { id: "ocupado" } })).not.toBeNull();
  });

  it("sin carpeta igual se elimina de la lista; uno que no existe da un mensaje claro", async () => {
    await db.proyecto.create({ data: { id: "sincarpeta", slug: "sincarpeta", nombre: "x", tema: "t", formato: "9:16", plantilla: "x" } });
    expect((await m.eliminarProyecto("sincarpeta")).papelera).toBeNull();
    await expect(m.eliminarProyecto("no-existe")).rejects.toThrow(/ya no existe/);
  });

  it("el nombre en la papelera sirve en Windows (sin «:»)", () => {
    expect(m.nombreEnPapelera("mi-video", new Date("2026-11-22T03:04:05Z"))).toBe("mi-video-2026-11-22-03-04-05");
  });
});
