/** A11-02: quien usa el teclado tiene que ver dónde está el foco y qué eligió. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");

describe("foco visible (A11-02)", () => {
  it.each(["anuncios/campana.tsx", "anuncios/marca-web.tsx", "workflows.tsx"])("%s no quita el contorno sin poner otro", (r) => {
    for (const clase of leer(r).match(/className=[^>]*outline-none[^>]*/g) ?? []) {
      expect(clase).toMatch(/focus-visible:ring/);
    }
  });

  it("en las recetas lo elegido lleva anillo", () => {
    const s = leer("workflows.tsx");
    expect(s).toContain('abierto === w.id ? "ring-2 ring-cyan-500"');
    expect(s).toContain("aria-pressed={categoria === c}");
  });
});
