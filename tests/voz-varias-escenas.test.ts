/** GPU-07: rehacer la voz diseñada de varias escenas carga VoxCPM2 una sola vez (proceso falso: sin tarjeta ni modelo). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-voz-varias-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_VOXCPM_PYTHON = process.execPath; // «instalado»: el proceso real no se llama

const m = vi.hoisted(() => ({ cargas: [] as { frases: string[] }[], noDecir: [] as string[] }));

vi.mock("@/lib/gpu", () => ({ tomarGpu: async () => ({ liberar: () => undefined }) }));
vi.mock("@/lib/proceso", async (orig) => {
  const real = await orig<typeof import("@/lib/proceso")>();
  const fsp = await import("node:fs/promises");
  return {
    ...real,
    correr: async (cmd: string, args: string[], op: { entrada?: string } = {}) => {
      if (cmd === process.execPath && op.entrada) {
        // VoxCPM2 falso: una «carga» por proceso; escribe y confirma cada frase.
        const pedido = JSON.parse(op.entrada) as { texto?: string; salida?: string; frases?: { texto: string; salida: string }[] };
        const frases = pedido.frases ?? [{ texto: pedido.texto!, salida: pedido.salida! }];
        m.cargas.push({ frases: frases.map((f) => f.texto) });
        const lineas = [JSON.stringify({ cargado_s: 80 })];
        for (const f of frases) {
          await fsp.writeFile(f.salida, `RIFF ${f.texto}`);
          if (!m.noDecir.includes(f.texto)) lineas.push(JSON.stringify({ archivo: f.salida }));
        }
        return { codigo: 0, stdout: lineas.join("\n"), stderr: "" };
      }
      // ffmpeg falso: copia la entrada a la salida.
      await fsp.copyFile(args[args.indexOf("-i") + 1]!, args[args.length - 1]!);
      return { codigo: 0, stdout: "", stderr: "" };
    },
  };
});

const voces = await import("@/lib/voces");

const vozDir = path.join(voces.dirVoces(), "narradora-1a2b");
fs.mkdirSync(vozDir, { recursive: true });
fs.writeFileSync(path.join(vozDir, "referencia.wav"), "RIFF muestra");
fs.writeFileSync(path.join(vozDir, "voz.json"), JSON.stringify({ id: "narradora-1a2b", nombre: "Narradora", descripcion: "cálida", texto: "Hola", creada: "2026-11-22", licencia: voces.LICENCIA_VOXCPM }));
const ctx = { dir, log: () => undefined };

beforeEach(() => {
  m.cargas = [];
  m.noDecir = [];
});

describe("voz diseñada de varias escenas (GPU-07)", () => {
  it("tres escenas: una sola carga del modelo, y cada escena toma la suya sin volver a cargarlo", async () => {
    const textos = ["uno dos", "tres cuatro", "cinco seis"];
    const r = await voces.adelantarVoxcpm(ctx, [...textos, "uno dos", "  "], "narradora-1a2b");
    expect(r).toEqual({ dichas: 3, fallidas: 0 });
    expect(m.cargas).toEqual([{ frases: textos }]);
    for (const [i, t] of textos.entries()) {
      const salida = path.join(dir, `e${i}.wav`);
      await voces.sintetizarVoxcpm(ctx, t, "narradora-1a2b", 1, salida);
      expect(fs.readFileSync(salida, "utf8")).toBe(`RIFF ${t}`);
    }
    expect(m.cargas).toHaveLength(1);
    // Ya usadas: otra vez la misma escena vuelve a decirse.
    await voces.sintetizarVoxcpm(ctx, "uno dos", "narradora-1a2b", 1, path.join(dir, "otra.wav"));
    expect(m.cargas).toHaveLength(2);
  });

  it("una frase que VoxCPM2 no confirma no se usa: esa escena se dice aparte", async () => {
    m.noDecir = ["b"];
    expect(await voces.adelantarVoxcpm(ctx, ["a", "b"], "narradora-1a2b")).toEqual({ dichas: 1, fallidas: 1 });
    await voces.sintetizarVoxcpm(ctx, "a", "narradora-1a2b", 1, path.join(dir, "a.wav"));
    expect(m.cargas).toHaveLength(1);
    m.noDecir = [];
    await voces.sintetizarVoxcpm(ctx, "b", "narradora-1a2b", 1, path.join(dir, "b.wav"));
    expect(m.cargas).toHaveLength(2);
    expect(m.cargas[1]!.frases).toEqual(["b"]);
  });

  it("con una sola frase no adelanta nada (no hay carga que ahorrar)", async () => {
    expect(await voces.adelantarVoxcpm(ctx, ["sola"], "narradora-1a2b")).toEqual({ dichas: 0, fallidas: 0 });
    expect(m.cargas).toHaveLength(0);
  });

  it("archivosConfirmados sólo toma las líneas con «archivo»", () => {
    expect([...voces.archivosConfirmados('{"cargado_s": 1}\n{"archivo": "/x/a.wav"}\nruido\n{"archivo": "/x/b')]).toEqual(["/x/a.wav"]);
  });
});
