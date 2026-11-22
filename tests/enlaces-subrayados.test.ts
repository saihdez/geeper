/** A11-15: los enlaces dentro de un texto no se reconocen sólo por el color; el «?» de ayuda se puede tocar. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Ayuda } from "@/components/anuncios/ui";

describe("enlaces y ayuda (A11-15)", () => {
  it("los enlaces de las políticas de YouTube van subrayados siempre", () => {
    const s = fs.readFileSync(path.join(process.cwd(), "src", "components", "cuentas.tsx"), "utf8");
    const enlaces = s.match(/<a className="[^"]*" href="https:\/\/(www\.youtube\.com\/t\/terms|policies\.google\.com\/privacy|security\.google\.com[^"]*)"/g) ?? [];
    expect(enlaces).toHaveLength(3);
    for (const a of enlaces) expect(a).toMatch(/className="text-acento underline"/);
  });

  it("el botón «?» mide 24 px", () => {
    const html = renderToStaticMarkup(createElement(Ayuda, { de: "Gancho", texto: "Lo primero que se ve." }));
    expect(html).toContain("h-6 w-6");
  });
});
