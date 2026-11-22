/** A11-01: «Duplicar» plantilla no usa prompt(), que no existe en la app de escritorio. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nombreCopia } from "@/components/plantillas";

describe("duplicar plantilla", () => {
  it("propone «<nombre> (copia)» sin pasar de 80 letras", () => {
    expect(nombreCopia(" Dimerso ")).toBe("Dimerso (copia)");
    const largo = nombreCopia("x".repeat(100));
    expect(largo.length).toBe(80);
    expect(largo.endsWith(" (copia)")).toBe(true);
  });

  it("no usa prompt() ni confirm()", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "plantillas.tsx"), "utf8");
    expect(src).not.toMatch(/\b(prompt|confirm)\(/);
  });
});
