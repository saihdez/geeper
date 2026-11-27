/** UX-22: «Velocidad del video de la escena» dice la velocidad de verdad, también la ajustada. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EfectosEscena, opcionesVelocidad, type EfectosV } from "@/components/edicion-avanzada";

describe("Velocidad del video de la escena (UX-22)", () => {
  it("una velocidad ajustada (0,759×) aparece como tal y no como «0,5×»", () => {
    const o = opcionesVelocidad(0.759);
    expect(o[0]).toEqual({ valor: "0.759", texto: "Ajustada a la escena (0.76×)" });
    expect(o).toHaveLength(7);
  });

  it("las de la lista no agregan nada", () => {
    expect(opcionesVelocidad(1).map((x) => x.texto)).toEqual(["0.5× (cámara lenta)", "0.75× (cámara lenta)", "Normal", "1.25× (más rápido)", "1.5× (más rápido)", "2× (más rápido)"]);
  });

  it("en el panel queda elegida la ajustada", () => {
    const efectos: EfectosV = { transicion: null, movimiento: null, velocidad: 0.97, color: null, efectos: null };
    const html = renderToStaticMarkup(createElement(EfectosEscena, { escena: "e02", indice: 1, efectos, estilo: null, formato: "9:16", editar: async () => {}, ocupado: false }));
    expect(html).toContain("Velocidad del video de la escena");
    expect(html).toMatch(/<option value="0.97" selected="">Ajustada a la escena \(0.97×\)<\/option>/);
  });
});
