/** GPU-05: varios sonidos con una sola carga de MOSS (proceso falso: sin tarjeta ni modelo). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-efectos-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_MOSS_PYTHON = process.execPath; // «instalado»: el proceso real no se llama
const ef = await import("@/lib/efectos-sonido");

/** MOSS falso: escribe un WAV por pedido (salvo los que se pidan fallar) y las medidas al final. */
function mossFalso(fallar: string[] = []) {
  const llamadas: { prompt: string; salida: string }[][] = [];
  const correr: import("@/lib/efectos-sonido").CorrerMoss = async (pedido) => {
    const lista = JSON.parse(pedido) as { prompt: string; salida: string }[];
    llamadas.push(lista);
    const lineas = [JSON.stringify({ cargado_s: 80.5 })];
    for (const p of lista) {
      if (fallar.includes(p.prompt)) continue;
      fs.writeFileSync(p.salida, "RIFF");
      lineas.push(JSON.stringify({ salida: p.salida, generar_s: 9 }));
    }
    lineas.push(JSON.stringify({ vram_pico_gb: 14.5, total_s: 120 }));
    return { codigo: 0, stdout: lineas.join("\n"), stderr: "" };
  };
  return { correr, llamadas };
}

const ctx = { dir, log: () => undefined };

describe("generarEfectos (GPU-05)", () => {
  it("los sonidos que faltan van todos a un solo proceso; los que ya están no usan la tarjeta", async () => {
    const m = mossFalso();
    const primero = await ef.generarEfecto(ctx, { nombre: "Whoosh", prompt: ef.PRESETS[0].prompt, segundos: ef.PRESETS[0].segundos }, { correr: m.correr });
    expect(primero.nombre).toBe("Whoosh");
    expect(m.llamadas).toHaveLength(1);
    const faltan = await ef.presetsQueFaltan();
    expect(faltan).toHaveLength(ef.PRESETS.length - 1);
    const r = await ef.generarEfectos(ctx, [...faltan, faltan[0]!], { correr: m.correr });
    expect(m.llamadas).toHaveLength(2);
    expect(m.llamadas[1]).toHaveLength(faltan.length); // sin repetidos
    expect(r.generados).toBe(faltan.length);
    expect(r.medidas).toEqual({ cargado_s: 80.5, vram_pico_gb: 14.5, total_s: 120 });
    expect(await ef.presetsQueFaltan()).toEqual([]);
    // Todo en la biblioteca: no hay proceso.
    const otra = await ef.generarEfectos(ctx, faltan, { correr: m.correr });
    expect(m.llamadas).toHaveLength(2);
    expect(otra.generados).toBe(0);
  });

  it("si uno no sale, se guardan los demás; si no sale ninguno, avisa", async () => {
    const pedidos = [
      { nombre: "A", prompt: "a thing", segundos: 2 },
      { nombre: "B", prompt: "b thing", segundos: 2 },
    ];
    const r = await ef.generarEfectos(ctx, pedidos, { correr: mossFalso(["b thing"]).correr });
    expect(r.generados).toBe(1);
    expect(r.fallidos).toEqual(["B"]);
    await expect(ef.generarEfectos(ctx, [{ nombre: "C", prompt: "c thing", segundos: 2 }], { correr: mossFalso(["c thing"]).correr })).rejects.toThrow(/No se pudo crear el sonido/);
  });

  it("describir en inglés usa el modelo chico por defecto", () => {
    expect(ef.MODELO_DESCRIBIR).toBe("gemma4:12b");
  });
});
