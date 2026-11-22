/**
 * El CLI de Hyperframes viene con el repo (WRK-11): `pnpm install` lo deja en node_modules con la versión
 * fijada y Geeper lo corre con node, sin `npx` (que lo bajaba de internet en cada máquina nueva).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cliLocalHf, comandoHf } from "@/lib/hyperframes";

const RAIZ = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
// La versión fijada en el código, sin lo que pueda cambiar GEEPER_HYPERFRAMES_VERSION.
const FIJADA = /HYPERFRAMES_VERSION = [^"]*"([^"]+)"/.exec(fs.readFileSync(path.join(RAIZ, "src", "lib", "rutas.ts"), "utf8"))?.[1];

describe("CLI de Hyperframes local (WRK-11)", () => {
  it("package.json lo fija exacto, igual que @hyperframes/core y que el código", () => {
    expect(FIJADA).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies.hyperframes).toBe(FIJADA);
    expect(pkg.dependencies["@hyperframes/core"]).toBe(FIJADA);
    expect(pkg.dependencies["@hyperframes/player"]).toBe(FIJADA);
  });

  it("cliLocalHf() lo encuentra y responde su versión", () => {
    const bin = cliLocalHf(RAIZ, FIJADA);
    expect(bin).not.toBeNull();
    expect(fs.existsSync(bin!)).toBe(true);
    const salida = execFileSync(process.execPath, [bin!, "--version"], {
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(salida.trim()).toBe(FIJADA);
  });

  it("sin GEEPER_HYPERFRAMES_VERSION distinta, se corre con node y no con npx", () => {
    if (process.env.GEEPER_HYPERFRAMES_VERSION && process.env.GEEPER_HYPERFRAMES_VERSION !== FIJADA) return;
    const c = comandoHf(["--version"]);
    expect(c.cmd).toBe(process.execPath);
    expect(c.args[0]).toBe(cliLocalHf(RAIZ, FIJADA));
  });
});
