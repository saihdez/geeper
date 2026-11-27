/** UX-12 (parte del editor): no dejar el video con dos voces sin avisar. */
import { describe, expect, it } from "vitest";
import { escenasConOtraVoz, preguntaVozEscena } from "@/components/editor-estado";
import { claveVoz } from "@/lib/ediciones";
import { nombreDeVoz } from "@/lib/vista";
import fs from "node:fs";
import path from "node:path";

const vista = fs.readFileSync(path.join(process.cwd(), "src", "lib", "vista.ts"), "utf8");

const esc = (id: string, indice: number, voz: string | null) => ({ id, indice, voz: { voz } });
const voces = { elegida: "em_alex", nombres: { em_alex: "Álex", ef_dora: "Dora" } };

describe("voces mezcladas (UX-12)", () => {
  it("iguala «kokoro:ef_dora» y «ef_dora», y da el nombre de la voz", () => {
    expect(claveVoz("kokoro:ef_dora")).toBe("ef_dora");
    expect(claveVoz("EF_Dora")).toBe("ef_dora");
    expect(nombreDeVoz("em_alex")).toBe("Álex");
    expect(nombreDeVoz("v-abc", [{ id: "v-abc", nombre: "Mi voz" }])).toBe("Mi voz");
    // La voz diseñada se encuentra aunque su id tenga mayúsculas (claveVoz pasa a minúsculas).
    expect(nombreDeVoz(claveVoz("V-Abc"), [{ id: "V-Abc", nombre: "Mi voz" }])).toBe("Mi voz");
  });

  it("la vista usa la misma cuenta que la revisión final (ediciones.ts), no una propia", () => {
    expect(vista).toContain("vocesDeEscenas(proyecto)");
    expect(vista).not.toMatch(/function idDeVoz/);
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

describe("rehacer la voz de varias escenas en un solo trabajo (GPU-07)", () => {
  const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

  it("junta los ids de las escenas que suenan con otra voz", async () => {
    const { idsConOtraVoz } = await import("@/components/editor-estado");
    const escenas = [esc("e1", 0, "em_alex"), esc("e2", 1, "ef_dora"), esc("e3", 2, null), esc("e4", 3, "ef_dora")];
    expect(idsConOtraVoz(escenas, "em_alex")).toEqual(["e2", "e4"]);
    expect(idsConOtraVoz(escenas, null)).toEqual([]);
  });

  it("el botón manda la lista a la ruta de voz en un solo pedido", () => {
    expect(editor).toContain("postJson(`/api/proyectos/${id}/voz`, { escenas: ids })");
    expect(editor).toMatch(/onClick=\{\(\) => void rehacerVoces\(idsConOtraVoz\(escenas, [^)]*\), otraVoz\)\}>Rehacer la voz de las escenas cambiadas<\/button>/);
  });
});
