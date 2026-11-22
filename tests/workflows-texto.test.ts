/** UX-04: el ejemplo de una receta sólo cuenta si existe; si no, hay que subir el archivo antes de «Crear». */
import { describe, expect, it } from "vitest";
import { entradasSinArchivo, hayEjemplo, textoFaltaArchivo } from "@/lib/workflows-texto";

describe("ejemplos de las recetas (UX-04)", () => {
  it("un ejemplo cuenta si está en el catálogo o ya en ComfyUI/input", () => {
    expect(hayEjemplo("chica.png", { "chica.png": "input/chica.png" }, () => false)).toBe(true);
    expect(hayEjemplo("lily.png", {}, (n) => n === "lily.png")).toBe(true);
    expect(hayEjemplo("the_lily_veil.png", {}, () => false)).toBe(false);
    expect(hayEjemplo(null, { null: "x" }, () => true)).toBe(false);
    expect(hayEjemplo("toString", {}, () => false)).toBe(false);
  });

  it("faltan las entradas sin archivo propio ni ejemplo", () => {
    const entradas = [
      { nodo: 3, archivo: "a.png", medio: "image" },
      { nodo: 9, archivo: null, medio: "video" },
      { nodo: 12, archivo: "b.wav", medio: "audio" },
    ];
    const ejemplo = (e: { archivo: string | null }) => e.archivo === "a.png";
    expect(entradasSinArchivo(entradas, [], ejemplo).map((e) => e.nodo)).toEqual([9, 12]);
    expect(entradasSinArchivo(entradas, ["9", 12], ejemplo)).toEqual([]);
  });

  it("lo dice en palabras simples", () => {
    expect(textoFaltaArchivo(["image"])).toBe("Falta subir tu imagen.");
    expect(textoFaltaArchivo(["image", "image", "video"])).toBe("Falta subir tu imagen y tu video.");
    expect(textoFaltaArchivo(["image", "video", "audio"])).toBe("Falta subir tu imagen, tu video y tu audio.");
  });
});
