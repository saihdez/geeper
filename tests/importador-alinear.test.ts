/** REN-05: importar desde MPT alinea la voz como rehacerla (sin VAD primero, con revisión). */
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ llamadas: [] as unknown[][] }));
vi.mock("@/lib/voz", async (orig) => ({
  ...(await orig<typeof import("@/lib/voz")>()),
  alinearVozNueva: async (...a: unknown[]) => (m.llamadas.push(a.slice(1)), [{ texto: "hola", inicio: 0, fin: 0.4 }]),
}));

const { tiemposDeVoz } = await import("@/lib/importador");

describe("tiemposDeVoz (REN-05)", () => {
  it("usa alinearVozNueva con el audio, el texto y el idioma", async () => {
    const r = await tiemposDeVoz({ dir: "/no-existe", log: () => undefined }, "/no-existe/assets/voz.mp3", "hola", "es");
    expect(m.llamadas).toEqual([["/no-existe/assets/voz.mp3", "hola", "es"]]);
    expect(r).toEqual([{ texto: "hola", inicio: 0, fin: 0.4 }]);
  });
});
