/** GPU-10: las medidas de la tarjeta quedan en el resultado del trabajo (nvidia-smi falso, sin tarjeta). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conMedidas, leerMuestra, medidasDeLinea, muestrearGpu, type MedidasGpu } from "../worker/telemetria";

describe("medidas de la tarjeta (GPU-10)", () => {
  it("toma la carga, el pico de VRAM y el total de las líneas JSON de los scripts", () => {
    const m: MedidasGpu = {};
    for (const l of ['{"cargado_s": 81.2, "sample_rate": 48000}', '{"archivo": "x.wav", "generar_s": 9}', "no es json {", '{"vram_pico_gb": 6.1, "total_s": 140.4}', '{"vram_pico_gb": 5.0}']) medidasDeLinea(l, m);
    expect(m).toEqual({ cargado_s: 81.2, vram_pico_gb: 6.1, total_s: 140.4 });
  });

  it("lee una muestra de nvidia-smi", () => {
    expect(leerMuestra("61, 250.3, 14820, 97\n")).toEqual({ temp: 61, potencia: 250.3, vram: 14820, uso: 97 });
    expect(leerMuestra("[N/A]")).toBeNull();
  });

  it("muestrea hasta parar, guarda el CSV y devuelve los máximos", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-tele-"));
    const ruta = path.join(dir, "t-telemetria.csv");
    const salidas = ["50, 100, 2000, 10", "70, 300, 15000, 99", "65, 200, 9000, 50"];
    const s = muestrearGpu(ruta, { consultar: async () => salidas.shift() ?? null, pasoMs: 5 });
    await new Promise((r) => setTimeout(r, 150));
    const m = s.parar();
    expect(m).toMatchObject({ vram_max_mib: 15000, temp_max_c: 70, muestras: 3 });
    expect(fs.readFileSync(ruta, "utf8").trim().split("\n")).toHaveLength(4);
  });

  it("sin nvidia-smi no mide nada ni tumba el trabajo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-tele-"));
    const s = muestrearGpu(path.join(dir, "x.csv"), { consultar: async () => Promise.reject(new Error("no hay")), pasoMs: 5 });
    await new Promise((r) => setTimeout(r, 30));
    expect(conMedidas({ version: 3 }, s.parar())).toEqual({ version: 3 });
  });

  it("junta las medidas con el resultado sin pisarlo", () => {
    expect(conMedidas({ version: 3 }, { vram_pico_gb: 6.1, muestras: 4 })).toEqual({ version: 3, medidas: { vram_pico_gb: 6.1, muestras: 4 } });
    expect(conMedidas(undefined, { vram_max_mib: 100 })).toEqual({ medidas: { vram_max_mib: 100 } });
    expect(conMedidas(["a"], { vram_max_mib: 100 })).toEqual(["a"]);
    expect(conMedidas({ a: 1 }, { muestras: 0 })).toEqual({ a: 1 });
  });
});
