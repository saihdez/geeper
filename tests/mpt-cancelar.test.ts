import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candadoArchivo } from "@/lib/gpu";
import { soltarCuandoTermine, type EstadoMpt } from "@/lib/mpt";

describe("cancelar «Generar video» no suelta la tarjeta mientras MPT sigue (GPU-03)", () => {
  it("con soltarAlCancelar: false, cancelar no suelta el candado ya tomado", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpu-"));
    const archivo = path.join(dir, ".gpu.lock");
    const ctrl = new AbortController();
    const c = (await candadoArchivo(archivo, "mpt", { esperar: false, signal: ctrl.signal, soltarAlCancelar: false }))!;
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(await candadoArchivo(archivo, "otro", { esperar: false })).toBeNull();
    c.liberar();
    await new Promise((r) => setTimeout(r, 50));
    expect(await candadoArchivo(archivo, "otro", { esperar: false })).not.toBeNull();
  });

  it("suelta cuando MPT da la tarea por terminada, fallida o perdida", async () => {
    const estados: EstadoMpt["estado"][] = ["procesando", "procesando", "fallida"];
    let suelto = 0;
    const fin = await soltarCuandoTermine("t1", { liberar: () => suelto++ }, { pasoMs: 10, estado: async () => ({ estado: estados.shift() ?? "completa", progreso: 0 }) });
    expect(fin).toBe("fallida");
    expect(suelto).toBe(1);
  });

  it("si MPT no responde o no termina, suelta al llegar al tope", async () => {
    let suelto = 0;
    const fin = await soltarCuandoTermine("t2", { liberar: () => suelto++ }, { topeMs: 100, pasoMs: 10, estado: async () => Promise.reject(new Error("caído")) });
    expect(fin).toBe("tope");
    expect(suelto).toBe(1);
  });
});
