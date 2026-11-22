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
