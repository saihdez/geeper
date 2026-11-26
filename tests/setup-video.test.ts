import { describe, expect, it } from "vitest";
import { EstiloVideo } from "@/lib/esquema";
import { ESTILOS_GENERACION, pasosDe, tiempoEstimado } from "@/lib/estilos-generacion";
import { CAMARAS, NOMBRES, promptConCamara } from "@/lib/prompt-camara";
import { animarDe, estiloVideoDe, mismoSetup, necesitaPasoAnimar, pasosSetup, promptSetup, SetupVideo } from "@/lib/setup-video";
import { modeloPlano } from "@/lib/wan2gp";

const BASE: SetupVideo = { modelo: "i2v", fluidez: true, camara: {}, desenfoqueMovimiento: false, grano: "no", vineta: false, realista: false };

describe("setup del video («Personalizar el setup» de «Nuevo»)", () => {
  it("cada preset es un setup válido y sus modelos existen", () => {
    for (const d of Object.values(ESTILOS_GENERACION)) {
      expect(SetupVideo.parse(d.setup)).toEqual(d.setup);
      const a = animarDe(d.setup);
      if (a) expect(() => modeloPlano(a.modelo)).not.toThrow();
    }
  });

  it("película de 35 mm, 35 mm de focal y desenfoque de movimiento llegan al prompt", () => {
    const s = SetupVideo.parse({ ...BASE, camara: { camara: "pelicula-35mm", focal: 35, apertura: "f/1.4", movimiento: "mano" }, desenfoqueMovimiento: true, grano: "35mm", realista: true });
    const { prompt, negativo } = promptSetup(s, "a man walks in the rain.");
    expect(prompt).toMatch(/180-degree shutter/);
    expect(prompt).toMatch(/35mm film grain/);
    expect(negativo).not.toMatch(/blurry/);
    const conCamara = promptConCamara(prompt, animarDe(s)!.camara);
    expect(conCamara).toMatch(/35mm motion picture film camera/);
    expect(conCamara).toMatch(/at 35mm/);
    expect(conCamara).toMatch(/shallow depth of field/);
    expect(Object.keys(NOMBRES.camara).sort()).toEqual(Object.keys(CAMARAS).sort());
  });

  it("valida lo que llega de la API", () => {
    expect(() => SetupVideo.parse({ ...BASE, camara: { focal: 33 } })).toThrow();
    expect(() => SetupVideo.parse({ ...BASE, modelo: "ltx2" })).toThrow();
    expect(() => SetupVideo.parse({ ...BASE, grano: "8mm" })).toThrow();
  });

  it("Lightning va siempre con el I2V 14B; RIFE sólo con él (sale a 16 cuadros por segundo)", () => {
    expect(animarDe(BASE)!.extra).toMatchObject({ num_inference_steps: 4, temporal_upsampling: "rife*2" });
    expect(animarDe({ ...BASE, fluidez: false })!.extra).not.toHaveProperty("temporal_upsampling");
    expect(animarDe({ ...BASE, modelo: "rapido" })!.extra).toBeUndefined();
    expect(animarDe({ ...BASE, modelo: "zoom" })).toBeNull();
    expect(pasosSetup({ ...BASE, modelo: "ti2v" }).map((x) => x.paso)).not.toContain("Fluidez");
  });

  it("grano y viñeta van al estilo del video; el zoom con grano igual pasa por el paso de acabado", () => {
    const e = EstiloVideo.parse(estiloVideoDe({ ...BASE, grano: "16mm", vineta: true }));
    expect(e.efectos!.map((x) => x.tipo)).toEqual(["vineta", "grano"]);
    expect(estiloVideoDe(BASE)).toBeUndefined();
    expect(necesitaPasoAnimar({ ...BASE, modelo: "zoom" })).toBe(false);
    expect(necesitaPasoAnimar({ ...BASE, modelo: "zoom", grano: "fino" })).toBe(true);
  });

  it("sabe si se personalizó, y lo que tarda sale del modelo elegido", () => {
    const real = ESTILOS_GENERACION.real.setup;
    expect(mismoSetup(real, { ...real, camara: { ...real.camara, lente: undefined } })).toBe(true);
    expect(mismoSetup(real, { ...real, grano: "35mm" })).toBe(false);
    expect(tiempoEstimado({ ...real, modelo: "rapido" })).toMatch(/^2 minutos por escena/);
    expect(tiempoEstimado({ ...real, modelo: "zoom" })).toBe("Estimado: medio minuto por escena, unos 5 minutos en un video de 6 escenas.");
  });

  it("con avatar, del setup sólo se muestra el acabado", () => {
    const pasos = pasosDe({ ...BASE, grano: "35mm", desenfoqueMovimiento: true }, true);
    expect(pasos.find((x) => x.paso === "Acabado")?.workflow).toBe("Grano de 35mm");
    expect(pasos.map((x) => x.paso)).not.toContain("Video");
  });
});
