/** A11-02: quien usa el teclado tiene que ver dónde está el foco y qué eligió. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");

describe("foco visible (A11-02)", () => {
  it.each(["anuncios/campana.tsx", "anuncios/marca-web.tsx", "workflows.tsx"])("%s no quita el contorno sin poner otro", (r) => {
    for (const clase of leer(r).match(/className=[^>]*outline-none[^>]*/g) ?? []) {
      expect(clase).toMatch(/focus-visible:ring/);
    }
  });

  it("en las recetas lo elegido se marca con .opcion-tarjeta y aria-pressed (A11-08)", () => {
    const s = leer("workflows.tsx");
    expect(s).toContain('aria-pressed={abierto?.id === w.id} onClick={() => setAbierto({ id: w.id })} className="opcion-tarjeta overflow-hidden"');
    expect(s).toContain("aria-pressed={categoria === c}");
  });
});

describe("barras de avance con nombre (A11-10)", () => {
  it.each(["lista-proyectos.tsx", "workflows.tsx", "panel-rehacer.tsx"])("%s dice de qué es cada barra", (r) => {
    const barras = leer(r).match(/<Barra [^>]*>/g) ?? [];
    expect(barras.length).toBeGreaterThan(0);
    for (const b of barras) expect(b).toContain("etiqueta=");
  });
});

describe("foco visible en Clips (A11-02)", () => {
  const s = leer("clips.tsx");
  it("el input de archivo no deja una parada de Tab invisible: lo abre el botón «Elegir un archivo»", () => {
    const input = s.match(/<input ref=\{entrada\}[^>]*>/)?.[0] ?? "";
    expect(input).toContain('className="hidden"');
    expect(input).not.toContain("sr-only");
    expect(s).toContain("entrada.current?.click()");
  });

  it("el estilo elegido y el gancho elegido se marcan con .opcion (borde, fondo y ✓), no sólo color de borde", () => {
    expect(s).toContain('<label key={s.id} className="opcion-tarjeta p-3 text-center">');
    expect(s).toContain('aria-pressed={gancho === g} onClick={() => setGancho(g)} className="opcion rounded-full"');
    // Las tarjetas de estilo usan un radio sr-only dentro de un label: globals.css les pone contorno.
    expect(fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")).toContain("label:has(input.sr-only:focus-visible)");
  });
});
