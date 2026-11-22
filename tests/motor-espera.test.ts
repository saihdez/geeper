/** UX-05: con el motor apagado, un trabajo en espera no culpa a la tarjeta de video. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textoEspera } from "@/components/motor";

describe("textoEspera", () => {
  it("dice que Geeper está en pausa sólo si el motor está apagado", () => {
    expect(textoEspera(false)).toMatch(/Geeper está en pausa/);
    expect(textoEspera(true)).toMatch(/tarjeta de video está ocupada/);
    expect(textoEspera(null)).toMatch(/tarjeta de video está ocupada/);
  });

  it("workflows y rehacer la toma lo usan en vez del texto fijo", () => {
    for (const f of ["workflows.tsx", "panel-rehacer.tsx"]) {
      const s = fs.readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");
      expect(s).toContain("textoEspera(motorVivo)");
      expect(s).not.toContain('"En espera: la tarjeta de video está ocupada."');
    }
  });
});
