/** TER-06: Geeper importa la tarea de MPT en cuanto están el guion, la voz y los clips. */
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ llamadas: [] as string[][], respuestas: [] as { codigo: number; stdout: string }[] }));
vi.mock("@/lib/proceso", async (orig) => ({
  ...(await orig<typeof import("@/lib/proceso")>()),
  correr: async (_c: string, args: string[]) => (m.llamadas.push(args), { stderr: "", ...(m.respuestas.shift() ?? { codigo: 1, stdout: "" }) }),
}));

const { archivosParaGeeper, estadoTarea, materialesListos } = await import("@/lib/mpt");

const guion = JSON.stringify({ script: "Hola mundo", material_sources: [{ local_file: "a.mp4" }, { local_file: "b.mp4" }] });

afterEach(() => {
  m.llamadas = [];
  m.respuestas = [];
  vi.unstubAllGlobals();
});

describe("archivosParaGeeper (TER-06)", () => {
  it("pide el guion, la voz y cada clip", () => {
    expect(archivosParaGeeper(guion)).toEqual(["script.json", "audio.mp3", "a.mp4", "b.mp4"]);
  });
  it("sin material_sources (MPT todavía no lo escribió), sin guion o con JSON cortado: null", () => {
    expect(archivosParaGeeper(JSON.stringify({ script: "Hola", search_terms: ["x"] }))).toBeNull();
    expect(archivosParaGeeper(JSON.stringify({ script: "", material_sources: [{ local_file: "a.mp4" }] }))).toBeNull();
    expect(archivosParaGeeper('{"script": "Hola", "material_sou')).toBeNull();
  });
  it("no acepta rutas en local_file", () => {
    expect(archivosParaGeeper(JSON.stringify({ script: "Hola", material_sources: [{ local_file: "../x.mp4" }] }))).toBeNull();
    expect(archivosParaGeeper(JSON.stringify({ script: "Hola", material_sources: [{ local_file: ".." }] }))).toBeNull();
  });
});

describe("materialesListos (TER-06)", () => {
  it("mira en el contenedor que cada archivo exista y no esté vacío", async () => {
    m.respuestas = [{ codigo: 0, stdout: guion }, { codigo: 0, stdout: "" }];
    expect(await materialesListos("t1")).toBe(true);
    expect(m.llamadas[1]?.slice(-4)).toEqual(["script.json", "audio.mp3", "a.mp4", "b.mp4"]);
  });
  it("si falta un clip, no", async () => {
    m.respuestas = [{ codigo: 0, stdout: guion }, { codigo: 1, stdout: "" }];
    expect(await materialesListos("t1")).toBe(false);
  });
  it("sin script.json, no (y no mira nada más)", async () => {
    m.respuestas = [{ codigo: 1, stdout: "" }];
    expect(await materialesListos("t1")).toBe(false);
    expect(m.llamadas).toHaveLength(1);
  });
});

describe("estadoTarea con MPT reiniciado (TER-06)", () => {
  it("si MPT ya no conoce la tarea pero el guion, la voz y los clips están en disco, la da por lista", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    // La primera respuesta: no es una tarea de cli.py (no tiene log).
    m.respuestas = [{ codigo: 3, stdout: "" }, { codigo: 1, stdout: "" }, { codigo: 0, stdout: guion }, { codigo: 0, stdout: "" }];
    expect((await estadoTarea("t1")).estado).toBe("completa");
  });
  it("sin final-1.mp4 ni materiales, perdida", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    m.respuestas = [{ codigo: 3, stdout: "" }, { codigo: 1, stdout: "" }, { codigo: 1, stdout: "" }];
    expect((await estadoTarea("t1")).estado).toBe("perdida");
  });
});

describe("copiarTareaMpt (TER-06)", () => {
  it("una copia con guion y voz, sin el video final de MPT, no se vuelve a copiar", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { copiarTareaMpt } = await import("@/lib/importador");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-copiar-mpt-"));
    const id = "0b8f2c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
    fs.mkdirSync(path.join(dir, "mpt", id), { recursive: true });
    fs.writeFileSync(path.join(dir, "mpt", id, "script.json"), guion);
    fs.writeFileSync(path.join(dir, "mpt", id, "audio.mp3"), "ID3");
    expect(await copiarTareaMpt({ dir, log: () => undefined } as never, id)).toBe(path.join(dir, "mpt", id));
    expect(m.llamadas).toHaveLength(0);
  });
});
