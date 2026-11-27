/** A11-11: las pantallas escriben números y fechas con lib/formato.ts (un solo idioma), no cada una a su manera. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");
const ARCHIVOS = [
  "editor-proyecto.tsx", "edicion-avanzada.tsx", "acciones-proyecto.ts", "editor-estado.ts", "panel-efectos-sonido.tsx", "panel-animar.tsx",
  "editor-plantilla.tsx", "sistema.tsx", "novedades.tsx", "cuentas.tsx", "panel-publicar.tsx", "anuncios/prueba.tsx",
];

describe("números y fechas con un solo formato (A11-11)", () => {
  it.each(ARCHIVOS)("%s no arma su propia coma decimal, fecha ni toLocaleString", (r) => {
    const s = leer(r);
    expect(s).not.toMatch(/\.replace\("\.", ","\)/);
    expect(s).not.toMatch(/toLocaleString\("es(-MX)?"/);
    expect(s).not.toMatch(/^const fecha = /m);
    expect(s).not.toMatch(/\d,\d+ s\b/); // «0,6 s» escrito a mano
  });

  it("los segundos visibles del editor salen con numero(): punto decimal como el resto de la app", async () => {
    const { EditorGrupo } = await import("@/components/editor-proyecto");
    const g = { texto: "x", inicio: 1.25, fin: 2, desde: 0, hasta: 1, oido: "x", lineas: 1, cruza: false, mostradoPropio: "x", cps: 21.4 };
    const html = renderToStaticMarkup(createElement(EditorGrupo, { g, corregido: false, onGuardar: async () => true, onQuitar: async () => undefined }));
    expect(html).toContain("1.25 s");
    expect(html).toContain("(21.4 letras por segundo)");
    for (const r of ["editor-proyecto.tsx", "edicion-avanzada.tsx", "panel-efectos-sonido.tsx", "editor-plantilla.tsx"]) {
      // toFixed sólo queda en lo que no se lee (parámetros de URL, el código de tiempo t2).
      const visibles = [...leer(r).matchAll(/[^\n]*toFixed[^\n]*/g)].map((m) => m[0]).filter((l) => !/&t=\$\{|const t2 =/.test(l));
      expect(visibles, r).toEqual([]);
    }
  });
});
