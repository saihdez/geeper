/** WRK-04 (ronda 2): al abrir el editor de ComfyUI se cierran antes los procesos de tarjeta sin dueño. */
import { describe, expect, it, vi } from "vitest";

const orden: string[] = [];
vi.mock("@/lib/procesos-largos", () => ({ cerrarHuerfanos: () => (orden.push("cerrarHuerfanos"), ["ComfyUI"]) }));
vi.mock("@/lib/comfyui", () => ({
  PUERTO_EDITOR: 8199,
  arrancarComfyui: async () => (orden.push("arrancar"), { url: "http://127.0.0.1:8199", hijo: { exitCode: null, signalCode: null }, detener: async () => {} }),
}));
vi.mock("@/lib/instalar-comfyui", () => ({ revisarComfyui: () => ({ falta: false }) }));
vi.mock("@/lib/nodos-comfy", () => ({ argsNodos: () => [], infoNodos: async () => [], leerPermisos: async () => ({}) }));

describe("POST /api/workflows/editor (WRK-04)", () => {
  it("abrir: primero cierra los huérfanos y después arranca ComfyUI", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { POST } = await import("@/app/api/workflows/editor/route");
    const r = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ accion: "abrir" }) }));
    expect(await r.json()).toEqual({ abierto: true, url: "http://127.0.0.1:8199" });
    expect(orden).toEqual(["cerrarHuerfanos", "arrancar"]);
    // Ya abierto: no vuelve a buscar huérfanos (el suyo tiene dueño vivo, pero no hace falta mirar).
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ accion: "abrir" }) }));
    expect(orden).toEqual(["cerrarHuerfanos", "arrancar"]);
  });
});
