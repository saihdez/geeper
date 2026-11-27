/** A11-09: controles con la semántica correcta (lista de colores y campos de la marca). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Muestras } from "@/components/paleta-imagen";

describe("A11-09", () => {
  it("los colores encontrados son una lista ul/li con un botón en cada fila", () => {
    const html = renderToStaticMarkup(
      createElement(Muestras, { colores: [{ hex: "#112233", parte: 0.5 }, { hex: "#abcdef", parte: 0.2 }] as never, alElegir: () => {} }),
    );
    expect(html).not.toContain('role="listitem"');
    expect(html).not.toContain('role="list"');
    expect(html).toMatch(/^<ul [^>]*aria-label="Colores encontrados"/);
    expect(html.match(/<li><button type="button"/g)).toHaveLength(2);
  });

  it("en la marca del sitio, ningún campo queda dentro de un botón", () => {
    const fuente = readFileSync(path.join(process.cwd(), "src", "components", "anuncios", "marca-web.tsx"), "utf8");
    for (const boton of fuente.split("<button").slice(1)) {
      expect(boton.split("</button>")[0]).not.toContain("<input");
    }
  });
});
