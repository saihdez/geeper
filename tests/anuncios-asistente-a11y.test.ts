/** A11-14: en el asistente de anuncios la etiqueta pone el cursor en su campo y el foco no se pierde al pasar de paso. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Campo } from "@/components/anuncios/ui";

function ConCampo() {
  return Campo({ etiqueta: "Lo que ofreces", que: "Explicación", children: createElement("textarea", { className: "campo" }) });
}

const fuente = fs.readFileSync(path.join(process.cwd(), "src", "components", "anuncios", "asistente.tsx"), "utf8");

describe("asistente de anuncios (A11-14)", () => {
  it("Campo deja el «?» fuera del <label> y la etiqueta apunta al campo", () => {
    const html = renderToStaticMarkup(createElement(ConCampo));
    const label = /<label for="([^"]+)">([^<]*)<\/label>/.exec(html);
    expect(label).not.toBeNull();
    expect(label![2]).toBe("Lo que ofreces");
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="${label![1]}"`));
    expect(html.indexOf("<button")).toBeGreaterThan(html.indexOf("</label>"));
  });

  it("ningún «?» queda dentro de un <label> del asistente", () => {
    for (const m of fuente.matchAll(/<label[\s\S]*?<\/label>/g)) expect(m[0]).not.toContain("<Ayuda");
    expect(fuente).toContain('<Campo etiqueta="Lo que ofreces, con sus condiciones"');
    expect(fuente).toContain('<Campo etiqueta="¿A qué página lleva el anuncio? (opcional)"');
  });

  it("anuncia el paso y enfoca el título en los pasos sin campo", () => {
    expect(fuente).toMatch(/aria-live="polite">Paso/);
    expect(fuente).toMatch(/<h1 ref=\{titulo\} tabIndex=\{-1\}/);
    expect(fuente).toMatch(/paso === 1 \|\| paso === 2\) titulo\.current\?\.focus\(\)/);
  });
});
