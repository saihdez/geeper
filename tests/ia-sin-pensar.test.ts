import { describe, expect, it } from "vitest";
import { datosEjemplo } from "@/lib/anuncios/ejemplo";
import { pedirIdeas } from "@/lib/anuncios/ideas";
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

  it("ideas de anuncios: por llm-local (GPU-09), think false, keep_alive 0 y salida con esquema", async () => {
    let cuerpo: Record<string, unknown> = {};
    let tope = 0;
    const idea = { nombre: "Uno", gancho: "Un gancho", guion: "Un guion de prueba con más de veinte letras." };
    const ejecutar: EjecutorLlm = async (c, ms) => ((cuerpo = JSON.parse(c)), (tope = ms), { codigo: 0, stdout: JSON.stringify({ message: { content: JSON.stringify({ conceptos: [idea] }) } }), stderr: "" });
    const crudo = await pedirIdeas(datosEjemplo(), { ejecutar, candado: async () => ({ liberar: () => {} }), encender: async () => ({ encendidos: [], faltan: [] }) });
    expect(JSON.parse(crudo).conceptos[0].gancho).toBe("Un gancho");
    expect(cuerpo.think).toBe(false);
    expect(cuerpo.keep_alive).toBe(0);
    expect(typeof cuerpo.format).toBe("object");
    expect(cuerpo.messages).toHaveLength(2);
    expect(tope).toBe(300_000);
  });
});
