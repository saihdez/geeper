import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();

describe("el servidor escucha sólo en esta PC (SEG-08)", () => {
  it("dev y start van atados a 127.0.0.1", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toMatch(/--hostname 127\.0\.0\.1\b/);
    expect(pkg.scripts.start).toMatch(/--hostname 127\.0\.0\.1\b/);
  });

  it("dev:up también", () => {
    expect(fs.readFileSync(path.join(raiz, "scripts", "dev-up.ts"), "utf8")).toMatch(/"--hostname", "127\.0\.0\.1"/);
  });
});
