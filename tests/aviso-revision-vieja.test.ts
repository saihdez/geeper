/** UX-16: el panel «¿Está listo para publicar?» avisa cuando la revisión es de antes de los cambios. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvisoRevisionVieja, gruposRepartidos, NOTA_SUBTITULO_REPARTIDO, revisionVieja } from "@/components/aviso-revision-vieja";
import { EditorGrupo } from "@/components/editor-proyecto";

const nada = () => {};

describe("aviso de revisión vieja (UX-16)", () => {
  it("sólo es vieja si la versión actual es más nueva que la revisada", () => {
    expect(revisionVieja(4, 5)).toBe(true);
    expect(revisionVieja(5, 5)).toBe(false);
    expect(revisionVieja(5, 4)).toBe(false);
  });

  it("con cambios después del video, lo dice y ofrece crearlo otra vez", () => {
    const html = renderToStaticMarkup(createElement(AvisoRevisionVieja, { versionRevisada: 4, versionActual: 5, alCrear: nada }));
    expect(html).toContain("Esta revisión es de antes de tus cambios");
    expect(html).toContain("Crear el video otra vez para revisarlo");
    expect(html).toContain('role="status"');
  });

  it("si el video está al día no muestra nada", () => {
    expect(renderToStaticMarkup(createElement(AvisoRevisionVieja, { versionRevisada: 5, versionActual: 5, alCrear: nada }))).toBe("");
  });

  it("explica en palabras simples por qué un texto quedó en dos subtítulos", () => {
    expect(NOTA_SUBTITULO_REPARTIDO).toBe("Lo acomodamos en dos subtítulos para que se lea mejor.");
  });
});

describe("montado en el editor (UX-16)", () => {
  const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

  it("el aviso va arriba del panel de revisión, antes del informe", () => {
    const panel = editor.slice(editor.indexOf("¿Está listo para publicar?</h2>"));
    expect(panel.indexOf("<AvisoRevisionVieja")).toBeGreaterThan(-1);
    expect(panel.indexOf("<AvisoRevisionVieja")).toBeLessThan(panel.indexOf("<InformeQc"));
    expect(panel).toMatch(/<AvisoRevisionVieja versionRevisada=\{render\.versionNumero\}[^]*?alCrear=\{\(\) => void renderizar\(\)\}/);
  });

  it("marca el primer subtítulo de un texto corregido que quedó en dos", () => {
    const grupos = [{ desde: 0, hasta: 3 }, { desde: 3, hasta: 6 }, { desde: 3, hasta: 6 }, { desde: 6, hasta: 9 }];
    expect([...gruposRepartidos(grupos, [{ desde: 3, hasta: 6 }])]).toEqual([1]);
    expect(gruposRepartidos(grupos, [{ desde: 0, hasta: 3 }]).size).toBe(0);
    expect(gruposRepartidos(grupos, []).size).toBe(0);
    expect(editor).toContain("repartido={repartidos.has(i)}");
    expect(editor).toContain("{NOTA_SUBTITULO_REPARTIDO}");
  });

  it("la nota sale bajo el subtítulo repartido", () => {
    const g = { texto: "y que los", inicio: 1, fin: 2, desde: 3, hasta: 6, oido: "y que los navegantes vean", lineas: 1, cruza: false, mostradoPropio: "y que los", cps: 10 };
    const html = renderToStaticMarkup(createElement(EditorGrupo, { g, corregido: true, repartido: true, onGuardar: async () => true, onQuitar: async () => {} }));
    expect(html).toContain(NOTA_SUBTITULO_REPARTIDO);
  });
});
