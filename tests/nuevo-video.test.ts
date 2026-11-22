/** Página «Nuevo video»: lo que ve y usa la persona (UX-42, A11-09, UX-31, A11-08, UX-39, A11-06). */
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
