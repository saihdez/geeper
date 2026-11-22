/** `pnpm run test:reales` (scripts/pruebas-reales.mjs) activa las pruebas reales también en Windows (ESC-05). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pruebasReales } from "./ayudas/reales";

const RAIZ = path.join(__dirname, "..");

describe("pnpm run test:reales (ESC-05)", () => {
  it("es un script de node, no una variable puesta en la línea (no funcionaría en Windows)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:reales"]).toBe("node scripts/pruebas-reales.mjs");
  });

  // Sólo corre dentro de `test:reales`: la prueba de abajo lo lanza con este archivo.
  it.skipIf(!pruebasReales)("dentro de test:reales, GEEPER_PRUEBAS_REALES vale 1", () => {
    expect(process.env.GEEPER_PRUEBAS_REALES).toBe("1");
  });

  it.skipIf(pruebasReales)("lanza vitest con las pruebas reales activadas y pasa los argumentos", () => {
    const env = { ...process.env };
    delete env.GEEPER_PRUEBAS_REALES;
    const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "pruebas-reales.mjs"), "--", "tests/pruebas-reales.test.ts", "-t", "GEEPER_PRUEBAS_REALES vale 1"], {
      cwd: RAIZ,
      env,
      encoding: "utf8",
      timeout: 90_000,
    });
    const salida = `${r.stdout}${r.stderr}`;
    expect(r.status, salida).toBe(0);
    expect(salida).toMatch(/1 passed/);
  }, 120_000);
});
