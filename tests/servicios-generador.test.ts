/** UX-07: con el generador de videos (MPT) apagado, «Crear y generar» no deja proyectos fallidos. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  viva: false,
  esperas: [] as (number | undefined)[],
  creados: [] as unknown[],
  lotes: 0,
  encolados: [] as unknown[],
}));

// asegurarApi: la API viva o, en el escritorio, los contenedores parados de MPT levantados.
vi.mock("@/lib/mpt", () => ({ asegurarApi: async (_log: unknown, ms?: number) => (m.esperas.push(ms), m.viva) }));
vi.mock("@/lib/almacen", () => ({ crearCarpetas: async () => "/tmp/x" }));
vi.mock("@/lib/actuar", () => ({ guardarAvatarDelVideo: async () => undefined }));
vi.mock("@/lib/animar-escenas", () => ({ guardarEstiloGeneracion: async () => undefined }));
vi.mock("@/lib/cola", () => ({ encolar: async (...a: unknown[]) => void m.encolados.push(a) }));
vi.mock("@/lib/db", () => ({
  db: {
    plantilla: { findUnique: async () => ({ slug: "base" }) },
    proyecto: { create: async (q: { data: unknown }) => (m.creados.push(q.data), { id: `p${m.creados.length}`, slug: "s" }) },
    lote: { create: async () => (m.lotes++, { id: "l1" }) },
  },
}));

const { crearLote, crearProyecto, GENERADOR_APAGADO } = await import("@/lib/servicios");

beforeEach(() => {
  m.creados = [];
  m.encolados = [];
  m.lotes = 0;
});

describe("crear proyectos desde un tema (UX-07)", () => {
  it("con el generador apagado no crea nada y lo dice en palabras simples", async () => {
    m.viva = false;
    await expect(crearProyecto({ tema: "gatos", formato: "9:16", plantilla: "base" })).rejects.toThrow(GENERADOR_APAGADO);
    await expect(crearLote(["a", "b", "c"], "9:16", "base")).rejects.toThrow(/Docker Desktop/);
    expect(m.creados).toEqual([]);
    expect(m.lotes).toBe(0);
    expect(m.encolados).toEqual([]);
  });

  it("con el generador encendido crea el lote entero", async () => {
    m.viva = true;
    const r = await crearLote(["a", "b"], "9:16", "base");
    expect(r.proyectos).toHaveLength(2);
    expect(m.encolados).toHaveLength(2);
    // Antes de rendirse intenta levantar el generador parado (espera hasta 1 min, no los 2 de siempre).
    expect(m.esperas.at(-1)).toBe(60_000);
  });
});
