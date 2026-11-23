/** REN-04: antes de crear el video se avisa de los subtítulos rápidos y se pregunta si el QC lo rechazará. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { avisoSubtitulosRapidos } from "@/lib/qc-explicado";
import { EditorGrupo } from "@/components/editor-proyecto";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("aviso de subtítulos rápidos antes de renderizar (REN-04)", () => {
  it("sin escenas rápidas no avisa", () => {
    expect(avisoSubtitulosRapidos(null)).toBeNull();
    expect(avisoSubtitulosRapidos({ limite: 17, bloquea: true, escenas: [] })).toBeNull();
  });

  it("si bloquea: dice dónde, cuánto y pide confirmar", () => {
    const a = avisoSubtitulosRapidos({ limite: 17, bloquea: true, escenas: [{ id: "e02", indice: 1, cps: 19.23 }, { id: "e05", indice: 4, cps: 18 }] })!;
    expect(a.texto).toContain("las escenas 2 y 5");
    expect(a.texto).toContain("19.2 letras por segundo");
    expect(a.texto).toContain("no se podrá descargar");
    expect(a.confirmar).toMatch(/¿Crearlo igual\?/);
  });

  it("en clips del creador sólo avisa, sin preguntar", () => {
    const a = avisoSubtitulosRapidos({ limite: 17, bloquea: false, escenas: [{ id: "e01", indice: 0, cps: 20 }] })!;
    expect(a.texto).toContain("la escena 1");
    expect(a.confirmar).toBeNull();
  });

  it("el botón de crear pregunta antes de encolar y la fila rápida se marca", () => {
    expect(editor).toMatch(/aviso\?\.confirmar && !confirm\(aviso\.confirmar\)\) return;/);
    const g = { texto: "x", inicio: 0, fin: 1, desde: 0, hasta: 1, oido: "x", lineas: 1, cruza: false, mostradoPropio: "x", cps: 21.4 };
    const html = renderToStaticMarkup(createElement(EditorGrupo, { g, corregido: false, onGuardar: async () => true, onQuitar: async () => undefined }));
    expect(html).toContain("Pasa muy rápido (21.4 letras por segundo)");
  });
});
