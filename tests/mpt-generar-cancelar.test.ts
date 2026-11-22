/** GPU-03: cancelar «Generar video» deja la tarjeta tomada hasta que MPT suelte la tarea. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-mpt-cancelar-"));
fs.mkdirSync(path.join(dir, "logs"), { recursive: true });

const m = vi.hoisted(() => ({
  liberado: 0,
  opciones: [] as Record<string, unknown>[],
  vigilado: [] as string[],
  estados: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: { proyecto: { findUniqueOrThrow: async () => ({ id: "p1", slug: "p1", tema: "t", formato: "9:16", plantilla: "x" }), update: async () => ({}) } },
}));
vi.mock("@/lib/almacen", () => ({ crearCarpetas: async () => dir, guardarProyecto: async () => 1, registrarAssetsEnDb: async () => undefined }));
vi.mock("@/lib/plantillas", () => ({ obtenerPlantilla: async () => ({ datos: { mpt: {} } }) }));
vi.mock("@/lib/cola", async (orig) => ({ ...(await orig<typeof import("@/lib/cola")>()), guardarPayload: async () => undefined }));
vi.mock("@/lib/proceso", async (orig) => ({ ...(await orig<typeof import("@/lib/proceso")>()), correr: async () => ({ codigo: 1, stdout: "", stderr: "" }) }));
vi.mock("@/lib/gpu", () => ({
  tomarGpu: async (_d: string, op: Record<string, unknown>) => (m.opciones.push(op), { liberar: () => void m.liberado++ }),
}));
vi.mock("@/lib/mpt", () => ({
  apiViva: async () => true,
  cuerpoVideo: () => ({}),
  crearVideo: async () => "tarea-1",
  modeloImagen: async () => undefined,
  estadoTarea: async () => ({ estado: m.estados.shift() ?? "procesando", progreso: 40 }),
  soltarCuandoTermine: (id: string) => (m.vigilado.push(id), Promise.resolve("completa")),
}));

const { EJECUTORES } = await import("../worker/ejecutores");

function herramientas(ctrl: AbortController) {
  return { dir, log: () => undefined, etapa: async () => undefined, signal: ctrl.signal };
}

describe("mpt.generar y la tarjeta al cancelar (GPU-03)", () => {
  it("cancelar con la tarea en marcha no suelta la tarjeta: la pasa al vigilante", async () => {
    m.liberado = 0; m.vigilado = []; m.opciones = []; m.estados = [];
    const ctrl = new AbortController();
    const p = EJECUTORES["mpt.generar"]({ id: "t1", tipo: "mpt.generar", proyectoId: "p1", payload: {} }, herramientas(ctrl));
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    await expect(p).rejects.toThrow(/Cancelado/);
    expect(m.opciones[0]?.soltarAlCancelar).toBe(false);
    expect(m.vigilado).toEqual(["tarea-1"]);
    expect(m.liberado).toBe(0);
  });

  it("si MPT termina, suelta la tarjeta en el acto", async () => {
    m.liberado = 0; m.vigilado = []; m.estados = ["completa"];
    const r = await EJECUTORES["mpt.generar"]({ id: "t2", tipo: "mpt.generar", proyectoId: "p1", payload: {} }, herramientas(new AbortController()));
    expect(r.resultado).toEqual({ taskId: "tarea-1" });
    expect(m.liberado).toBe(1);
    expect(m.vigilado).toEqual([]);
  });

  it("si MPT da la tarea por fallida, la suelta sin vigilar", async () => {
    m.liberado = 0; m.vigilado = []; m.estados = ["fallida"];
    await expect(EJECUTORES["mpt.generar"]({ id: "t3", tipo: "mpt.generar", proyectoId: "p1", payload: {} }, herramientas(new AbortController()))).rejects.toThrow(/fallida/);
    expect(m.liberado).toBe(1);
    expect(m.vigilado).toEqual([]);
  });
});
