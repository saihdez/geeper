/** REN-10: el editor de plantillas carga de /fuentes las letras que trae Geeper y sólo pide a Google las demás. */
import { describe, expect, it } from "vitest";
import { cssFuentesPantalla } from "@/lib/fuentes-css";

describe("letras en la pantalla de plantillas", () => {
  it("las que vienen dentro salen de /fuentes y no van a Google", () => {
    const r = cssFuentesPantalla(["Inter", "Montserrat"]);
    expect(r.deGoogle).toEqual([]);
    expect(r.css).toContain('font-family: "Inter"');
    expect(r.css).toContain('url("/fuentes/inter/');
    expect(r.css).not.toMatch(/googleapis|gstatic/);
  });
  it("una que no viene dentro se pide a Google como antes", () => {
    const r = cssFuentesPantalla(["Inter", "Una Fuente Rara"]);
    expect(r.deGoogle).toEqual(["Una Fuente Rara"]);
  });
});
