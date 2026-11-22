/** GPU-07: «voz.regenerar» con varias escenas: una carga de la voz diseñada, una voz por escena y un solo render. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  motor: "voxcpm",
  escenas: { e1: { texto: "hola  mundo" }, e2: { texto: "otra escena" } } as Record<string, { texto: string }>,
  adelantos: [] as string[][],
  rehechas: [] as string[],
}));

vi.mock("@/lib/render", async (orig) => ({
  ...(await orig<typeof import("@/lib/render")>()),
  versionDeProyecto: async () => ({ numero: 1, p: { voz: { motor: m.motor, voz: "narradora-1a2b" }, escenas: m.escenas } }),
}));
vi.mock("@/lib/regenerar", () => ({
  textoADecir: (e: { texto: string }) => e.texto,
  regenerarVoz: async (_h: unknown, _id: string, _p: unknown, escena: string) => (m.rehechas.push(escena), { version: 10 + m.rehechas.length, asset: `a-${escena}` }),
}));
vi.mock("@/lib/voces", async (orig) => ({
  ...(await orig<typeof import("@/lib/voces")>()),
  adelantarVoxcpm: async (_h: unknown, textos: string[]) => (m.adelantos.push(textos), { dichas: textos.length, fallidas: 0 }),
}));

const { EJECUTORES, escenasDelPedido } = await import("../worker/ejecutores");
const h = { dir: "/tmp", log: () => undefined, etapa: async () => undefined, signal: new AbortController().signal };
const trabajo = (payload: Record<string, unknown>, motor = "tarjeta") => ({ id: "t1", tipo: "voz.regenerar", motor, proyectoId: "p1", payload });

beforeEach(() => {
  m.adelantos = [];
  m.rehechas = [];
  m.motor = "voxcpm";
});

describe("voz.regenerar con varias escenas (GPU-07)", () => {
  it("adelanta todas las frases de una vez y rehace cada escena; el render va una sola vez al final", async () => {
    const r = await EJECUTORES["voz.regenerar"](trabajo({ escenas: ["e1", "e2", "e1", "falta"], cadena: ["render.entregar"] }), h);
    expect(m.adelantos).toEqual([["hola mundo", "otra escena"]]);
    expect(m.rehechas).toEqual(["e1", "e2"]); // la que ya no está se salta
    expect(r.resultado).toMatchObject({ version: 12, escenas: ["e1", "e2"] });
    expect(r.siguiente).toEqual({ tipo: "render.entregar", payload: { version: 12, cadena: [] } });
  });

  it("con Kokoro no hay nada que adelantar, pero sigue siendo un solo trabajo y un solo render", async () => {
    m.motor = "kokoro";
    const r = await EJECUTORES["voz.regenerar"](trabajo({ escenas: ["e1", "e2"], cadena: ["render.entregar"] }, "voz"), h);
    expect(m.adelantos).toEqual([]);
    expect(m.rehechas).toEqual(["e1", "e2"]);
    expect(r.siguiente?.tipo).toBe("render.entregar");
  });

  it("si ninguna escena sigue en el video, lo dice", async () => {
    await expect(EJECUTORES["voz.regenerar"](trabajo({ escenas: ["x"] }), h)).rejects.toThrow(/ya no están/);
  });

  it("escenasDelPedido: sin lista (o vacía) es el camino de siempre", () => {
    expect(escenasDelPedido({ escena: "e1" })).toBeNull();
    expect(escenasDelPedido({ escenas: [] })).toBeNull();
    expect(escenasDelPedido({ escenas: ["a", 3, "a", "b"] })).toEqual(["a", "b"]);
  });
});
