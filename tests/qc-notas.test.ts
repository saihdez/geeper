import { describe, expect, it } from "vitest";
import { reglaNotasEnSubtitulos } from "@/lib/qc";
import { explicar } from "@/lib/qc-explicado";

describe("regla notas-en-subtitulos", () => {
  it("bloquea notas de trabajo en pantalla (pasó con «(corregido)» en un render)", () => {
    const r = reglaNotasEnSubtitulos([
      { texto: "(corregido) los faros han servido", inicio: 1.2 },
      { texto: "como guías [pulso] vitales", inicio: 3 },
      { texto: "Hola {{marca}}", inicio: 5 },
      { texto: "TODO: cambiar cifra", inicio: 7 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.medido).toBe(4);
    expect(r.detalle).toMatch(/1\.2 s: «\(corregido\)/);
    expect(explicar("notas-en-subtitulos").hacer).toMatch(/quita la nota/);
  });

  it("no confunde texto normal (paréntesis, mayúsculas de énfasis, «todo»)", () => {
    const r = reglaNotasEnSubtitulos([
      { texto: "los faros (y sus fareros) lo dan TODO", inicio: 0 },
      { texto: "sobre todo de noche", inicio: 2 },
      { texto: "XXL no, sólo un faro", inicio: 4 },
    ]);
    expect(r.ok).toBe(true);
  });
});
