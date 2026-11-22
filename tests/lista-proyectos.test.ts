/** UX-20: la portada habla de «videos» y dice el formato en palabras. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOMBRES } from "@/components/comun";
import { ListaProyectos, nombreFormato } from "@/components/lista-proyectos";

describe("lista de proyectos (UX-20)", () => {
  it("dice el formato en palabras", () => {
    expect(nombreFormato("9:16")).toBe("Vertical (TikTok, Reels, Shorts)");
    expect(nombreFormato("16:9")).toBe("Horizontal (YouTube)");
    expect(nombreFormato("1:1")).toBe("Cuadrado");
  });

  it("usa los mismos nombres que la barra de arriba", () => {
    const html = renderToStaticMarkup(createElement(ListaProyectos));
    expect(html).toContain("Mis videos");
    expect(html).toContain("Nuevo video");
    expect(html).not.toContain("Nuevo proyecto o lote");
  });

  it("no muestra la plantilla ni el número de versión en la tarjeta", () => {
    const s = fs.readFileSync(path.join(process.cwd(), "src", "components", "lista-proyectos.tsx"), "utf8");
    expect(s).not.toContain("{p.plantilla}");
    expect(s).not.toContain("v{p.versionActual}");
    expect(s).not.toMatch(/\blog\b/);
  });

  it("el estado «generando» se dice «Haciendo el video»", () => {
    expect(NOMBRES.generando).toBe("Haciendo el video");
  });
});
