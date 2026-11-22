import { describe, expect, it } from "vitest";
import type { EjecutorLlm } from "@/lib/llm-local";
import { proponerTitulos } from "@/lib/titulos";

const libre = async () => ({ liberar: () => {} });
const encendida = async () => ({ encendidos: [], faltan: [] });

describe("títulos con la IA local (WEB-02, GPU-09)", () => {
  it("el modelo no se queda cargado en la tarjeta ni piensa en voz alta", async () => {
    const pedidos: Record<string, unknown>[] = [];
    const ejecutar: EjecutorLlm = async (cuerpo) => {
      pedidos.push(JSON.parse(cuerpo));
      return { codigo: 0, stdout: JSON.stringify({ message: { content: '{"titulos":["Faros que nadie visita"]}' } }), stderr: "" };
    };
    const r = await proponerTitulos({ nombre: "Faros", tema: "faros", guion: "…", formato: "9:16" }, { ejecutar, candado: libre, encender: encendida });
    expect(r).toEqual({ titulos: ["Faros que nadie visita"], fuente: "ia" });
    expect(pedidos[0]).toMatchObject({ keep_alive: 0, think: false, stream: false });
    expect((pedidos[0]!.format as { type: string }).type).toBe("object");
  });

  it("si la tarjeta está ocupada o Docker apagado, da títulos sugeridos con el motivo", async () => {
    const o = { nombre: "Faros", tema: "faros", guion: "…", formato: "9:16" };
    expect((await proponerTitulos(o, { candado: async () => null })).motivo).toMatch(/ocupada/);
    const docker: EjecutorLlm = async () => ({ codigo: 1, stdout: "", stderr: "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine" });
    const sin = await proponerTitulos(o, { ejecutar: docker, candado: libre, encender: encendida });
    expect(sin.fuente).toBe("sugeridos");
    expect(sin.motivo).toMatch(/Docker Desktop/);
  });
});
