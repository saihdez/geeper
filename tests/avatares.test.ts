import { describe, expect, it } from "vitest";
import {
  ajustesEdicion, ajustesRetratos, ENCUADRE_AVATAR, ESTILOS, idDeAvatar, LORA_RETOQUE, MODELO_RETOQUE, MODELO_RETRATO, Pedido, promptDesdeFoto, promptRetoque, promptRetrato, RESOLUCION_RETRATO, TOMAS,
} from "@/lib/avatares";
import { camaraDe, promptConCamara } from "@/lib/prompt-camara";

describe("avatares: prompts", () => {
  it("el retrato lleva estilo, descripción, el encuadre que necesita InfiniteTalk, fondo y luz", () => {
    const p = promptRetrato(Pedido.parse({ descripcion: "mujer de 30 años, blusa blanca", estilo: "animado-3d", fondo: "oficina" }));
    expect(p.startsWith(ESTILOS["animado-3d"].prompt)).toBe(true);
    expect(p).toContain("mujer de 30 años, blusa blanca");
    expect(p).toContain(ENCUADRE_AVATAR);
    expect(p).toContain("mouth closed and relaxed");
    expect(p).toContain("blurred modern office");
    expect(p).toContain("soft even studio lighting"); // luz por defecto
  });

  it("luz y look de Cinematic Studio reemplazan la luz por defecto", () => {
    const p = promptRetrato(Pedido.parse({ descripcion: "x", luz: "hora-dorada", look: "noir" }));
    expect(p).toContain("golden-hour backlight");
    expect(p).toContain("high-contrast noir look");
    expect(p).not.toContain("soft even studio lighting");
  });

  it("desde una foto realista se pide conservar la identidad; animada, transformarla", () => {
    expect(promptDesdeFoto(Pedido.parse({ estilo: "realista" }))).toMatch(/^Keep the person photorealistic/);
    const a = promptDesdeFoto(Pedido.parse({ estilo: "anime", fondo: "estudio" }));
    expect(a).toMatch(/^Turn the person in the picture into a anime style/);
    expect(a).toContain("Replace the background with a softly lit studio");
  });

  it("el retoque conserva cara, estilo y encuadre", () => {
    expect(promptRetoque("  ponle lentes ")).toBe(
      "ponle lentes. Keep the same character, face, identity, art style, colors and proportions. Keep the exact same framing, zoom level, position and camera angle. Output one single clean image of the character. Keep the mouth closed and relaxed, facing the camera.",
    );
  });

  it("si la instrucción toca la boca, no pide boca cerrada (chocaba con «que se le vean los dientes»)", () => {
    for (const t of ["que se le vean mejor los dientes", "que sonría", "abre la boca", "make him smile"]) {
      const p = promptRetoque(t);
      expect(p).not.toContain("mouth closed");
      expect(p.endsWith("Facing the camera.")).toBe(true);
    }
  });

  it("«4k / máxima calidad» se cambia por nitidez (un editor no sube la resolución y redibujaba encima)", () => {
    const p = promptRetoque("Quiero que los dientes se vean mejor y sea 4k maxima calidad");
    expect(p).not.toMatch(/4k|calidad/i);
    expect(p).toContain("Quiero que los dientes se vean mejor.");
    expect(p).toContain("Make the lines, edges and details sharper and cleaner.");
    expect(promptRetoque("4k")).toMatch(/^Make the lines, edges and details sharper and cleaner\./);
    expect(promptRetoque("ponle una corona de rey")).toContain("ponle una corona de rey.");
    for (const t of ["hazlo en alta calidad", "que quede en HD"]) expect(promptRetoque(t)).toMatch(/^Make the lines/);
  });

  it("todo en positivo: no nombra defectos (con guía 1 no hay prompt negativo)", () => {
    expect(promptRetoque("ponle lentes")).not.toMatch(/\bno\b|without|double|ghost|blur/i);
  });
});

describe("avatares: ajustes de Wan2GP (validados con wgp.py --dry-run)", () => {
  it("retratos: Z-Image en modo imagen, 4 tomas, vertical", () => {
    const a = ajustesRetratos(Pedido.parse({ descripcion: "robot azul", semilla: 7 }));
    expect(a).toMatchObject({ model_type: MODELO_RETRATO, image_mode: 1, resolution: RESOLUCION_RETRATO, batch_size: TOMAS, seed: 7 });
  });

  it("sin descripción no hay retrato", () => {
    expect(() => ajustesRetratos(Pedido.parse({ descripcion: "  " }))).toThrow(/Describe a tu avatar/);
  });

  it("edición: Qwen Edit 2511 con la imagen como sujeto principal (KI) y Lightning de 4 pasos", () => {
    const a = ajustesEdicion("ponle lentes", ["/x/retrato.png"], 3);
    expect(a).toMatchObject({ model_type: MODELO_RETOQUE, image_mode: 1, video_prompt_type: "KI", image_refs: ["/x/retrato.png"], activated_loras: [LORA_RETOQUE], num_inference_steps: 4, guidance_scale: 1, seed: 3, batch_size: 1 });
    expect(() => ajustesEdicion("x", [])).toThrow(/referencia/);
  });

  it("ids legibles y sin acentos", () => {
    expect(idDeAvatar("Doctora Sofía", "3fa2")).toBe("doctora-sofia-3fa2");
    expect(idDeAvatar("¡¡!!", "00aa")).toBe("avatar-00aa");
  });
});

describe("prompt-camara: plano, luz y look (Cinematic Studio)", () => {
  it("el plano va antes de la escena y la luz y el look al final", () => {
    const c = camaraDe({ plano: "primero", luz: "ventana", look: "documental", movimiento: "acercar" });
    expect(promptConCamara("a lighthouse", c)).toBe("close-up portrait, a lighthouse, camera slowly pushes in, soft window light, natural documentary color");
  });

  it("rechaza opciones que no existen", () => {
    expect(() => camaraDe({ luz: "luna" })).toThrow(/Luz desconocido: luna/);
  });
});
