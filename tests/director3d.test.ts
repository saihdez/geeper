import { describe, expect, it } from "vitest";
import { aplicarAjustes, cifrasDeEscena, coloresDeMarca, fraseClave, type PlanEscena3d } from "@/lib/director3d";
import { ESTILOS_GENERACION, pasosDe, tiempoEstimado } from "@/lib/estilos-generacion";

const plan = (x: Partial<PlanEscena3d>): PlanEscena3d => ({ escena: "e1", numero: 1, bloque: "titulo", frase: "Hola", datos: [], unidad: "", tipoDatos: "barras", segundos: 4, ...x });

describe("director 3D", () => {
  it("saca una frase clave corta de la escena", () => {
    expect(fraseClave("Y entonces los faros guían a los barcos, incluso de noche.")).toBe("Faros guían a los barcos");
    expect(fraseClave("¿Sabías que el mar cubre casi todo el planeta?").split(" ").length).toBeLessThanOrEqual(6);
    expect(fraseClave("")).toBe("");
  });
  it("los años no son datos para un gráfico", () => {
    expect(cifrasDeEscena("En 1990 se construyó el faro").datos).toEqual([]);
    expect(cifrasDeEscena("el 70% del planeta es agua").datos.map((d) => d.valor)).toEqual([70]);
  });
  it("el modelo sólo cambia lo válido y no inventa frases ni gráficos", () => {
    const textos = ["Los faros guían a los barcos de noche"];
    const p = [plan({})];
    expect(aplicarAjustes(p, textos, '{"escenas":[{"n":1,"bloque":"datos"}]}')[0]!.bloque).toBe("titulo");
    expect(aplicarAjustes(p, textos, '{"escenas":[{"n":1,"bloque":"foto","frase":"faros de noche"}]}')[0]).toMatchObject({ bloque: "foto", frase: "Faros de noche" });
    expect(aplicarAjustes(p, textos, '{"escenas":[{"n":1,"frase":"compra ya mi curso"}]}')[0]!.frase).toBe("Hola");
    expect(aplicarAjustes(p, textos, "nada")).toBe(p);
  });
  it("usa los colores del canal", () => {
    expect(coloresDeMarca({ acento1: "#ff3d81", acento2: "#ffb347", activa: "#ffd23f" })).toMatchObject({ principal: "#ff3d81", acento: "#ffb347" });
    expect(coloresDeMarca(null).principal).toMatch(/^#/);
  });
  it("«Todo en 3D» está en Nuevo con sus pasos y su tiempo", () => {
    expect(ESTILOS_GENERACION["3d"].nombre).toBe("Todo en 3D");
    expect(pasosDe("3d", false).map((x) => x.paso)).toContain("Escenas 3D");
    expect(tiempoEstimado("3d")).toMatch(/3 minutos por escena/);
  });
});
