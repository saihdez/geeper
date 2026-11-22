/** UX-12: rehacer la voz de una escena tras elegir otra voz dejaba el video con dos voces, sin aviso. */
import { describe, expect, it } from "vitest";
import { avisoMezclaVoces, avisoVozDeEscena, claveVoz, escenasConOtraVoz, vocesDeEscenas } from "@/lib/ediciones";
import { pista, type Proyecto } from "@/lib/esquema";
import { proyectoDePrueba } from "./fixtures";

const NOMBRES: Record<string, string> = { ef_dora: "Dora", em_alex: "Álex" };
const nombre = (v: string) => NOMBRES[v] ?? v;

/** Proyecto de 3 escenas: cada una con su asset de voz (`voces[i]`; null = voz real de un clip). */
function conVoces(elegida: string, voces: (string | null)[]): Proyecto {
  const p = proyectoDePrueba();
  p.voz.voz = elegida;
  pista(p, "voz").clips.forEach((c, i) => {
    const id = `voz-${i}`;
    const v = voces[i];
    p.assets[id] = {
      id, tipo: "audio", ruta: `assets/${id}.wav`, hash: "a".repeat(64), licencia: "x", duracion: 3,
      source: v === null ? "archivo" : i === 0 ? "mpt" : "tts",
      regenerar: v === null ? {} : { voz: v },
    };
    c.asset = id;
  });
  return p;
}

describe("Voces del video (UX-12)", () => {
  it("«kokoro:ef_dora» (MPT) y «ef_dora» son la misma voz", () => {
    expect(claveVoz("kokoro:ef_dora")).toBe("ef_dora");
    const p = conVoces("ef_dora", ["kokoro:ef_dora", "ef_dora", "ef_dora"]);
    expect(vocesDeEscenas(p).map((x) => x.voz)).toEqual(["ef_dora", "ef_dora", "ef_dora"]);
    expect(avisoMezclaVoces(p)).toBeNull();
    expect(escenasConOtraVoz(p)).toEqual([]);
  });

  it("antes de rehacer una escena con otra voz elegida, avisa cómo queda", () => {
    const p = conVoces("em_alex", ["kokoro:ef_dora", "ef_dora", "ef_dora"]);
    expect(avisoVozDeEscena(p, "e03", nombre)).toBe("Esta escena quedará con la voz Álex y las otras 2 con Dora.");
    // Con la misma voz que las demás, nada que avisar.
    expect(avisoVozDeEscena(conVoces("ef_dora", ["ef_dora", "ef_dora", "em_alex"]), "e03", nombre)).toBeNull();
  });

  it("mientras la voz elegida no sea la que suena, dice en qué escenas", () => {
    const p = conVoces("em_alex", ["kokoro:ef_dora", "em_alex", "ef_dora"]);
    expect(escenasConOtraVoz(p).map((x) => x.numero)).toEqual([1, 3]);
  });

  it("en la revisión final avisa si el video mezcla voces, nombrando las escenas distintas", () => {
    expect(avisoMezclaVoces(conVoces("em_alex", ["ef_dora", "ef_dora", "em_alex"]), nombre)).toBe("El video mezcla dos voces: Dora y Álex (escena 3).");
  });

  it("la voz real de un clip no cuenta", () => {
    const p = conVoces("em_alex", [null, "ef_dora", "ef_dora"]);
    expect(avisoMezclaVoces(p)).toBeNull();
    expect(vocesDeEscenas(p)[0]!.voz).toBeNull();
  });
});
