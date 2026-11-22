/** UX-16: el panel «¿Está listo para publicar?» avisa cuando la revisión es de antes de los cambios. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvisoRevisionVieja, NOTA_SUBTITULO_REPARTIDO, revisionVieja } from "@/components/aviso-revision-vieja";

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
