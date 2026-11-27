/** UX-18: «Quitar muletillas» sin muletillas no crea una versión nueva igual a la anterior. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proyectoDePrueba } from "./fixtures";

const m = vi.hoisted(() => ({ guardadas: [] as string[] }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/render", () => ({ versionDeProyecto: async () => ({ numero: 3, p: proyectoDePrueba() }) }));
vi.mock("@/lib/almacen", () => ({ guardarProyecto: async (_id: string, _p: unknown, nota: string) => (m.guardadas.push(nota), 4) }));

const { POST } = await import("@/app/api/proyectos/[id]/editar/route");
const ctx = { params: Promise.resolve({ id: "p1" }) };
const pedir = (edicion: unknown) => POST(new Request("http://x/api/proyectos/p1/editar", { method: "POST", body: JSON.stringify({ edicion }) }), ctx);

beforeEach(() => {
  m.guardadas = [];
});

describe("editar sin cambios (UX-18)", () => {
  it("quitar muletillas en un video sin muletillas responde sinCambios y no guarda", async () => {
    const r = await pedir({ tipo: "quitarMuletillas" });
    expect(await r.json()).toEqual({ sinCambios: true });
    expect(m.guardadas).toEqual([]);
  });

  it("un cambio real sí guarda una versión", async () => {
    const r = await pedir({ tipo: "renombrar", nombre: "Otro nombre" });
    expect(await r.json()).toEqual({ version: 4 });
    expect(m.guardadas).toEqual(["Renombrado"]);
  });
});
