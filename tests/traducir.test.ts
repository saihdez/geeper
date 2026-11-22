import { describe, expect, it } from "vitest";
import { VEL_MINIMA, VEL_SUAVE, ajusteVisual, leerPiezas, leerTraduccion, promptAcortar, promptTraduccion, vozDestino } from "@/lib/traducir";

describe("vozDestino", () => {
  it("conserva el género de la voz original", () => {
    expect(vozDestino("en", "ef_dora")).toBe("af_heart");
    expect(vozDestino("en", "em_alex")).toBe("am_michael");
    expect(vozDestino("pt", "em_alex")).toBe("pm_alex");
    expect(vozDestino("it", "ef_dora")).toBe("if_sara");
    expect(vozDestino("en", "kokoro:em_alex")).toBe("am_michael");
    expect(vozDestino("en", "kokoro:ef_dora")).toBe("af_heart");
  });
  it("francés sólo tiene voz femenina; una voz desconocida usa la femenina", () => {
    expect(vozDestino("fr", "em_alex")).toBe("ff_siwis");
    expect(vozDestino("en", "es-ES-ElviraNeural")).toBe("af_heart");
  });
});

describe("promptTraduccion", () => {
  it("lleva las escenas con su largo máximo, el idioma de origen y el de destino", () => {
    const t = promptTraduccion({ idioma: "en", de: "es", tema: "faros", escenas: [{ id: "e01", texto: "Hola", max: 40 }], textos: [{ id: "t1", texto: "Título" }] });
    expect(t).toContain("from Spanish into English");
    expect(t).toContain('"id":"e01"');
    expect(t).toContain('"max":40');
    expect(t).toContain('"id":"t1"');
  });
  it("una copia en inglés se traduce desde el inglés", () => {
    expect(promptTraduccion({ idioma: "pt", de: "en", tema: "x", escenas: [], textos: [] })).toContain("from English into Brazilian Portuguese");
  });
  it("el pedido para acortar lleva el guion de contexto", () => {
    expect(promptAcortar({ idioma: "en", guion: "one two three", escenas: [{ id: "e02", texto: "long", max: 10 }] })).toContain("one two three");
  });
});

describe("leerTraduccion", () => {
  const salida = 'Aquí va: {"escenas": [{"id": "e01", "texto": " “Hello there.” "}, {"id": "e02", "texto": "Bye  now"}, {"id": "zz", "texto": "extra"}], "textos": [{"id": "t1", "texto": "Title"}]}';
  it("toma un texto limpio por escena y descarta ids que no se pidieron", () => {
    const r = leerTraduccion(salida, ["e01", "e02"], ["t1", "t2"]);
    expect(r.escenas).toEqual({ e01: "Hello there.", e02: "Bye now" });
    expect(r.textos).toEqual({ t1: "Title" });
  });
  it("falla si falta una escena (una traducción a medias no sirve)", () => {
    expect(() => leerTraduccion(salida, ["e01", "e02", "e03"])).toThrow(/faltan 1 de 3/);
  });
  it("falla con un mensaje simple si no hay JSON", () => {
    expect(() => leerTraduccion("no sé", ["e01"])).toThrow(/formato esperado/);
  });
  it("leerPiezas acepta respuestas parciales (acortar es una mejora)", () => {
    expect(leerPiezas('{"escenas": [{"id": "e02", "texto": "Short"}]}', { escenas: ["e01", "e02"] }).escenas).toEqual({ e02: "Short" });
  });
});

describe("ajusteVisual", () => {
  it("una imagen o una voz que cabe no cambian nada", () => {
    expect(ajusteVisual(9, undefined, 1, VEL_SUAVE)).toEqual({ velocidad: 1, estado: "cabe" });
    expect(ajusteVisual(5, 6, 1, VEL_SUAVE)).toEqual({ velocidad: 1, estado: "cabe" });
  });
  it("si falta poco, el video va más lento justo lo necesario", () => {
    // 6 s de video para 7 s de voz: 0,857× (redondeado hacia abajo para que alcance).
    expect(ajusteVisual(7, 6, 1, VEL_SUAVE)).toEqual({ velocidad: 0.85, estado: "lento" });
  });
  it("si falta mucho, se queda en el piso y avisa", () => {
    expect(ajusteVisual(10, 6, 1, VEL_SUAVE)).toEqual({ velocidad: 0.8, estado: "falta" });
    expect(ajusteVisual(8.5, 6, 1, VEL_MINIMA)).toEqual({ velocidad: 0.7, estado: "lento" });
  });
  it("respeta la velocidad que ya tenía el clip", () => {
    // Ya iba a 2×: 6 s de video cubren 3 s; para 3,5 s de voz basta 1,71× (≥ 80 % de 2×).
    expect(ajusteVisual(3.5, 6, 2, VEL_SUAVE)).toEqual({ velocidad: 1.71, estado: "lento" });
    // Para 4 s haría falta 1,5×, más lento que el 80 % de 2×: se queda en 1,6× y avisa.
    expect(ajusteVisual(4, 6, 2, VEL_SUAVE)).toEqual({ velocidad: 1.6, estado: "falta" });
  });
});
