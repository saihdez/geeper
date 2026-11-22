/** A11-13: los estados se dicen en palabras y lo que se anuncia no cambia cada segundo. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Contadores } from "@/components/anuncios/ui";
import { textoLista } from "@/components/instalar-herramienta";
import { ICONO } from "@/components/preparar-estudio";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");

describe("estados en palabras (A11-13)", () => {
  it("cada paso de «Preparar el estudio» tiene su nombre y «en espera» no se confunde con «falta»", () => {
    for (const [, , texto] of Object.values(ICONO)) expect(texto.length).toBeGreaterThan(0);
    expect(ICONO.pendiente![0]).not.toBe(ICONO.falta![0]);
    expect(leer("preparar-estudio.tsx")).toContain('<span className="sr-only">{estado}:</span>');
  });

  it("los contadores compactos siguen diciendo qué cuentan", () => {
    const html = renderToStaticMarkup(createElement(Contadores, { r: { pass: 2, fail: 1, unknown: 0, not_applicable: 0 }, compacto: true }));
    expect(html).toContain('class="sr-only">pasa');
    expect(html).toContain('class="sr-only">falla');
  });

  it("«Pensando ideas…» no mete los segundos en la región que se anuncia", () => {
    const s = leer("anuncios/guia.tsx");
    const region = s.match(/<span role="status">[^\n]*<\/span><\/span>/)?.[0] ?? "";
    expect(region).toContain("Pensando ideas…");
    expect(region).not.toContain("segundos");
    expect(s).not.toMatch(/role="status" aria-live="polite">\s*<span[^\n]*\n[^\n]*\{segundos\}/);
  });

  it("ya instalada no pide recargar la página", () => {
    expect(textoLista("1.2.0", true)).toBe("Lista (1.2.0). El chequeo se pone verde solo en un momento.");
    expect(textoLista("1.2.0", false)).toContain("Volver a revisar");
    expect(leer("instalar-herramienta.tsx")).not.toContain("Recarga la página");
  });
});
