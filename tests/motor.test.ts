/** UX-05: un aviso común cuando el motor (worker) no corre. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { motorVivo } from "@/lib/motor";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-motor-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_CONFIG = path.join(dir, "config");

beforeAll(() => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
}, 60_000);

describe("motor", () => {
  it("vivo sólo con un latido de menos de un minuto", () => {
    const ahora = Date.now();
    expect(motorVivo(null, ahora)).toBe(false);
    expect(motorVivo(new Date(ahora - 5_000), ahora)).toBe(true);
    expect(motorVivo(new Date(ahora - 61_000), ahora)).toBe(false);
  });

  it("/api/sistema/motor responde según el latido de la base", async () => {
    const { GET } = await import("@/app/api/sistema/motor/route");
    expect(await (await GET()).json()).toEqual({ vivo: false });
    const { db } = await import("@/lib/db");
    await db.sistema.create({ data: { clave: "worker.latido", valor: new Date().toISOString() } });
    expect(await (await GET()).json()).toEqual({ vivo: true });
  });
});
