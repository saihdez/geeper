import { describe, expect, it } from "vitest";
import { enlacesFuentes } from "@/lib/vista-previa";
import { tiempoAlVolver } from "@/components/vista-en-vivo";

describe("vista en vivo (REN-06)", () => {
  it("enlaza las dos familias con los pesos que usa el compilador", () => {
    const html = enlacesFuentes({ titulos: "Archivo Black", texto: "Montserrat", pesoTexto: 800 }, () => false);
    expect(html).toContain("family=Archivo+Black&amp;display=block");
    expect(html).toContain("family=Montserrat:wght@800&amp;");
    expect(html).toContain("family=Montserrat:ital,wght@1,800&amp;");
    expect(html.match(/<link /g)).toHaveLength(4);
  });

  it("con la misma familia para todo no repite el pedido", () => {
    const html = enlacesFuentes({ titulos: "Inter", texto: "Inter", pesoTexto: 700 }, () => false);
    expect(html.match(/<link /g)).toHaveLength(3);
    expect(html).toContain("family=Inter:wght@700");
  });

  it("al recargar retoma el mismo segundo sin pasarse del final", () => {
    expect(tiempoAlVolver(0, 52)).toBe(0);
    expect(tiempoAlVolver(25, 52)).toBe(25);
    expect(tiempoAlVolver(55, 52)).toBeCloseTo(51.9);
    expect(tiempoAlVolver(25, Number.NaN)).toBe(25);
    expect(tiempoAlVolver(Number.NaN, 52)).toBe(0);
  });
});
