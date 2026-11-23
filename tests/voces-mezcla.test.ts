/** UX-12: rehacer la voz de una escena tras elegir otra voz dejaba el video con dos voces, sin aviso. */
import { describe, expect, it } from "vitest";
import { avisoMezclaVoces } from "@/lib/ediciones";

const voces = { elegida: "em_alex", nombres: { ef_dora: "Dora", em_alex: "Álex", af_bella: "Bella" } as Record<string, string> };
/** Escenas como las da la vista: la voz ya sin «kokoro:» (idDeVoz); null = voz real de un clip. */
const escenas = (xs: (string | null)[]) => xs.map((voz, indice) => ({ indice, voz: { voz } }));

describe("Aviso de voces mezcladas para la revisión final (UX-12)", () => {
  it("nombra las escenas que no tienen la voz más usada", () => {
    expect(avisoMezclaVoces(escenas(["ef_dora", "ef_dora", "em_alex"]), voces)).toBe("El video mezcla dos voces: Dora y Álex (escena 3).");
  });

  it("si empatan, la principal es la elegida", () => {
    expect(avisoMezclaVoces(escenas(["ef_dora", "em_alex"]), voces)).toBe("El video mezcla dos voces: Álex y Dora (escena 1).");
  });

  it("los números van en palabras también con tres voces", () => {
    expect(avisoMezclaVoces(escenas(["ef_dora", "ef_dora", "em_alex", "af_bella"]), voces)).toBe(
      "El video mezcla tres voces: Dora, Álex y Bella (escenas 3 y 4).",
    );
  });

  it("con una sola voz, o la voz real de un clip, no avisa", () => {
    expect(avisoMezclaVoces(escenas(["ef_dora", "ef_dora"]), voces)).toBeNull();
    expect(avisoMezclaVoces(escenas([null, "ef_dora", "ef_dora"]), voces)).toBeNull();
    expect(avisoMezclaVoces(escenas(["ef_dora", "em_alex"]), null)).toBe("El video mezcla dos voces: ef_dora y em_alex (escena 2).");
  });
});
