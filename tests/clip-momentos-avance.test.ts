/** UX-34: el análisis de clips avisa cada paso de buscarMomentos (la barra no se queda en 10 %). */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/buscar-momentos", async (orig) => {
  const o = await orig<typeof import("@/lib/buscar-momentos")>();
  return {
    ...o,
    buscarMomentos: async (_pe: unknown, _log: unknown, _s: unknown, avance: (e: string, p: number) => void) => {
      avance(`${o.PASOS_MOMENTOS.abriendo}…`, 0.05);
      avance(`${o.PASOS_MOMENTOS.midiendo}…`, 0.3);
      return { fuente: "f1", candidatos: [1, 2] };
    },
  };
});

const { PASOS_MOMENTOS } = await import("@/lib/buscar-momentos");
const { EJECUTORES } = await import("../worker/ejecutores");

describe("clip.momentos con avance (UX-34)", () => {
  it("cada paso de buscarMomentos llega a la etapa del trabajo, sin «Trayendo la fuente» fijo", async () => {
    const etapa = vi.fn(async () => undefined);
    const h = { dir: "/tmp", log: () => undefined, etapa, signal: new AbortController().signal };
    const r = await EJECUTORES["clip.momentos"]({ id: "t1", tipo: "clip.momentos", motor: "cpu", proyectoId: null, payload: { src: "/tmp/v.mp4" } } as never, h);
    expect(r.resultado).toEqual({ fuente: "f1", candidatos: 2 });
    expect(etapa.mock.calls).toEqual([[`${PASOS_MOMENTOS.abriendo}…`, 0.05], [`${PASOS_MOMENTOS.midiendo}…`, 0.3]]);
  });
});
