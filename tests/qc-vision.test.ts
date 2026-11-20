import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EjecutorLlm } from "@/lib/llm-local";
import { promptQcVision, reglaVisual, revisarHojaVisual } from "@/lib/qc-vision";

const fotos = [{ nota: "Escena 1" }, { nota: "Escena 2" }, { nota: "Tarjeta final" }];
const hoja = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "geeper-qcv-")), "hoja.jpg");
fs.writeFileSync(hoja, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
const libre = async () => ({ liberar: () => {} });

describe("QC visual con IA (E1)", () => {
  it("apagado por defecto: no hay regla", async () => {
    delete process.env.GEEPER_QC_VISION;
    expect(await revisarHojaVisual(hoja, fotos)).toBeNull();
  });

  it("manda la hoja como imagen y arma un aviso que nunca bloquea", async () => {
    let pedido: { messages: { images?: string[] }[]; options: { temperature?: number } } | null = null;
    const ejecutar: EjecutorLlm = async (cuerpo) => {
      pedido = JSON.parse(cuerpo);
      return { codigo: 0, stdout: JSON.stringify({ message: { content: JSON.stringify({ problemas: [{ fotograma: 2, tipo: "mano", gravedad: "grave", nota: "seis dedos" }, { fotograma: 9, tipo: "cara", gravedad: "grave", nota: "fuera de la hoja" }] }) } }), stderr: "" };
    };
    const r = await revisarHojaVisual(hoja, fotos, { modelo: "qwen3-vl:8b", ejecutar, candado: libre });
    expect(pedido!.messages.at(-1)!.images).toEqual([Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")]);
    expect(pedido!.options.temperature).toBe(0);
    expect(r).toMatchObject({ id: "visual-ia", ok: false, aviso: true, detalle: "Escena 2: mano (grave) — seis dedos" });
  });

  it("los leves se listan pero no marcan", () => {
    expect(reglaVisual("m", { problemas: [{ fotograma: 1, tipo: "texto", gravedad: "leve", nota: "letra rara" }] }, fotos)).toMatchObject({ ok: true, aviso: true, detalle: expect.stringMatching(/letra rara/) });
  });

  it("si no se pudo revisar, lo dice sin tumbar el QC", async () => {
    const r = await revisarHojaVisual(hoja, fotos, { modelo: "m", ejecutar: async () => ({ codigo: 1, stdout: "", stderr: "docker API daemon" }), candado: libre });
    expect(r).toMatchObject({ aviso: true, detalle: expect.stringMatching(/No se pudo revisar: .*Docker Desktop/) });
    const ocupada = await revisarHojaVisual(hoja, fotos, { modelo: "m", candado: async () => null });
    expect(ocupada?.detalle).toMatch(/ocupada/);
  });

  it("el prompt describe la hoja y sus recuadros", () => {
    expect(promptQcVision(fotos, 3)).toMatch(/3 recuadros en 3 columnas.*\n.*1 = Escena 1; 2 = Escena 2; 3 = Tarjeta final/);
  });
});
