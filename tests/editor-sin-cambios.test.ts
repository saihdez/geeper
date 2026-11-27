/** UX-18 (parte del editor): si la edición no cambió nada, no se dice «Guardado». */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mensajeSinCambios } from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("ediciones sin cambios (UX-18)", () => {
  it("muletillas y silencios dicen lo que no encontraron", () => {
    expect(mensajeSinCambios([{ tipo: "quitarMuletillas" }], { sinCambios: true })).toBe("No encontré muletillas en este video.");
    expect(mensajeSinCambios([{ tipo: "quitarSilencios" }], { sinCambios: true })).toBe("No hay pausas largas que acortar.");
    expect(mensajeSinCambios([{ tipo: "cambiarFormato" }], { sinCambios: true })).toMatch(/nada que cambiar/);
  });
  it("con una versión nueva vale el «Guardado» de siempre", () => {
    expect(mensajeSinCambios([{ tipo: "quitarMuletillas" }], { version: 9 })).toBeNull();
    expect(mensajeSinCambios([{ tipo: "quitarMuletillas" }], null)).toBeNull();
  });
  it("el editor usa ese texto en vez de «Guardado»", () => {
    expect(editor).toContain("const nada = mensajeSinCambios(");
    expect(editor).toContain("return nada ?? r;");
  });
});
