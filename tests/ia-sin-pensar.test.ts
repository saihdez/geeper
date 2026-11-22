import { describe, expect, it } from "vitest";
import { datosEjemplo } from "@/lib/anuncios/ejemplo";
import { cuerpoIdeas } from "@/lib/anuncios/ideas";
import type { EjecutorLlm } from "@/lib/llm-local";
import { proponerTitulos } from "@/lib/titulos";

describe("WEB-02: la IA local no piensa en voz alta ni se queda en la tarjeta", () => {
  it("títulos: think false y keep_alive 0 (por llm-local, GPU-09)", async () => {
    let cuerpo: Record<string, unknown> = {};
    const ejecutar: EjecutorLlm = async (c) => ((cuerpo = JSON.parse(c)), { codigo: 0, stdout: JSON.stringify({ message: { content: '{"titulos":["Uno dos tres"]}' } }), stderr: "" });
    await proponerTitulos({ nombre: "n", tema: "t", guion: "g", formato: "9:16" }, { ejecutar, candado: async () => ({ liberar: () => {} }), encender: async () => ({ encendidos: [], faltan: [] }) });
    expect(cuerpo.think).toBe(false);
    expect(cuerpo.keep_alive).toBe(0);
  });

  it("ideas de anuncios: think false y keep_alive 0", () => {
    const c = cuerpoIdeas(datosEjemplo(), "modelo");
    expect(c.think).toBe(false);
    expect(c.keep_alive).toBe(0);
    expect(c.model).toBe("modelo");
    expect(c.messages).toHaveLength(2);
  });
});
