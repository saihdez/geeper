/** UX-36: las recetas de Workflows se muestran en español, con el nombre original debajo para buscarlo. */
import { describe, expect, it } from "vitest";
import { normalizarCatalogo } from "@/lib/comfyui";
import { RECETAS_ES, traducirReceta } from "@/lib/hub-comfy";
import { coincideBusqueda } from "@/lib/workflows-texto";

const indice = [
  {
    title: "Image",
    templates: [
      { name: "image_z_image_turbo", title: "Z-Image-Turbo: Text to Image", description: "An Efficient Image Generation Foundation Model." },
      { name: "receta_nueva_sin_traducir", title: "Brand New Recipe", description: "Not translated yet." },
    ],
  },
];

describe("recetas en español (UX-36)", () => {
  it("traduce título y descripción y guarda el título original", () => {
    const [w, nueva] = normalizarCatalogo(indice).map((x) => traducirReceta(x));
    expect(w!.titulo).toBe(RECETAS_ES.image_z_image_turbo!.titulo);
    expect(w!.titulo).not.toBe("Z-Image-Turbo: Text to Image");
    expect(w!.titulo).toContain("Z-Image-Turbo");
    expect(w!.descripcion).toBe(RECETAS_ES.image_z_image_turbo!.descripcion);
    expect(w!.original).toBe("Z-Image-Turbo: Text to Image");
    // Una receta nueva, sin traducción: se muestra como viene.
    expect(nueva).toMatchObject({ titulo: "Brand New Recipe", descripcion: "Not translated yet.", original: null });
  });

  it("si el título cambió desde que se tradujo, no pone una traducción vieja", () => {
    const tr = { r: { en: "Old Title", titulo: "Título viejo", descripcion: "Descripción vieja" } };
    expect(traducirReceta({ id: "r", titulo: "New Title", descripcion: "New" }, tr)).toEqual({ id: "r", titulo: "New Title", descripcion: "New", original: null });
    expect(traducirReceta({ id: "r", titulo: "Old Title", descripcion: "Old" }, tr)).toEqual({ id: "r", titulo: "Título viejo", descripcion: "Descripción vieja", original: "Old Title" });
  });

  it("un título que queda igual (un nombre propio) no repite el original; sin descripción traducida queda la de origen", () => {
    const tr = { r: { en: "HY 3D 2.0", titulo: "HY 3D 2.0", descripcion: "" } };
    expect(traducirReceta({ id: "r", titulo: "HY 3D 2.0", descripcion: "Mesh" }, tr)).toEqual({ id: "r", titulo: "HY 3D 2.0", descripcion: "Mesh", original: null });
    expect(traducirReceta({ id: "constructor", titulo: "x", descripcion: "" }, {})).toMatchObject({ original: null });
  });

  it("el buscador encuentra la receta también por su nombre en inglés", () => {
    const [w] = normalizarCatalogo(indice).map((x) => traducirReceta(x));
    expect(coincideBusqueda(w!, "text to image")).toBe(true);
    expect(coincideBusqueda(w!, "texto a imagen")).toBe(true);
  });

  it("el archivo de traducciones está completo y sin palabras rotas", () => {
    const filas = Object.entries(RECETAS_ES);
    expect(filas.length).toBeGreaterThan(700);
    for (const [id, r] of filas) {
      expect(r.en.trim(), id).not.toBe("");
      expect(r.titulo.trim(), id).not.toBe("");
      expect(`${r.titulo} ${r.descripcion}`, id).not.toMatch(/vídeo|Lérricas|Diversión|[ûàèìòù]/i);
    }
  });

  // Nombres propios de nodos o modelos que llevan palabras en inglés y se dejan como vienen.
  const NOMBRES_EN_INGLES = [/Join Image with Alpha/g];
  // Lo que va entre comillas o etiquetas es texto que la persona copia tal cual (frases clave, etiquetas).
  const LITERALES = [/"[^"]*"/g, /«[^»]*»/g, /<[^>]*>/g];
  const sinExcepciones = (t: string) => [...NOMBRES_EN_INGLES, ...LITERALES].reduce((s, re) => s.replace(re, " "), t);
  const PALABRAS_EN = /\b(the|and|with|to|of|for|your|from|this|that)\b/gi;

  it("ninguna descripción quedó en inglés", () => {
    const enIngles = Object.entries(RECETAS_ES)
      .filter(([, r]) => (sinExcepciones(r.descripcion).match(PALABRAS_EN) ?? []).length >= 4)
      .map(([id]) => id);
    expect(enIngles).toEqual([]);
    // La propia prueba detecta una descripción en inglés.
    expect(sinExcepciones("Reframe a finished clip to a new aspect ratio with the partner API for your channel.").match(PALABRAS_EN)!.length).toBeGreaterThanOrEqual(4);
  });

  it("los textos tratan de tú, no de usted", () => {
    const USTED = /\b(usted|ustedes|Genere|Seleccione|Utilice|Ingrese|Cargue|Elija|Introduzca|Proporcione|Suba|Haga|Escriba|Obtenga|Cree|Agregue|Añada|Pruebe|Descubra)\b/;
    const conUsted = Object.entries(RECETAS_ES)
      .filter(([, r]) => USTED.test(`${r.titulo} ${r.descripcion}`))
      .map(([id]) => id);
    expect(conUsted).toEqual([]);
  });

  it("no quedan los errores que encontró la revisión", () => {
    for (const [id, r] of Object.entries(RECETAS_ES)) {
      expect(`${r.titulo} ${r.descripcion}`, id).not.toMatch(/salida una|Finalizado|la Escena|alta volumen|\bprompts?\b|Image Stitch|Video Upscale:/);
    }
  });
});
