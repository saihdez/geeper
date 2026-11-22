/** UX-12 (parte del editor): no dejar el video con dos voces sin avisar. */
import { describe, expect, it } from "vitest";
import { escenasConOtraVoz, preguntaVozEscena } from "@/components/editor-estado";
import { idDeVoz, nombreDeVoz } from "@/lib/vista";

const esc = (id: string, indice: number, voz: string | null) => ({ id, indice, voz: { voz } });
const voces = { elegida: "em_alex", nombres: { em_alex: "Álex", ef_dora: "Dora" } };

describe("voces mezcladas (UX-12)", () => {
  it("iguala «kokoro:ef_dora» y «ef_dora», y da el nombre de la voz", () => {
    expect(idDeVoz("kokoro:ef_dora")).toBe("ef_dora");
    expect(idDeVoz("ef_dora")).toBe("ef_dora");
    expect(idDeVoz(undefined)).toBeNull();
    expect(nombreDeVoz("em_alex")).toBe("Álex");
    expect(nombreDeVoz("v-abc", [{ id: "v-abc", nombre: "Mi voz" }])).toBe("Mi voz");
  });

  it("antes de regenerar una escena con otra voz, pregunta con cuántas quedan", () => {
    const escenas = [esc("e1", 0, "ef_dora"), esc("e2", 1, "ef_dora"), esc("e3", 2, "ef_dora")];
    expect(preguntaVozEscena("e3", escenas, voces)).toBe("Esta escena quedará con la voz Álex y las otras 2 escenas seguirán con Dora.");
  });

  it("si el resto ya suena con la elegida, o la voz se desconoce, no pregunta", () => {
    expect(preguntaVozEscena("e2", [esc("e1", 0, "em_alex"), esc("e2", 1, "ef_dora")], voces)).toBeNull();
    expect(preguntaVozEscena("e2", [esc("e1", 0, null), esc("e2", 1, "ef_dora")], voces)).toBeNull();
    expect(preguntaVozEscena("e1", [esc("e1", 0, "ef_dora")], { elegida: null, nombres: {} })).toBeNull();
  });

  it("dice qué escenas suenan con otra voz que la elegida", () => {
    expect(escenasConOtraVoz([esc("e1", 0, "ef_dora"), esc("e2", 1, "em_alex"), esc("e3", 2, null)], "em_alex")).toEqual([1]);
    expect(escenasConOtraVoz([esc("e1", 0, "ef_dora")], null)).toEqual([]);
  });
});
