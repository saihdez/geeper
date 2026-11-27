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
  estados: [] as (string | { estado: string; progreso: number })[],
  viva: true,
  materiales: true,
  miradas: 0,
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
  apiViva: async () => m.viva,
  // En la app de escritorio levanta la API caída (liberar-mpt.ts); en la prueba, sólo si está viva.
  asegurarApi: async () => m.viva,
  cuerpoVideo: () => ({}),
  crearVideo: async () => "tarea-1",
  modeloImagen: async () => undefined,
  estadoTarea: async () => {
    const e = m.estados.shift() ?? "procesando";
    return typeof e === "string" ? { estado: e, progreso: 40 } : e;
  },
  PROGRESO_MATERIALES: 50,
  materialesListos: async () => (m.miradas++, m.materiales),
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

  it("con el generador apagado manda a pulsar el botón que existe: «Volver a intentar» (UX-07)", async () => {
    m.viva = false;
    try {
      await expect(EJECUTORES["mpt.generar"]({ id: "t4", tipo: "mpt.generar", proyectoId: "p1", payload: {} }, herramientas(new AbortController()))).rejects.toThrow(/pulsa «Volver a intentar»/);
    } finally {
      m.viva = true;
    }
  });

  it("con el guion, la voz y los clips listos importa sin esperar el video final de MPT; la tarjeta queda al vigilante (TER-06)", async () => {
    m.liberado = 0; m.vigilado = []; m.miradas = 0; m.materiales = true;
    m.estados = [{ estado: "procesando", progreso: 62 }, "completa"];
    const t0 = Date.now();
    const r = await EJECUTORES["mpt.generar"]({ id: "t5", tipo: "mpt.generar", proyectoId: "p1", payload: { cadena: ["proyecto.importar"] } }, herramientas(new AbortController()));
    expect(Date.now() - t0).toBeLessThan(2000); // no esperó otra vuelta de 5 s
    expect(r.siguiente?.tipo).toBe("proyecto.importar");
    expect(m.vigilado).toEqual(["tarea-1"]);
    expect(m.liberado).toBe(0);
  });

  it("con el avance en 50 justo (MPT aún escribe material_sources) ni siquiera mira los archivos (TER-06)", async () => {
    m.liberado = 0; m.vigilado = []; m.miradas = 0; m.materiales = true;
    m.estados = [{ estado: "procesando", progreso: 50 }];
    const ctrl = new AbortController();
    const p = EJECUTORES["mpt.generar"]({ id: "t6", tipo: "mpt.generar", proyectoId: "p1", payload: {} }, herramientas(ctrl));
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    await expect(p).rejects.toThrow(/Cancelado/);
    expect(m.miradas).toBe(0);
  });

  it("pasado 50 pero sin los archivos en disco, sigue esperando (TER-06)", async () => {
    m.liberado = 0; m.vigilado = []; m.miradas = 0; m.materiales = false;
    m.estados = [{ estado: "procesando", progreso: 70 }];
    const ctrl = new AbortController();
    const p = EJECUTORES["mpt.generar"]({ id: "t7", tipo: "mpt.generar", proyectoId: "p1", payload: {} }, herramientas(ctrl));
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    await expect(p).rejects.toThrow(/Cancelado/);
    expect(m.miradas).toBe(1);
    m.materiales = true;
  });
});
