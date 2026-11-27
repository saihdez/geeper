/** UX-27: el ritmo de la voz se elige en palabras y avisa que más rápido hace rechazar el video. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { avisoRitmo, opcionesRitmo } from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("ritmo de la voz (UX-27)", () => {
  it("las opciones tienen nombre y 0,85 es la recomendada; 0,95 sigue en la lista", () => {
    const o = opcionesRitmo(0.85);
    expect(o[0]).toEqual({ valor: 0.85, nombre: "Pausado (recomendado)" });
    expect(o.map((x) => x.valor)).toEqual([0.85, 0.9, 0.95, 1, 1.05]);
  });
  it("un valor que no está en la lista no se pierde", () => {
    expect(opcionesRitmo(1.2).map((x) => x.valor)).toContain(1.2);
  });
  it("desde 0,9 avisa que el video puede no descargarse", () => {
    expect(avisoRitmo(0.85)).toBeNull();
    expect(avisoRitmo(0.9)).toMatch(/no se podrá descargar/);
    expect(avisoRitmo(1.05)).toMatch(/no se podrá descargar/);
    // «pueden pasar» y «no se podrá» no se contradicen: sólo si pasa.
    expect(avisoRitmo(0.9)).toBe("Con este ritmo los subtítulos pueden pasar muy rápido y, si pasa, el video no se podrá descargar.");
  });
  it("ni números sueltos ni selector en clips", () => {
    expect(editor).not.toContain("[0.85, 0.9, 0.95, 1, 1.05].map");
    expect(editor).toContain("Ritmo de la voz");
    expect(editor).toMatch(/\{!v\.extras\?\.clip && \(\s*<div className="flex flex-wrap items-end gap-2 border-t/);
  });
});
