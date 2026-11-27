/** UX-30: una corrida que falló o se cortó trae el id de su trabajo, para «Volver a intentar». */
import { describe, expect, it, vi } from "vitest";
import { trabajoPorCorrida } from "@/lib/workflows-texto";
import { corridaHecha } from "@/lib/workflows";

const consultas: unknown[] = [];
vi.mock("@/lib/instalar-comfyui", () => ({ revisarComfyui: () => ({ falta: null, corriendo: false, disponible: true }) }));
vi.mock("@/lib/comfyui", async (original) => ({ ...(await original<typeof import("@/lib/comfyui")>()), leerCatalogo: async () => ({ workflows: [], archivos: {} }) }));
vi.mock("@/lib/db", () => ({
  db: {
    trabajo: {
      findMany: async (q: { where: { estado: { in: string[] } } }) => {
        consultas.push(q);
        return q.where.estado.in.includes("fallido")
          ? [{ id: "t-nuevo", estado: "fallido", payload: { corrida: "c1" } }, { id: "t-viejo", estado: "cancelado", payload: { corrida: "c1" } }, { id: "t-2", estado: "cancelado", payload: { corrida: "c2" } }]
          : [];
      },
    },
  },
}));
vi.mock("@/lib/workflows", async (original) => ({
  ...(await original<typeof import("@/lib/workflows")>()),
  listarCorridas: async () => [
    { id: "c1", workflow: "w", titulo: "W", creada: "2026-11-22", estado: "fallida", salidas: [], error: "ComfyUI falló" },
    { id: "c2", workflow: "w", titulo: "W", creada: "2026-11-21", estado: "preparada", salidas: [] },
    { id: "c3", workflow: "w", titulo: "W", creada: "2026-11-21", estado: "hecha", salidas: [] },
  ],
}));

describe("Volver a intentar en Workflows (UX-30)", () => {
  it("se queda con el trabajo más nuevo de cada corrida e ignora lo que no es de una corrida", () => {
    expect(trabajoPorCorrida([{ id: "a", payload: { corrida: "c1" } }, { id: "b", payload: { corrida: "c1" } }, { id: "c", payload: {} }, { id: "d", payload: null }])).toEqual({ c1: "a" });
  });

  it("GET /api/workflows: cada corrida trae su trabajo (o null)", async () => {
    const { GET } = await import("@/app/api/workflows/route");
    const r = await GET();
    expect(r.status).toBe(200);
    const { corridas } = (await r.json()) as { corridas: { id: string; trabajo: string | null }[] };
    expect(corridas.map((c) => [c.id, c.trabajo])).toEqual([["c1", "t-nuevo"], ["c2", "t-2"], ["c3", null]]);
  });

  it("una corrida cuyo último trabajo se canceló viene marcada (no se muestra como fallo)", async () => {
    const { GET } = await import("@/app/api/workflows/route");
    const { corridas } = (await (await GET()).json()) as { corridas: { id: string; cancelada: boolean }[] };
    expect(corridas.map((c) => [c.id, c.cancelada])).toEqual([["c1", false], ["c2", true], ["c3", false]]);
  });

  it("al terminar bien, la corrida ya no arrastra el error del intento anterior", () => {
    const base = { id: "c1", workflow: "w", titulo: "W", creada: "2026-11-22", estado: "fallida" as const, salidas: [], error: "ComfyUI falló" };
    const c = corridaHecha(base, [{ archivo: "a.png", tipo: "imagen" }], 12);
    expect(c).toEqual({ id: "c1", workflow: "w", titulo: "W", creada: "2026-11-22", estado: "hecha", salidas: [{ archivo: "a.png", tipo: "imagen" }], segundos: 12 });
    expect("error" in c).toBe(false);
  });
});
