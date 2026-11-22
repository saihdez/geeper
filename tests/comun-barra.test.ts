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

describe("Estado (UX-20)", () => {
  it("nombra los estados del proyecto sin jerga", async () => {
    const { NOMBRES } = await import("@/components/comun");
    expect(NOMBRES.qc).toBe("Falta arreglar algo");
    expect(NOMBRES.entregado).toBe("Video listo");
    for (const n of Object.values(NOMBRES)) expect(n).not.toMatch(/\b(QC|render|GPU|MPT)\b/i);
  });
});
