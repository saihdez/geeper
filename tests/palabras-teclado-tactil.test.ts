/** A11-07: editar por texto con el teclado o en una pantalla táctil. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EdicionPorTexto, elegirTramo, type PalabraV } from "@/components/edicion-avanzada";

const palabras: PalabraV[] = ["Los", "faros", "olvidados", "del", "norte"].map((texto, k) => ({
  texto, inicio: k * 0.5, fin: k * 0.5 + 0.4, confianza: null, dudosa: false, recorte: null,
}));

describe("Elegir un tramo sin Mayús (A11-07)", () => {
  it("tocar una palabra y después otra elige el tramo entre las dos", () => {
    const una = elegirTramo(null, 1);
    expect(una).toEqual([1, 2]);
    expect(elegirTramo(una, 3)).toEqual([1, 4]);
    expect(elegirTramo(una, 0)).toEqual([0, 2]);
  });

  it("tocar la misma la suelta; con un tramo ya elegido, se empieza de nuevo", () => {
    expect(elegirTramo([2, 3], 2)).toBeNull();
    expect(elegirTramo([1, 4], 4)).toEqual([4, 5]);
  });

  it("Mayús (clic o flecha) alarga el tramo", () => {
    expect(elegirTramo([1, 4], 4, true)).toEqual([1, 5]);
  });
});

describe("Palabras de la escena", () => {
  const html = renderToStaticMarkup(createElement(EdicionPorTexto, {
    escena: "e01", audio: "/voz.wav", palabras, duracion: 2.5, duracionOriginal: 2.5, editar: async () => {}, ocupado: false,
  }));

  it("sólo una palabra está en el orden de Tab (las demás, con las flechas)", () => {
    expect(html).toContain('role="toolbar"');
    expect(html.match(/data-palabra="\d+" tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/data-palabra="\d+" tabindex="-1"/g)).toHaveLength(4);
  });

  it("en pantallas táctiles las palabras miden 32 px de alto y la ayuda no pide Mayús", () => {
    expect(html).toContain("pointer-coarse:min-h-8");
    expect(html).toContain("toca una palabra, o la primera y la última de un tramo");
    expect(html).toContain("Esc para cerrar");
    expect(html).not.toContain("Mayús+clic para un tramo");
  });
});
