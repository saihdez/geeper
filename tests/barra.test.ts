/** A11-16: en ventanas angostas la barra de arriba no ocupa varias filas; el resto va en «Más». */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let ruta = "/";
vi.mock("next/navigation", () => ({ usePathname: () => ruta }));
vi.mock("@/components/paleta", () => ({ Paleta: () => null }));
vi.mock("@/components/motor", () => ({ AvisoMotor: () => null }));

const { Barra, PRINCIPALES, enMas } = await import("@/components/barra");
const { DESTINOS } = await import("@/lib/destinos");

const pintar = (r: string) => {
  ruta = r;
  return renderToStaticMarkup(createElement(Barra));
};
/** Lo que hay dentro del menú «Más». */
const menu = (html: string) => /<details[^>]*barra-mas[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "";

describe("barra de arriba compacta (A11-16)", () => {
  it("a la vista quedan las cinco secciones de todos los días; las demás van en «Más»", () => {
    expect([...PRINCIPALES]).toEqual(["/", "/nuevo", "/clips", "/trabajos", "/anuncios"]);
    expect(enMas().map((d) => d.titulo)).toEqual(["Avatares", "Workflows", "Escenas 3D", "Invitaciones", "Estilos del canal", "Media", "Cuentas", "Sistema"]);
    // Ninguna sección se pierde: cada una está a la vista o en «Más».
    expect(DESTINOS.length).toBe(PRINCIPALES.size + enMas().length);
  });

  it("«Más» es un menú que se abre con el teclado (details/summary) y lleva todas las demás secciones", () => {
    const html = pintar("/");
    const m = menu(html);
    expect(m).toMatch(/<summary[^>]*>Más<span aria-hidden="true"> ▾<\/span><\/summary>/);
    for (const d of enMas()) expect(m).toContain(`href="${d.ruta}"`);
    for (const r of PRINCIPALES) expect(m).not.toContain(`href="${r}"`);
  });

  it("en la fila, las secciones que también están en «Más» se marcan para ocultarse en ventanas angostas", () => {
    const fila = pintar("/").replace(/<details[\s\S]*<\/details>/, "");
    for (const d of DESTINOS) {
      const enlace = new RegExp(`<a[^>]*href="${d.ruta}"[^>]*>${d.titulo}</a>`).exec(fila)?.[0] ?? "";
      expect(enlace, d.titulo).not.toBe("");
      expect(enlace.includes("barra-extra"), d.titulo).toBe(!PRINCIPALES.has(d.ruta));
    }
  });

  it("si estás en una sección de «Más», el menú dice cuál es", () => {
    const m = menu(pintar("/cuentas"));
    expect(m).toMatch(/<summary[^>]*text-white[^>]*>Cuentas<span aria-hidden="true"> ▾<\/span><span class="sr-only"> \(más secciones\)<\/span><\/summary>/);
    expect(m).toMatch(/<a[^>]*href="\/cuentas"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/cuentas"/);
  });

  it("globals.css oculta lo de más según el ancho y agranda lo táctil", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    expect(css).toContain("@media (min-width: 1440px) { .barra-mas { display: none; } }");
    expect(css).toContain("@media (max-width: 1439.98px) { .barra .barra-extra { display: none; } }");
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.barra a, \.barra summary \{ min-height: 44px;/);
  });

  it("dentro de una app Craft no hay barra", () => {
    expect(pintar("/media/photocraft")).toBe("");
  });
});
