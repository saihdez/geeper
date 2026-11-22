import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cliLocalHf } from "@/lib/hyperframes";

const raizCon = (pkg: object) => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "geeper-hf-"));
  mkdirSync(path.join(raiz, "node_modules", "hyperframes"), { recursive: true });
  writeFileSync(path.join(raiz, "node_modules", "hyperframes", "package.json"), JSON.stringify(pkg));
  return raiz;
};

describe("Hyperframes desde node_modules (WRK-11)", () => {
  it("usa el CLI instalado si es la versión fijada", () => {
    const raiz = raizCon({ version: "0.9.27", bin: { hyperframes: "dist/cli.js" } });
    expect(cliLocalHf(raiz, "0.9.27")).toBe(path.join(raiz, "node_modules", "hyperframes", "dist", "cli.js"));
    expect(cliLocalHf(raizCon({ version: "0.9.27", bin: "cli.js" }), "0.9.27")).toMatch(/cli\.js$/);
  });

  it("otra versión, sin bin o sin paquete: null (queda npx de respaldo)", () => {
    expect(cliLocalHf(raizCon({ version: "0.9.26", bin: "cli.js" }), "0.9.27")).toBeNull();
    expect(cliLocalHf(raizCon({ version: "0.9.27" }), "0.9.27")).toBeNull();
    expect(cliLocalHf(mkdtempSync(path.join(os.tmpdir(), "geeper-hf-")), "0.9.27")).toBeNull();
  });
});
