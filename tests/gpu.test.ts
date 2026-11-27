import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candadoArchivo } from "@/lib/gpu";

describe("candado de GPU por archivo (Windows, macOS, app)", () => {
  it("uno a la vez; sin esperar devuelve null; al soltar se puede volver a tomar", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpu-"));
    const archivo = path.join(dir, ".gpu.lock");
    const a = await candadoArchivo(archivo, "render a", { esperar: false });
    expect(a).not.toBeNull();
    let quien = "";
    expect(await candadoArchivo(archivo, "render b", { esperar: false, alEsperar: (q) => (quien = q) })).toBeNull();
    a!.liberar();
    await new Promise((r) => setTimeout(r, 50));
    const b = await candadoArchivo(archivo, "render b", { esperar: false });
    expect(b).not.toBeNull();
    b!.liberar();
    expect(quien).toBe("");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("toma un candado abandonado (dueño muerto)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpu-"));
    const archivo = path.join(dir, ".gpu.lock");
    await fs.writeFile(archivo, JSON.stringify({ pid: 2 ** 22 + 12345, quien: "geeper:viejo", desde: "2026-01-01" }));
    const c = await candadoArchivo(archivo, "nuevo", { esperar: false });
    expect(c).not.toBeNull();
    expect(JSON.parse(await fs.readFile(archivo, "utf8")).quien).toBe("geeper:nuevo");
    c!.liberar();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("si espera, avisa quién la tiene y la toma cuando se suelta", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpu-"));
    const archivo = path.join(dir, ".gpu.lock");
    const a = (await candadoArchivo(archivo, "primero", { esperar: false }))!;
    const avisos: string[] = [];
    const espera = candadoArchivo(archivo, "segundo", { esperar: true, alEsperar: (q) => avisos.push(q) });
    setTimeout(() => a.liberar(), 100);
    const b = await espera;
    expect(b).not.toBeNull();
    expect(avisos[0]).toBe("geeper:primero");
    b!.liberar();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("un candado ilegible recién creado cuenta como ocupado; viejo, como abandonado (GPU-11)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpu-"));
    const archivo = path.join(dir, ".gpu.lock");
    await fs.writeFile(archivo, ""); // otro lo acaba de crear y todavía no escribió
    expect(await candadoArchivo(archivo, "b", { esperar: false })).toBeNull();
    const viejo = new Date(Date.now() - 10_000);
    await fs.utimes(archivo, viejo, viejo);
    const c = await candadoArchivo(archivo, "c", { esperar: false });
    expect(c).not.toBeNull();
    // Soltarlo con el archivo roto no deja un error sin atender.
    await fs.writeFile(archivo, "{roto");
    c!.liberar();
    await new Promise((r) => setTimeout(r, 50));
    await fs.rm(dir, { recursive: true, force: true });
  });
});
