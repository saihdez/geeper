/** DSC-05: antes de bajar los modelos de una receta se mira el disco con lo que pesa toda la receta. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const GB = 1e9;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-espacio-receta-"));
process.env.GEEPER_DATA = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const m = vi.hoisted(() => ({ pedidos: [] as { necesario: number; para: string }[], fetch: 0 }));
vi.mock("@/lib/espacio", async (orig) => {
  const o = await orig<typeof import("@/lib/espacio")>();
  // C: con 30 GB libres; la reserva es de 20.
  const statfs = async () => ({ bavail: (30 * GB) / 4096, bsize: 4096, blocks: (1000 * GB) / 4096 });
  return { ...o, exigirEspacio: (r: string, n: number, para: string) => (m.pedidos.push({ necesario: n, para }), o.exigirEspacio(r, n, para, { statfs, wsl: false, margen: 20 * GB })) };
});
vi.mock("@/lib/comfyui", async (orig) => ({
  ...(await orig<typeof import("@/lib/comfyui")>()),
  leerCatalogo: async () => ({
    workflows: [{ id: "wan", titulo: "Wan", descripcion: "", categoria: "Video", tipo: "video", etiquetas: [], modelos: [], tamano: 32 * GB, local: true, complementos: [], entradas: [], miniaturas: [], fecha: null, uso: 0 }],
    archivos: {},
  }),
  leerWorkflowJson: async () => ({ nodes: [] }),
  modelosDeWorkflow: () => [{ nombre: "wan.safetensors", carpeta: "diffusion_models", url: "https://example.invalid/wan" }],
  estadoModelos: () => [{ nombre: "wan.safetensors", carpeta: "diffusion_models", url: "https://example.invalid/wan", ruta: path.join(dir, "models", "diffusion_models", "wan.safetensors"), listo: false }],
}));
vi.mock("@/lib/nodos-comfy", async (orig) => ({ ...(await orig<typeof import("@/lib/nodos-comfy")>()), infoNodos: async () => [] }));

describe("receta que no cabe (DSC-05)", () => {
  it("avisa antes de la primera bajada con lo que pesa la receta, y no baja nada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => (m.fetch++, { ok: false, status: 500 })));
    const { correrWorkflow } = await import("@/lib/workflows");
    await expect(correrWorkflow({ dir, log: () => undefined }, "c1", { workflow: "wan", textos: [], archivos: [] } as never)).rejects.toThrow(
      /No hay lugar suficiente en el disco para bajar los modelos de esta receta/,
    );
    expect(m.pedidos[0]).toEqual({ necesario: 32 * GB, para: "bajar los modelos de esta receta" });
    expect(m.fetch).toBe(0);
    vi.unstubAllGlobals();
  });
});
