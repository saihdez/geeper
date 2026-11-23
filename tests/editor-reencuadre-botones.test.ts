/** A11-09: reencuadrar un clip de directo se pide con un botón, no con un menú que actúa al cambiar. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("pantalla dividida con dos botones (A11-09)", () => {
  it("no hay un select que llame a reencuadrar al cambiar", () => {
    expect(editor).not.toMatch(/<select[^>]*Pantalla dividida/);
    expect(editor).not.toMatch(/onChange=\{[^}]*reencuadrar\(/);
  });

  it("cada opción es un botón que encola su reencuadre", () => {
    expect(editor).toMatch(/onClick=\{\(\) => void reencuadrar\(e\.id, "react"\)\}>Cara arriba y juego abajo<\/button>/);
    expect(editor).toMatch(/onClick=\{\(\) => void reencuadrar\(e\.id, "cara"\)\}>Cara a toda la altura<\/button>/);
  });
});
