import { describe, expect, it } from "vitest";
import { inventos, pareceEspanol, revisarDirector, revisarGanchos, revisarIdeas, revisarTitulos } from "@/lib/evals";

const momento = "Llevo tres horas intentando pasar este jefe y justo cuando le quedaba un golpe se me cortó la luz de toda la casa.";

describe("reglas de las evals (C3)", () => {
  it("detecta nombres y cifras inventados, no los que estaban ni los que abren frase", () => {
    expect(inventos("El faro de la isla de Somme. Así sube 120 escalones.", "sube 120 escalones")).toEqual(["Somme"]);
    expect(inventos("Lo vio en YouTube y en GTA 6.", "x")).toEqual(["6"]);
    expect(inventos("Cuando se cortó la luz. Nadie lo esperaba.", momento)).toEqual([]);
  });

  it("idioma aproximado", () => {
    expect(pareceEspanol("Cuando el faro se apaga nadie lo nota")).toBe(true);
    expect(pareceEspanol("When the lighthouse goes dark nobody notices it")).toBe(false);
  });

  it("ganchos: aprueba lo correcto y explica cada falla", () => {
    const bueno = JSON.stringify({ ganchos: ["Se cortó la luz en el peor momento", "Tres horas para esto", "Cuando el jefe ya caía"], titulo: "Se le cortó la luz" });
    expect(revisarGanchos(bueno, momento)).toMatchObject({ pass: true });
    const malo = JSON.stringify({ ganchos: ["«Me voy» dijo Marcos", "Hola", "El tráiler oficial filtrado de GTA"], titulo: "x" });
    const v = revisarGanchos(malo, momento);
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/comillas/);
    expect(v.reason).toMatch(/1 palabras/);
    expect(v.reason).toMatch(/prohibidos/);
    expect(v.reason).toMatch(/Marcos/);
    expect(revisarGanchos('{"otra":1}', momento).reason).toMatch(/0 ganchos/);
    expect(revisarGanchos('{"ganchos":"no"}', momento).reason).toMatch(/esquema/);
  });

  it("títulos: largo, repetidos, hashtags", () => {
    expect(revisarTitulos(JSON.stringify({ titulos: ["Faros que nadie visita", "¿Por qué siguen encendidos?", "La noche del farero"] }), "faros farero")).toMatchObject({ pass: true });
    const v = revisarTitulos(JSON.stringify({ titulos: ["Faros #viral", "faros #viral", "x".repeat(60)] }), "faros");
    expect(v.reason).toMatch(/repetidos/);
    expect(v.reason).toMatch(/hashtag/);
    expect(v.reason).toMatch(/60 caracteres/);
  });

  it("ideas de anuncio: guion de 45 a 90 palabras y sin cifras sin respaldo", () => {
    const guion = (extra = "") => `Abre la app y mira la marea antes de salir. ${"Sabes cuándo entrar al agua y cuándo esperar en la arena con calma. ".repeat(4)}${extra}Pruébala gratis hoy.`;
    const ideas = (g: string) => JSON.stringify({ conceptos: ["Uno", "Dos", "Tres"].map((n, i) => ({ nombre: n, gancho: `Gancho ${i}`, guion: g })) });
    expect(revisarIdeas(ideas(guion()), "prueba gratis")).toMatchObject({ pass: true });
    expect(revisarIdeas(ideas(guion("El 87% de los surfistas la usa. ")), "prueba gratis").reason).toMatch(/cifras sin respaldo \(87%\)/);
  });

  it("director: contrato, duración y narración que cabe", () => {
    const escena = (id: string, narracion: string, duracionEstimada: number) => ({ id, narracion, plano: { tipo: "generado", descripcion: "Un faro de noche" }, duracionEstimada });
    const ok = { titulo: "Faros", tema: "faros", duracionObjetivo: 30, escenas: [escena("e01", "Los faros siguen encendidos.", 10), escena("e02", "Aunque los barcos usan otra cosa.", 10), escena("e03", "Y alguien los cuida.", 10)] };
    expect(revisarDirector(JSON.stringify(ok), "Por qué los faros siguen encendidos", 30)).toMatchObject({ pass: true });
    const largo = { ...ok, escenas: [escena("e01", "sol ".repeat(100), 5)] };
    const v = revisarDirector(JSON.stringify(largo), "faros", 30);
    expect(v.reason).toMatch(/dura 5 s/);
    expect(v.reason).toMatch(/narración de ~40 s/);
    expect(revisarDirector('{"titulo":"x"}', "x", 30).reason).toMatch(/contrato/);
  });
});
