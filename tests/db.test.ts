import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-db-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

describe("ajustes de la conexión (SRV-04)", () => {
  it("cada conexión abre con WAL, busy_timeout y synchronous=FULL, sin llamar a prepararDb", async () => {
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
    const { db } = await import("@/lib/db");
    const uno = async (q: string) => Object.values(((await db.$queryRawUnsafe(q)) as Record<string, unknown>[])[0]!)[0];
    expect(String(await uno("PRAGMA journal_mode;"))).toBe("wal");
    expect(Number(await uno("PRAGMA synchronous;"))).toBe(2); // 2 = FULL
    expect(Number(await uno("PRAGMA busy_timeout;"))).toBe(10000);
  }, 60_000);
});

describe("índices de las consultas frecuentes (SRV-05)", () => {
  it("Trabajo, Render y Publicacion tienen sus índices y el sondeo por proyecto no recorre la tabla", async () => {
    const { db } = await import("@/lib/db"); // la base ya quedó creada por la prueba anterior
    const indices = async (tabla: string) =>
      ((await db.$queryRawUnsafe(`PRAGMA index_list("${tabla}");`)) as { name: string }[]).map((i) => i.name);
    expect(await indices("Trabajo")).toEqual(
      expect.arrayContaining(["Trabajo_proyectoId_creado_idx", "Trabajo_tipo_estado_idx", "Trabajo_estado_idx", "Trabajo_creado_idx"]),
    );
    expect(await indices("Render")).toContain("Render_proyectoId_creado_idx");
    expect(await indices("Publicacion")).toEqual(expect.arrayContaining(["Publicacion_proyectoId_creado_idx", "Publicacion_cuentaId_creado_idx"]));
    const plan = (await db.$queryRawUnsafe(
      `EXPLAIN QUERY PLAN SELECT * FROM "Trabajo" WHERE "proyectoId" = 'x' ORDER BY "creado" DESC;`,
    )) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" ")).toContain("Trabajo_proyectoId_creado_idx");
  }, 60_000);
});
