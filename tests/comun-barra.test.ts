/** A11-10: la barra de avance dice de qué es al lector de pantalla. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Barra } from "@/components/comun";

describe("Barra", () => {
  it("lleva nombre: el que se le pasa o «Avance»", () => {
    expect(renderToStaticMarkup(createElement(Barra, { valor: 0.8, etiqueta: "Avance: instalando PhotoCraft" }))).toContain('aria-label="Avance: instalando PhotoCraft"');
    const html = renderToStaticMarkup(createElement(Barra, { valor: 0.5 }));
    expect(html).toContain('aria-label="Avance"');
    expect(html).toContain('aria-valuenow="50"');
  });
});
