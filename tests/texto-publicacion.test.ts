import { describe, expect, it } from "vitest";
import { revisarTexto, bloquea } from "@/lib/redes/revision-texto";
import { armarSugerencia, hashtag, palabrasDescripcion, promptPublicacion, type DatosTexto } from "@/lib/texto-publicacion";

const base: DatosTexto = { red: "youtube", guion: "Así se ve la página por dentro.", nombre: "Demo de cap.so", duracion: 11 };
const json = (o: object) => `aquí va: ${JSON.stringify(o)} listo`;

describe("sugerencia de título y descripción", () => {
  it("pide largo según la duración y cuenta lo que se dice", () => {
    expect(palabrasDescripcion(30)).toEqual([15, 35]);
    expect(palabrasDescripcion(120)).toEqual([40, 80]);
    const p = promptPublicacion(base);
    expect(p).toContain("Así se ve la página por dentro.");
    expect(p).toContain("de 15 a 35 palabras");
  });

  it("limpia hashtags: sin #, sin relleno, sin repetidos, como mucho 5", () => {
    expect(hashtag("#Producto")).toBe("Producto");
    expect(hashtag("#fyp")).toBeNull();
    expect(hashtag("viral")).toBeNull();
    expect(hashtag("2026")).toBeNull();
    expect(hashtag("diseño web")).toBe("diseñoweb");
    const s = armarSugerencia(json({ titulo: "Mira cómo funciona", descripcion: "Te muestro la app. #demo", hashtags: ["#demo", "producto", "fyp", "app", "web", "saas", "extra"] }), base);
    const tags = s.descripcion.match(/#\S+/g)!;
    expect(tags).toEqual(["#demo", "#producto", "#app", "#web", "#saas"]);
    expect(s.descripcion.startsWith("Te muestro la app.")).toBe(true);
  });

  it("quita comillas y < > del título, recorta a 100 y pasa la revisión de YouTube", () => {
    const largo = "palabra ".repeat(30);
    const s = armarSugerencia(json({ titulo: `«<Hola> ${largo}»`, descripcion: "Algo <b>bonito</b>", hashtags: ["demo"] }), base);
    expect(s.titulo).not.toMatch(/[«»<>]/);
    expect(Array.from(s.titulo).length).toBeLessThanOrEqual(100);
    expect(s.descripcion).not.toMatch(/[<>]/);
    const problemas = revisarTexto({ red: "youtube", titulo: s.titulo, descripcion: s.descripcion, titulosPrevios: [], tituloSugerido: base.nombre, descripcionSugerida: "" });
    expect(bloquea(problemas)).toBe(false);
  });

  it("agrega el crédito del creador en los clips y rechaza términos prohibidos", () => {
    const s = armarSugerencia(json({ titulo: "Kai reacciona", descripcion: "Qué momento.", hashtags: ["gta6"] }), { ...base, credito: "Créditos: Kai (https://x.com)" });
    expect(s.descripcion).toBe("Qué momento.\n\nCréditos: Kai (https://x.com)\n\n#gta6");
    expect(() => armarSugerencia(json({ titulo: "Tráiler oficial filtrado", descripcion: "leak", hashtags: [] }), base)).toThrow(/términos/);
    expect(() => armarSugerencia("no sé", base)).toThrow(/no devolvió/);
  });
});

describe("lectura de la respuesta del modelo", () => {
  it("toma el último JSON aunque el razonamiento traiga llaves sueltas (gemma4 piensa en voz alta)", async () => {
    const { ultimoJson, limpiarSugerencias } = await import("@/lib/ganchos");
    const crudo = 'Thinking...\n* Formato: {"titulo": texto, "descripcion": texto}\n...done thinking.\n\n{"titulo": "Mira la app", "descripcion": "Te muestro todo.", "hashtags": ["app"]}\n';
    expect(ultimoJson(crudo)).toEqual({ titulo: "Mira la app", descripcion: "Te muestro todo.", hashtags: ["app"] });
    expect(armarSugerencia(crudo, base).titulo).toBe("Mira la app");
    expect(limpiarSugerencias('pienso {"ganchos": [x]} y\n{"ganchos": ["Nadie lo vio venir"], "titulo": null}').ganchos).toEqual(["Nadie lo vio venir"]);
    expect(ultimoJson("sin json")).toBeNull();
  });
});
