/** UX-29: tras crear, la página dice si se está haciendo (y cuánto tarda) o si falló, sin jerga. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estadoCreacion } from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("mientras se crea el proyecto (UX-29)", () => {
  it("un trabajo en marcha: en curso", () => {
    expect(estadoCreacion([{ id: "a", tipo: "mpt.generar", estado: "corriendo" }]).fase).toBe("en-curso");
  });
  it("el último falló o se cortó: fallo (antes decía que «se está generando»)", () => {
    for (const estado of ["fallido", "interrumpido", "cancelado"]) {
      const c = estadoCreacion([{ id: "a", tipo: "mpt.generar", estado }]);
      expect(c.fase).toBe("fallo");
      expect(c.trabajo?.id).toBe("a");
    }
  });
  it("sin trabajos: esperando", () => expect(estadoCreacion([]).fase).toBe("esperando"));
  it("los textos no hablan de geeper.json y ofrecen volver a intentar", () => {
    expect(editor).not.toContain("Todavía no hay geeper.json");
    expect(editor).toContain("Tarda unos minutos; puedes cerrar esta página y volver.");
    expect(editor).toContain("No se pudo hacer el video.");
    expect(editor).toContain('{ accion: "relanzar" }');
  });
});
