import { describe, expect, it } from "vitest";
import { sugerirGlosario, sumarAlGlosario } from "@/lib/glosario";

describe("sugerirGlosario", () => {
  it("saca nombres propios de un título normal y el canal", () => {
    expect(sugerirGlosario("Kai Cenat juega GTA VI por primera vez en Vice City", "Kai Cenat Live")).toEqual(["Kai Cenat Live", "Kai Cenat", "GTA VI", "Vice City"]);
  });

  it("un título corto con muchos nombres sigue siendo normal si tiene palabras en minúscula", () => {
    expect(sugerirGlosario("Kai Cenat juega GTA VI en Vice City", null)).toEqual(["Kai Cenat", "GTA VI", "Vice City"]);
  });

  it("no toma la primera palabra de una frase si es común", () => {
    expect(sugerirGlosario("La policía persigue a Lucia en Leonida", null)).toEqual(["Lucia", "Leonida"]);
    expect(sugerirGlosario("Cómo ganar en Fortnite | Parte 2", null)).toEqual(["Fortnite"]);
  });

  it("de un título gritado sólo toma siglas", () => {
    expect(sugerirGlosario("KAI PIERDE LA CABEZA EN GTA 6", "KaiCenat")).toEqual(["KaiCenat", "GTA 6"]);
  });

  it("de un título En Mayúscula Cada Palabra sólo toma siglas", () => {
    expect(sugerirGlosario("How I Beat Elden Ring In One Hour", "streamer")).toEqual(["streamer"]);
  });

  it("acepta hashtags, quita @ del canal y no repite", () => {
    expect(sugerirGlosario("Mejores momentos de #Minecraft con Auron y auron", "@ElRubius")).toEqual(["ElRubius", "Minecraft", "Auron"]);
  });

  it("título vacío o sin nombres", () => {
    expect(sugerirGlosario("", null)).toEqual([]);
    expect(sugerirGlosario("mejores momentos del directo", null)).toEqual([]);
  });
});

describe("sumarAlGlosario", () => {
  it("agrega al final sin repetir", () => {
    expect(sumarAlGlosario("", "Lucia")).toBe("Lucia");
    expect(sumarAlGlosario("Lucia,  Vice City ", "GTA VI")).toBe("Lucia, Vice City, GTA VI");
    expect(sumarAlGlosario("Lucia", "lucia")).toBe("Lucia");
  });
});
