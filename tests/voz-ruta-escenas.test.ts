/** GPU-07: POST /api/proyectos/[id]/voz con {escenas} encola UN solo «voz.regenerar» con la lista. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ encolados: [] as { tipo: string; payload: Record<string, unknown> }[] }));
vi.mock("@/lib/db", () => ({
  db: { proyecto: { findUniqueOrThrow: async () => ({ id: "p1", versionActual: 3 }) }, trabajo: { findFirst: async () => null } },
}));
vi.mock("@/lib/cola", () => ({ encolar: async (_id: string, tipo: string, payload: Record<string, unknown>) => (m.encolados.push({ tipo, payload }), { id: "t1" }) }));

const { POST } = await import("@/app/api/proyectos/[id]/voz/route");
const ctx = { params: Promise.resolve({ id: "p1" }) };
const pedir = (cuerpo: unknown) => POST(new Request("http://x/api/proyectos/p1/voz", { method: "POST", body: JSON.stringify(cuerpo) }), ctx);

beforeEach(() => {
  m.encolados = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ruta de voz con escenas (GPU-07)", () => {
  it("varias escenas: un solo trabajo con payload.escenas, sin repetidas, y un render al final", async () => {
    const r = await pedir({ escenas: ["e1", "e3", "e1"] });
    expect(r.status).toBe(201);
    expect(m.encolados).toEqual([{ tipo: "voz.regenerar", payload: { escenas: ["e1", "e3"], cadena: ["render.entregar"] } }]);
  });

  it("una escena o todo el guion: como siempre", async () => {
    await pedir({ escena: "e2" });
    await pedir({ escena: null });
    expect(m.encolados.map((e) => e.payload)).toEqual([{ escena: "e2", cadena: ["render.entregar"] }, { escena: null, cadena: ["render.entregar"] }]);
  });

  it("lista vacía o sin nada: error claro y no encola", async () => {
    expect((await pedir({ escenas: [] })).status).toBe(400);
    expect((await pedir({})).status).toBe(400);
    expect(m.encolados).toEqual([]);
  });
});
