/** UX-11: los textos de las recetas se rotulan por su conexión y también se leen y cambian dentro de los subgrafos. */
import { describe, expect, it } from "vitest";
import { aplicarCambios, claseDeWidget, textosDeWorkflow, type GrafoUi } from "@/lib/comfyui";

const SUB = "9b1c2d3e-0000-4000-8000-123456789abc";

/** Como «SDXL Turbo»: dos CLIPTextEncode sin título; el primero de la lista va a «negative». */
const sdxl: GrafoUi = {
  nodes: [
    { id: 7, type: "CLIPTextEncode", widgets_values: ["text, watermark"], outputs: [{ links: [11] }] },
    { id: 6, type: "CLIPTextEncode", widgets_values: ["a cinematic photo of a fox"], outputs: [{ links: [10] }] },
    { id: 13, type: "SamplerCustom", inputs: [{ name: "model", link: 1 }, { name: "positive", link: 10 }, { name: "negative", link: 11 }] },
  ],
};

/** Como «Z-Image-Turbo»: el nodo de afuera del subgrafo no guarda valores; el texto vive adentro. */
const zimage: GrafoUi = {
  nodes: [{ id: 57, type: SUB, widgets_values: [], inputs: [] }],
  definitions: {
    subgraphs: [
      {
        id: SUB,
        inputs: [],
        links: [],
        nodes: [
          { id: 45, type: "CLIPTextEncode", widgets_values: ["A serene mountain lake at sunrise"], outputs: [{ links: [30] }] },
          { id: 46, type: "ConditioningZeroOut", inputs: [{ name: "conditioning", link: 30 }], outputs: [{ links: [31] }] },
          { id: 44, type: "KSampler", inputs: [{ name: "positive", link: 30 }, { name: "negative", link: 31 }] },
          { id: 40, type: "UNETLoader", widgets_values: ["z_image_turbo_bf16.safetensors", "default"] },
        ],
      },
    ],
  },
};

describe("textos de las recetas (UX-11)", () => {
  it("lo que entra por «negative» es lo que no se quiere, y va después de lo que se quiere", () => {
    expect(textosDeWorkflow(sdxl)).toEqual([
      { nodo: "6", indice: 0, etiqueta: "Qué quieres que salga", valor: "a cinematic photo of a fox" },
      { nodo: "7", indice: 0, etiqueta: "Lo que NO quieres que aparezca", valor: "text, watermark" },
    ]);
  });

  it("lee el texto de adentro del subgrafo y lo rotula por la conexión directa a «positive»", () => {
    expect(textosDeWorkflow(zimage)).toEqual([{ nodo: `${SUB}:45`, indice: 0, etiqueta: "Qué quieres que salga", valor: "A serene mountain lake at sunrise" }]);
  });

  it("cambia el texto de adentro del subgrafo sin tocar el original", () => {
    const nuevo = aplicarCambios(zimage, { textos: [{ nodo: `${SUB}:45`, indice: 0, valor: "un faro de noche" }] });
    expect(nuevo.definitions!.subgraphs![0]!.nodes![0]!.widgets_values).toEqual(["un faro de noche"]);
    expect(zimage.definitions!.subgraphs![0]!.nodes![0]!.widgets_values).toEqual(["A serene mountain lake at sunrise"]);
    expect(() => aplicarCambios(zimage, { textos: [{ nodo: `${SUB}:99`, indice: 0, valor: "x" }] })).toThrow(/ya no existe/);
  });

  it("un subgrafo que no se usa no aporta campos", () => {
    expect(textosDeWorkflow({ ...zimage, nodes: [] })).toEqual([]);
  });

  it("las instrucciones para la IA que mejora el pedido quedan aparte, para expertos", () => {
    const g: GrafoUi = {
      nodes: [
        { id: 1, type: "StringConcatenate", title: "System prompt", widgets_values: ["You are a prompt rewriter. Expand the user idea."] },
        { id: 2, type: "CLIPTextEncode", widgets_values: ["a red bicycle in the rain"] },
      ],
    };
    const t = textosDeWorkflow(g);
    expect(t.map((x) => [x.nodo, x.experto ?? false])).toEqual([["2", false], ["1", true]]);
    expect(t[1]!.etiqueta).toBe("Instrucciones para la IA que mejora tu pedido");
  });

  it("los nombres de los widgets dicen si un valor es un texto para la persona", () => {
    expect(claseDeWidget("negative_prompt")).toBe("negativo");
    expect(claseDeWidget("lyrics")).toBe("letra");
    expect(claseDeWidget("tags")).toBe("estilo");
    expect(claseDeWidget("text")).toBe("texto");
    expect(claseDeWidget("model_name")).toBe("no");
    expect(claseDeWidget("otra_cosa")).toBeNull();
  });
});
