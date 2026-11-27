/** UX-37: la vista previa en vivo avisa mientras se actualiza, flota al salir de la pantalla y salta a la escena cambiada. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VistaEnVivo, accionAlListo, textoPreparando, tramoDeEscena } from "@/components/vista-en-vivo";
import { escenaDeEdicion } from "@/components/editor-estado";

const fuente = fs.readFileSync(path.join(process.cwd(), "src", "components", "vista-en-vivo.tsx"), "utf8");

describe("vista previa en vivo (UX-37)", () => {
  it("al guardar un cambio de escena reproduce desde 1 s antes y durante 3 s", () => {
    expect(tramoDeEscena(12.9, 40)).toEqual({ desde: 11.9, hasta: 14.9 });
    expect(tramoDeEscena(0.4, 40)).toEqual({ desde: 0, hasta: 3 });
    expect(tramoDeEscena(39.5, 40)).toEqual({ desde: 38.5, hasta: 40 });
    expect(tramoDeEscena(50, 10).desde).toBeCloseTo(9.9);
    expect(tramoDeEscena(5, NaN)).toEqual({ desde: 4, hasta: 7 });
  });

  it("dice «Actualizando la vista previa…» mientras prepara la versión nueva", () => {
    expect(textoPreparando(true)).toBe("Actualizando la vista previa…");
    expect(textoPreparando(false)).toBe("Preparando la vista previa…");
    expect(fuente).toMatch(/actualizando && <p[^>]*role="status">\{textoPreparando\(true\)\}/);
  });

  it("la primera carga se anuncia como estado", () => {
    const html = renderToStaticMarkup(createElement(VistaEnVivo, { proyectoId: "x", version: 1 }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Preparando la vista previa…");
  });

  it("fuera de la pantalla el mismo player flota abajo a la derecha y se puede ocultar", () => {
    expect(fuente).toContain("IntersectionObserver");
    expect(fuente).toContain("fixed bottom-4 right-4");
    expect(fuente).toContain('aria-label="Ocultar la vista pequeña"');
    // Un solo <hyperframes-player>: flotar no lo vuelve a cargar.
    expect(fuente.match(/createElement\("hyperframes-player"/g)).toHaveLength(1);
  });
});

describe("salto a la escena cambiada (UX-37)", () => {
  const base = { clave: "a-5", montado: null as string | null, aplicado: 0, versionVista: 5, version: 5 };

  it("un player recién montado retoma el segundo visto", () => {
    expect(accionAlListo(base)).toBe("retomar");
  });

  it("el mismo player no vuelve a saltar cuando cambia la versión o llega otro render", () => {
    // La versión nueva todavía no llegó (versionVista 5, version 6): no se toca el player que se ve.
    expect(accionAlListo({ ...base, montado: "a-5", version: 6 })).toBe("nada");
    expect(accionAlListo({ ...base, montado: "a-5", version: 6, irA: { segundo: 12, vez: 1 } })).toBe("nada");
    expect(accionAlListo({ ...base, montado: "a-5" })).toBe("nada");
  });

  it("el salto pedido se aplica una vez, en el player de la versión al día", () => {
    expect(accionAlListo({ ...base, montado: "a-5", irA: { segundo: 12, vez: 1 } })).toBe("tramo");
    expect(accionAlListo({ ...base, montado: "a-5", irA: { segundo: 12, vez: 1 }, aplicado: 1 })).toBe("nada");
  });

  it("el editor pasa el salto a la vista en vivo y salta sólo con cambios de una escena", () => {
    const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");
    expect(editor).toMatch(/<VistaEnVivo [^>]*irA=\{irA\}/);
    expect(escenaDeEdicion({ tipo: "ajusteVisual", escena: "e03" })).toBe("e03");
    expect(escenaDeEdicion({ tipo: "corregirSubtitulo", escena: "e01", desde: 0, hasta: 2, texto: "hola" })).toBe("e01");
    expect(escenaDeEdicion({ tipo: "quitarEscena", escena: "e03" })).toBeNull();
    expect(escenaDeEdicion({ tipo: "cambiarFormato", formato: "16:9" })).toBeNull();
  });
});
