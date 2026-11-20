import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-trazas-"));
process.env.GEEPER_DATA = dir;
delete process.env.GEEPER_TRAZAS;
delete process.env.GEEPER_OTLP_URL;

let trazas: typeof import("@/lib/trazas");
let llm: typeof import("@/lib/llm-local");
let pasos: typeof import("@/lib/pasos");

beforeAll(async () => {
  trazas = await import("@/lib/trazas");
  llm = await import("@/lib/llm-local");
  pasos = await import("@/lib/pasos");
  trazas.iniciarTrazas("prueba");
});

const TOKEN = `ya29.${"a1B2c3D4e5".repeat(4)}`;

describe("trazas OpenTelemetry (C1)", () => {
  it("un trabajo queda como árbol: trabajo → paso → llamada al modelo, con tiempos y tokens", async () => {
    const proyecto = path.join(dir, "proy");
    fs.mkdirSync(proyecto, { recursive: true });
    const ctx = { dir: proyecto, log: () => {} };
    const ejecutar: import("@/lib/llm-local").EjecutorLlm = async () => ({
      codigo: 0,
      stdout: JSON.stringify({ message: { content: '{"ok":true}' }, prompt_eval_count: 50, eval_count: 7 }),
      stderr: "",
    });
    await trazas.enSpan("trabajo render.entregar", { "geeper.trabajo.id": "t1", "geeper.motor": "render" }, async () => {
      await pasos.paso(ctx, "mezcla", { archivos: [], params: { a: 1 }, motor: "prueba" }, [path.join(proyecto, "salida.txt")], async ([tmp]) => {
        await llm.pedirJson("gemma4:12b", "hola", z.object({ ok: z.boolean() }), { tarea: "prueba", ejecutar, candado: async () => ({ liberar: () => {} }) });
        fs.writeFileSync(tmp!, "x");
        return {};
      });
      // La segunda vez el paso se salta (mismo input_hash).
      await pasos.paso(ctx, "mezcla", { archivos: [], params: { a: 1 }, motor: "prueba" }, [path.join(proyecto, "salida.txt")], async () => ({}));
    });

    const spans = trazas.spansDeTrabajo("t1");
    expect(spans.map((s) => s.nombre)).toEqual(["trabajo render.entregar", "paso mezcla", "chat gemma4:12b", "paso mezcla"]);
    const [trabajo, paso1, chat, paso2] = spans;
    expect(paso1!.padre).toBe(trabajo!.span);
    expect(chat!.padre).toBe(paso1!.span);
    expect(chat!.atributos).toMatchObject({ "gen_ai.operation.name": "chat", "gen_ai.request.model": "gemma4:12b", "gen_ai.usage.input_tokens": 50, "gen_ai.usage.output_tokens": 7 });
    expect(paso1!.atributos["geeper.input_hash"]).toMatch(/^[a-f0-9]{64}$/);
    expect(paso2!.atributos["geeper.paso.saltado"]).toBe(true);

    const filas = trazas.filasDePasos(spans);
    expect(filas.map((f) => f.nivel)).toEqual([0, 1, 2, 1]);
    expect(filas[2]!.detalle).toBe("50 → 7 tokens");
    expect(filas[3]!.detalle).toBe("ya hecho, se saltó");
  });

  it("un error marca el span y ningún token llega al archivo (los registrados y los de patrón conocido)", async () => {
    const { registrarSecreto } = await import("@/lib/redes/secretos");
    registrarSecreto(TOKEN);
    await expect(
      trazas.enSpan("trabajo publicar.subir", { "geeper.trabajo.id": "t2", "geeper.nota": `usa ${TOKEN}`, "geeper.cabecera": "Authorization: Bearer abcdefghijklmnop123" }, async () => {
        throw new Error(`falló con ${TOKEN}`);
      }),
    ).rejects.toThrow();
    const [s] = trazas.spansDeTrabajo("t2");
    expect(s!.estado).toBe("error");
    const archivos = fs.readdirSync(trazas.dirTrazas()).map((a) => fs.readFileSync(path.join(trazas.dirTrazas(), a), "utf8")).join("");
    expect(archivos).not.toContain(TOKEN);
    expect(archivos).not.toContain("abcdefghijklmnop123");
    expect(s!.error).toBe("falló con [oculto]");
  });

  it("una espera (vuelve a la cola) no cuenta como error", async () => {
    class Espera extends Error {}
    await expect(trazas.enSpan("trabajo x", { "geeper.trabajo.id": "t3" }, async () => { throw new Espera("esperando la VPN"); }, { noEsError: (e) => e instanceof Espera })).rejects.toThrow();
    const [s] = trazas.spansDeTrabajo("t3");
    expect(s!.estado).not.toBe("error");
    expect(s!.atributos["geeper.resultado"]).toBe("esperando la VPN");
  });

  it("borra los archivos de más de 14 días", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-rotar-"));
    for (const f of ["2026-11-01.jsonl", "2026-11-06.jsonl", "2026-11-20.jsonl", "otro.txt"]) fs.writeFileSync(path.join(d, f), "");
    expect(trazas.rotarTrazas(d, 14, new Date("2026-11-20T10:00:00Z"))).toEqual(["2026-11-01.jsonl"]);
    expect(fs.readdirSync(d).sort()).toEqual(["2026-11-06.jsonl", "2026-11-20.jsonl", "otro.txt"]);
  });
});
