/** GPU-06: «Regenerar voz» con una voz diseñada sale de la fila «voz» antes de esperar la tarjeta. */
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ motorVoz: "voxcpm", regeneradas: 0 }));

vi.mock("@/lib/render", () => ({
  versionDeProyecto: async () => ({ p: { voz: { motor: m.motorVoz } } }),
  renderEntregar: async () => ({}),
}));
vi.mock("@/lib/regenerar", () => ({ regenerarVoz: async () => (m.regeneradas++, { version: 2 }) }));

const { EJECUTORES } = await import("../worker/ejecutores");
const { CambiarDeFila } = await import("@/lib/cola");

const h = { dir: "/tmp", log: () => undefined, etapa: async () => undefined, signal: new AbortController().signal };
const trabajo = (motor?: string) => ({ id: "t1", tipo: "voz.regenerar", motor, proyectoId: "p1", payload: {} });

describe("voz.regenerar y la fila de la tarjeta (GPU-06)", () => {
  it("con voz diseñada en la fila «voz», pide pasar a la fila «tarjeta» sin empezar", async () => {
    m.motorVoz = "voxcpm"; m.regeneradas = 0;
    const e = await EJECUTORES["voz.regenerar"](trabajo("voz"), h).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CambiarDeFila);
    expect((e as InstanceType<typeof CambiarDeFila>).motor).toBe("tarjeta");
    expect(m.regeneradas).toBe(0);
  });

  it("ya en la fila «tarjeta», o con Kokoro, la hace ahí mismo", async () => {
    m.regeneradas = 0;
    await EJECUTORES["voz.regenerar"](trabajo("tarjeta"), h);
    m.motorVoz = "kokoro";
    await EJECUTORES["voz.regenerar"](trabajo("voz"), h);
    expect(m.regeneradas).toBe(2);
  });
});
