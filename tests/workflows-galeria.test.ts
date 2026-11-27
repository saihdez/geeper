/** UX-25: miniaturas que existen (o un dibujo por tipo) y un buscador que entiende las palabras en español. */
import { describe, expect, it } from "vitest";
import { normalizarCatalogo } from "@/lib/comfyui";
import { coincideBusqueda, iconoDeTipo, tipoMiniatura } from "@/lib/workflows-texto";

const receta = (titulo: string, descripcion = "", extra: Partial<{ etiquetas: string[]; modelos: string[]; categoria: string; tipo: string }> = {}) => ({
  titulo, descripcion, etiquetas: [], modelos: [], categoria: "Imágenes", tipo: "image", ...extra,
});

describe("buscador de recetas (UX-25)", () => {
  it("entiende las palabras que sugiere el campo, con o sin tildes", () => {
    expect(coincideBusqueda(receta("Flux Portrait Master"), "retrato")).toBe(true);
    expect(coincideBusqueda(receta("ACE-Step v1.5", "Generate a song from lyrics", { categoria: "Audio y música", tipo: "audio" }), "música")).toBe(true);
    expect(coincideBusqueda(receta("BiRefNet", "Remove background from any image"), "quitar fondo")).toBe(true);
    expect(coincideBusqueda(receta("Chatterbox TTS", "Text to speech"), "voz")).toBe(true);
    expect(coincideBusqueda(receta("Wan 2.2 Image-to-Video"), "imagen a video")).toBe(true);
    expect(coincideBusqueda(receta("SDXL Turbo"), "foto")).toBe(true); // por el tipo «image»
  });

  it("cada palabra cuenta: lo que no tiene que ver no sale", () => {
    expect(coincideBusqueda(receta("Flux Portrait Master"), "música")).toBe(false);
    expect(coincideBusqueda(receta("Flux Portrait Master"), "retrato zzz")).toBe(false);
    expect(coincideBusqueda(receta("Flux Portrait Master"), "  ")).toBe(true);
    expect(coincideBusqueda(receta("LTX-2 Video", "", { tipo: "video" }), "ltx 2")).toBe(true);
  });
});

describe("miniaturas de la galería (UX-25)", () => {
  it("prueba también «-2.webp» y, en las de audio, «-1.mp3»; primero imágenes, después video y audio", () => {
    const indice = [{ title: "Audio", templates: [
      { name: "ace_step", mediaType: "audio", thumbnail: ["thumbnail/ace_step.mp4"] },
      { name: "solo_dos", mediaType: "image" },
      { name: "nada", mediaType: "image" },
    ] }];
    const archivos = { "ace_step.mp4": "/a", "ace_step-1.mp3": "/b", "solo_dos-2.webp": "/c" };
    const [ace, dos, nada] = normalizarCatalogo(indice, archivos);
    expect(ace!.miniaturas).toEqual(["ace_step.mp4", "ace_step-1.mp3"]);
    expect(dos!.miniaturas).toEqual(["solo_dos-2.webp"]);
    expect(nada!.miniaturas).toEqual([]);
  });

  it("cómo se muestra cada archivo, y un dibujo por tipo cuando no hay ninguno", () => {
    expect(tipoMiniatura("x-1.webp")).toBe("imagen");
    expect(tipoMiniatura("x.mp4")).toBe("video");
    expect(tipoMiniatura("x-1.mp3")).toBe("audio");
    expect(tipoMiniatura("x.json")).toBeNull();
    expect(iconoDeTipo("audio")).toBe("🎵");
    expect(iconoDeTipo("raro")).toBe("✨");
  });
});
