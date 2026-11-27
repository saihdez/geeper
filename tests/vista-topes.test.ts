import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-vista-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

type Vista = typeof import("@/lib/vista");
let vista: Vista;

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  vista = await import("@/lib/vista");
  const { db } = await import("@/lib/db");
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
  const base = Date.now();
  await db.render.createMany({
    data: Array.from({ length: vista.TOPES_VISTA.renders + 5 }, (_, i) => ({
      proyectoId: "p1", versionNumero: 1, perfil: "shorts-9x16", ruta: `r${i}.mp4`, estado: "rechazado", creado: new Date(base + i * 1000),
    })),
  });
}, 60_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("SRV-05: la vista del proyecto trae listas con tope", () => {
  it("trae sólo los renders más recientes, el último primero", async () => {
    const v = await vista.vistaProyecto("p1");
    expect(v!.fila.renders).toHaveLength(vista.TOPES_VISTA.renders);
    expect(v!.fila.renders[0]!.ruta).toBe(`r${vista.TOPES_VISTA.renders + 4}.mp4`);
  });
});
