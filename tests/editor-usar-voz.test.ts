/** UX-26 (parte del editor): elegir una voz no dice «Listo» antes de tiempo ni sigue si no se guardó. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preguntaUsarVoz } from "@/components/editor-proyecto";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("usar una voz (UX-26)", () => {
  it("la pregunta no dice que ya es la voz del video", () => {
    const t = preguntaUsarVoz("Álex");
    expect(t).toMatch(/^Elegiste «Álex»\. ¿La ponemos ya en el video\?/);
    expect(t).toContain("unos 2 minutos");
    expect(t).not.toMatch(/Listo/);
  });
  it("si guardar la voz falla, no pregunta ni regenera", () => {
    expect(editor).toContain('if (!(await editarOk({ tipo: "cambiarVoz", motor, voz }))) return;');
  });
});
