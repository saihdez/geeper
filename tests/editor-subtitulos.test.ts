/** UX-02: corregir un subtítulo no deja «Guardar» pegado ni acepta un texto vacío sin salida. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { correccionesVacias, errorSubtitulo } from "@/components/editor-estado";
import { EditorGrupo } from "@/components/editor-proyecto";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");
const g = { texto: "hola mundo", inicio: 1.2, fin: 2, desde: 0, hasta: 2, oido: "hola mundo", lineas: 1, cruza: false, mostradoPropio: "hola mundo", cps: 10 };

describe("corregir subtítulos (UX-02)", () => {
  it("no acepta un subtítulo vacío y dice cómo quitar la palabra", () => {
    expect(errorSubtitulo("   ")).toMatch(/no puede quedar vacío.*recórtala/);
    expect(errorSubtitulo("GTA VI")).toBeNull();
  });

  it("encuentra las correcciones vacías de versiones viejas para poder recuperarlas", () => {
    const palabras = [{ texto: "un" }, { texto: "poco" }, { texto: "más" }];
    expect(correccionesVacias(palabras, [{ desde: 1, hasta: 2, texto: "" }, { desde: 2, hasta: 3, texto: "MÁS" }])).toEqual([{ desde: 1, oido: "poco" }]);
  });

  it("el campo muestra lo guardado y sin cambios no ofrece «Guardar»", () => {
    const html = renderToStaticMarkup(createElement(EditorGrupo, { g, corregido: false, onGuardar: async () => true, onQuitar: async () => undefined }));
    expect(html).toContain('value="hola mundo"');
    expect(html).not.toContain("Guardar");
  });

  it("Enter guarda, Esc descarta y el borrador sólo se limpia si se guardó", () => {
    expect(editor).toContain('e.key === "Enter"');
    expect(editor).toContain('e.key === "Escape") setBorrador(null)');
    expect(editor).toContain("if (await onGuardar(texto.trim())) setBorrador(null)");
  });
});
