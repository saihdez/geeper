import { describe, expect, it } from "vitest";
import { EstiloVideo } from "@/lib/esquema";
import { ESTILO_POR_DEFECTO, ESTILOS_GENERACION, NEGATIVO_REALISTA, promptEstilo, tiempoEstimado } from "@/lib/estilos-generacion";
import { modeloPlano } from "@/lib/wan2gp";

describe("estilos de generación de «Nuevo»", () => {
  it("por defecto, el rápido (lo de siempre, sin animar)", () => {
    expect(ESTILO_POR_DEFECTO).toBe("rapido");
    expect(ESTILOS_GENERACION.rapido.animar).toBeNull();
  });

  it("los que animan usan modelos que existen; «lo más real» usa el I2V-A14B fiel a la foto", () => {
    for (const d of Object.values(ESTILOS_GENERACION)) if (d.animar) expect(() => modeloPlano(d.animar!.modelo)).not.toThrow();
    expect(modeloPlano(ESTILOS_GENERACION.real.animar!.modelo).necesitaImagen).toBe(true);
    expect(ESTILOS_GENERACION.real.medido).toBe(false);
  });

  it("el estilo que se guarda en el proyecto es válido (grano fino en «lo más real»)", () => {
    const e = EstiloVideo.parse(ESTILOS_GENERACION.real.estilo);
    expect(e.efectos?.[0]).toMatchObject({ tipo: "grano" });
    expect((e.efectos?.[0] as { cantidad: number }).cantidad).toBeLessThan(0.1);
  });

  it("el prompt realista suma lo de cámara real y un negativo contra el aspecto IA", () => {
    const r = promptEstilo("real", "una mujer camina por el mercado. ");
    expect(r.prompt.startsWith("una mujer camina por el mercado. real footage")).toBe(true);
    expect(r.negativo).toBe(NEGATIVO_REALISTA);
    expect(r.negativo).toMatch(/plastic skin/);
    expect(promptEstilo("rapido", "x.")).toEqual({ prompt: "x" });
    expect(promptEstilo("real", "  ").prompt).toMatch(/^real footage/);
  });

  it("dice cuánto tarda, y si es estimado", () => {
    expect(tiempoEstimado("rapido")).toBe("Unos 3 minutos por tema.");
    expect(tiempoEstimado("equilibrado", 6)).toBe("2 minutos por escena, unos 15 minutos en un video de 6 escenas.");
    expect(tiempoEstimado("real", 6)).toBe("Estimado: 15 minutos por escena, unas 2 horas en un video de 6 escenas.");
  });
});

describe("paso «escenas.animar»", () => {
  it("anima sólo las escenas que siguen con la imagen de MPT (no las que rehízo el avatar)", async () => {
    const { escenasParaAnimar } = await import("@/lib/animar-escenas");
    const { proyectoDePrueba } = await import("./fixtures");
    const p = proyectoDePrueba();
    expect(escenasParaAnimar(p).map((x) => x.numero)).toEqual([1, 2, 3]);
    p.assets["clip-02"] = { ...p.assets["clip-02"]!, source: "wan" };
    expect(escenasParaAnimar(p).map((x) => x.numero)).toEqual([1, 3]);
  });

  it("«lo más real» suma el grano al estilo del video sin duplicarlo ni borrar otros efectos", async () => {
    const { conEstiloVideo } = await import("@/lib/animar-escenas");
    const { proyectoDePrueba } = await import("./fixtures");
    const p = { ...proyectoDePrueba(), estilo: { efectos: [{ tipo: "vineta" as const, cantidad: 0.3, angulo: 60 }, { tipo: "grano" as const, cantidad: 0.5, color: true, semilla: 1 }] } };
    const r = conEstiloVideo(p, "real")!;
    expect(r.estilo!.efectos!.map((e) => e.tipo)).toEqual(["vineta", "grano"]);
    expect(r.estilo!.efectos![1]).toMatchObject({ cantidad: 0.06 });
    expect(conEstiloVideo(p, "equilibrado")).toBeNull();
  });
});
