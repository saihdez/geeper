import { describe, expect, it } from "vitest";
import type { Grupo } from "@/lib/linea";
import { cpsDeGrupos, escenasConSubtitulosRapidos, revisarSubtitulos } from "@/lib/qc";

/** REN-04: las escenas con subtítulos rápidos se saben antes de renderizar, con la misma cuenta del QC. */
const grupo = (escena: string, texto: string, inicio: number, fin: number): Grupo => ({ fichas: [], texto, inicio, fin, escena });

describe("subtítulos rápidos antes de renderizar", () => {
  const grupos = [
    grupo("e01", "Hola a todos", 0.3, 1.5),
    // 40 caracteres en medio segundo: unos 80 car./s.
    grupo("e02", "Esto pasa muy rápido para poder leerlo ya", 1.6, 2.1),
    grupo("e02", "y esto también va rápido", 2.15, 2.5),
    grupo("e03", "Aquí ya se puede leer con calma", 2.6, 5),
  ];
  const fin = 6;

  it("marca sólo las escenas que pasan de 17 car./s, con su peor ritmo", () => {
    const r = escenasConSubtitulosRapidos(grupos, fin);
    expect(r.map((x) => x.escena)).toEqual(["e02"]);
    expect(r[0]!.cps).toBeGreaterThan(17);
    expect(r[0]!.cps).toBe(Number(Math.max(...cpsDeGrupos(grupos, fin).slice(1, 3)).toFixed(1)));
  });

  it("coincide con lo que rechazaría la regla del QC", () => {
    const qc = revisarSubtitulos("9:16", grupos, fin);
    const rapidos = cpsDeGrupos(grupos, fin).filter((c) => c > 17).length;
    expect(qc.malos.length).toBe(rapidos);
    expect(qc.peorCps).toBeCloseTo(Math.max(...cpsDeGrupos(grupos, fin)), 2);
  });

  it("sin grupos rápidos no devuelve nada", () => {
    expect(escenasConSubtitulosRapidos([grupos[0]!, grupos[3]!], fin)).toEqual([]);
  });
});
