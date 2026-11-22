/** Página «Nuevo video»: lo que ve y usa la persona (UX-42, A11-09, UX-31, A11-08, UX-39, A11-06). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => params,
}));

const { Nuevo } = await import("@/components/nuevo");
const pintar = () => renderToStaticMarkup(createElement(Nuevo));

beforeEach(() => {
  params = new URLSearchParams();
});

describe("Nuevo video", () => {
  it("los dos formularios quedan montados y sólo se oculta el que no se usa (UX-42)", () => {
    // Envolturas en orden: la de «Desde un tema» y la de «Desde una página web».
    const envolturas = (html: string) => [...html.matchAll(/<div( hidden="")?><form/g)].map((m) => (m[1] ? "oculto" : "visible"));
    const tema = pintar();
    expect(tema).toContain('id="temas"');
    expect(tema).toContain('id="demo-url"');
    expect(envolturas(tema)).toEqual(["visible", "oculto"]);
    params = new URLSearchParams("modo=web");
    expect(envolturas(pintar())).toEqual(["oculto", "visible"]);
  });
});

describe("semántica de Nuevo (A11-09)", () => {
  it("el enlace a Clips no está dentro del grupo de opciones", () => {
    const html = pintar();
    const grupo = html.match(/<div[^>]*role="radiogroup"[^>]*>([\s\S]*?)<\/div><a /)?.[1] ?? "";
    expect(grupo).toContain('role="radio"');
    expect(grupo).not.toContain("<a ");
    expect(html).toMatch(/<\/div><a [^>]*href="\/clips"/);
  });

  it("sólo la opción elegida entra con Tab (las otras, con las flechas)", () => {
    const grupo = pintar().match(/<div[^>]*role="radiogroup"[^>]*>([\s\S]*?)<\/div><a /)?.[1] ?? "";
    const radios = [...grupo.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    expect(radios[0]).toMatch(/aria-checked="true"[^>]*tabindex="0"/);
    expect(radios[1]).toMatch(/aria-checked="false"[^>]*tabindex="-1"/);
  });
});

describe("lo elegido no se pinta como el botón principal (A11-08)", () => {
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const fuente = (f: string) => readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");

  it("globals.css marca lo elegido desde aria-pressed, aria-checked o el radio marcado, con ✓", () => {
    for (const clase of [".opcion:is(", ".opcion-tarjeta:is("]) {
      const regla = css.slice(css.indexOf(clase)).split("{")[0]!;
      expect(regla).toContain('[aria-pressed="true"]');
      expect(regla).toContain('[aria-checked="true"]');
      expect(regla).toContain(":has(> input:checked)");
    }
    expect(css).toMatch(/content: "✓"/);
  });

  it("en Nuevo, boton-primario sólo se usa en el botón de enviar", () => {
    for (const f of ["form-nuevo.tsx", "form-demo.tsx", "nuevo.tsx"]) {
      const usos = fuente(f).split("\n").filter((l) => l.includes("boton-primario"));
      expect(usos.every((l) => /<button className="boton boton-primario"/.test(l)), f).toBe(true);
      expect(fuente(f), f).not.toMatch(/\? "boton-primario"|ring-2 ring-(cyan|acento)/);
    }
  });

  it("las formas del video y los estilos son opciones con su estado", () => {
    const html = pintar();
    expect(html).toMatch(/<label class="opcion"><input type="radio"[^>]*name="formato"[^>]*checked=""[^>]*value="9:16"/);
    expect(html).toMatch(/class="opcion-tarjeta p-3"/);
  });
});
