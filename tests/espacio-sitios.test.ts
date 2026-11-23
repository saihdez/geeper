/**
 * DSC-05 (objeción del revisor): cada sitio que escribe algo grande mira el disco antes de empezar, con
 * un statfs falso que dice que queda poco. Nada se baja, sube ni crea si no cabe con la reserva.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GB = 1e9;
const m = vi.hoisted(() => ({ libre: 0, encolados: 0 }));
vi.mock("@/lib/espacio", async (orig) => {
  const o = await orig<typeof import("@/lib/espacio")>();
  const statfs = async () => ({ bavail: m.libre / 4096, bsize: 4096, blocks: (1000 * 1e9) / 4096 });
  return { ...o, exigirEspacio: (r: string, n: number, para: string, op: object = {}) => o.exigirEspacio(r, n, para, { ...op, statfs, wsl: false, margen: 20 * GB }) };
});
vi.mock("@/lib/cola", async (orig) => ({ ...(await orig<typeof import("@/lib/cola")>()), encolar: async () => (m.encolados++, { id: "t1" }) }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-espacio-sitios-"));
process.env.GEEPER_DATA = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  m.libre = 500 * GB;
  m.encolados = 0;
});
afterEach(() => vi.unstubAllGlobals());

const SIN_LUGAR = /^No hay lugar suficiente en el disco para /;

describe("bajar modelos de una receta (workflows.ts)", () => {
  it("un modelo que no cabe con la reserva no se empieza a bajar", async () => {
    const { bajarModelo } = await import("@/lib/workflows");
    m.libre = 25 * GB;
    const cancelar = vi.fn(async () => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(10 * GB) }), body: { cancel: cancelar } })));
    const destino = path.join(dir, "models", "vae", "grande.safetensors");
    await expect(bajarModelo("https://example.invalid/x", destino, () => {})).rejects.toThrow(/No hay lugar suficiente en el disco para bajar grande\.safetensors/);
    expect(cancelar).toHaveBeenCalled();
    expect(fs.existsSync(`${destino}.part`)).toBe(false);
  });

  it("si la bajada se corta a la mitad, no queda el .part", async () => {
    const { bajarModelo } = await import("@/lib/workflows");
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1024));
        c.error(new Error("se cortó la red"));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": "4096" }), body: cuerpo })));
    const destino = path.join(dir, "models", "vae", "cortado.safetensors");
    await expect(bajarModelo("https://example.invalid/y", destino, () => {})).rejects.toThrow(/se cortó/);
    expect(fs.existsSync(`${destino}.part`)).toBe(false);
    expect(fs.existsSync(destino)).toBe(false);
  });
});

describe("subir un video (api/clips/subir)", () => {
  it("si el archivo no cabe, avisa antes de recibirlo y no encola nada", async () => {
    const { POST } = await import("@/app/api/clips/subir/route");
    m.libre = 22 * GB;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await POST(new Request("http://x/api/clips/subir?nombre=vod.mp4", { method: "POST", body: "x", headers: { "content-length": String(5 * GB) } }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/No hay lugar suficiente en el disco para subir este video/);
    expect(m.encolados).toBe(0);
    expect(fs.readdirSync(path.join(dir, "_subidos"))).toEqual([]);
  });
});

describe("máster del render (render.ts)", () => {
  it("con poco lugar no se crea el máster", async () => {
    const { exigirEspacioMaster, bytesMaster } = await import("@/lib/render");
    expect(bytesMaster(10)).toBe(2.1e9);
    expect(bytesMaster(120)).toBe(4.8e9);
    m.libre = 21 * GB;
    await expect(exigirEspacioMaster(dir, 60)).rejects.toThrow(/No hay lugar suficiente en el disco para crear el video de archivo en calidad alta/);
    m.libre = 30 * GB;
    await expect(exigirEspacioMaster(dir, 60)).resolves.toBeDefined();
  });
});

describe("Wan2GP (wan2gp.ts)", () => {
  const wan = path.join(dir, "Wan2GP");
  fs.mkdirSync(path.join(wan, "defaults"), { recursive: true });
  fs.writeFileSync(path.join(wan, "defaults", "t2v.json"), JSON.stringify({ model: { URLs: ["https://x/wan_t2v.safetensors"] } }));
  const i = { dir: wan, python: "/no", wgp: path.join(wan, "wgp.py") };

  it("sin los pesos del modelo pide lugar para bajarlo (30 GB) y avisa si no cabe", async () => {
    const { revisarEspacioWan2gp } = await import("@/lib/wan2gp");
    m.libre = 40 * GB;
    await expect(revisarEspacioWan2gp(i, "t2v", dir)).rejects.toThrow(/bajar el modelo que anima los videos/);
  });

  it("con los pesos ya bajados alcanza con lo de una generación", async () => {
    const { revisarEspacioWan2gp } = await import("@/lib/wan2gp");
    fs.mkdirSync(path.join(wan, "ckpts"), { recursive: true });
    fs.writeFileSync(path.join(wan, "ckpts", "wan_t2v.safetensors"), "");
    m.libre = 40 * GB;
    await expect(revisarEspacioWan2gp(i, "t2v", dir)).resolves.toBeDefined();
    m.libre = 21 * GB;
    await expect(revisarEspacioWan2gp(i, "t2v", dir)).rejects.toThrow(/crear este video con IA/);
  });
});

describe("instalar ComfyUI o Wan2GP (instalar-python.ts)", () => {
  it("sin lugar para la instalación, no baja nada y lo dice en el error", async () => {
    const { crearInstaladorPython } = await import("@/lib/instalar-python");
    const bajado = vi.fn(async () => {});
    const inst = crearInstaladorPython({
      clave: `__prueba_espacio_${Math.random().toString(36).slice(2)}`,
      pasos: [{ id: "codigo", nombre: "código" }],
      sinMac: "no",
      falta: () => "falta",
      ubicacion: () => ({ dir, python: "/no" }),
      bajarCodigo: bajado,
      comandos: () => [],
      comprobar: () => ({}),
      restricciones: [],
      probar: async () => {},
      listo: "Listo.",
      espacio: { bytes: 15 * GB, para: "instalar los workflows (ComfyUI)" },
    });
    m.libre = 30 * GB;
    inst.instalar();
    const fin = await inst.esperar();
    expect(fin.error).toMatch(SIN_LUGAR);
    expect(fin.error).toMatch(/instalar los workflows/);
    expect(bajado).not.toHaveBeenCalled();
  });
});
