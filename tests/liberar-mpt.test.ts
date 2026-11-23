import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.GEEPER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-liberar-"));
process.env.GEEPER_LIBERAR_MPT = "1";

// Docker simulado: qué contenedores corren y qué órdenes llegan.
const corriendo = new Set<string>();
const ordenes: string[] = [];
vi.mock("@/lib/proceso", () => ({
  correr: async (cmd: string, args: string[]) => {
    ordenes.push(`${cmd} ${args.join(" ")}`);
    const [orden, ...resto] = args;
    const c = resto[resto.length - 1]!;
    if (orden === "inspect") return { codigo: 0, stdout: corriendo.has(c) ? "true\n" : "false\n", stderr: "" };
    if (orden === "stop") corriendo.delete(c);
    if (orden === "start") corriendo.add(c);
    return { codigo: 0, stdout: "", stderr: "" };
  },
}));

const m = await import("@/lib/liberar-mpt");

beforeEach(() => {
  ordenes.length = 0;
  corriendo.clear();
  corriendo.add("mpt-ollama").add("mpt-image-server").add("mpt-kokoro");
});

describe("memoria para Wan2GP en la app de escritorio", () => {
  it("para Ollama y el servidor de imágenes (no la voz) y los levanta antes de pedirle algo a MPT", async () => {
    const log: string[] = [];
    expect(await m.pausarParaWan((l) => log.push(l))).toEqual(["mpt-ollama", "mpt-image-server"]);
    expect([...corriendo]).toEqual(["mpt-kokoro"]);
    expect(log[0]).toMatch(/Wan2GP/);
    await m.asegurarMpt();
    expect(corriendo.has("mpt-ollama") && corriendo.has("mpt-image-server")).toBe(true);
  });

  it("varios pasos de Wan seguidos no los levantan entre medio; un rato después, sí", async () => {
    vi.useFakeTimers();
    await m.pausarParaWan();
    m.reanudarLuego(1000);
    await m.pausarParaWan(); // el siguiente paso empieza antes: cancela el reanudar
    await vi.advanceTimersByTimeAsync(5000);
    expect(ordenes.some((o) => o.startsWith("docker start"))).toBe(false);
    m.reanudarLuego(1000);
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    // El reanudar ya arrancó; termina con E/S de verdad (leer la nota).
    await vi.waitFor(() => expect(corriendo.has("mpt-image-server")).toBe(true));
  });

  it("si el worker se cortó con ellos parados, al arrancar vuelven; lo que ya estaba parado no se toca", async () => {
    corriendo.delete("mpt-ollama");
    expect(await m.pausarParaWan()).toEqual(["mpt-image-server"]);
    await m.reanudarPendientes();
    expect(corriendo.has("mpt-image-server")).toBe(true);
    expect(corriendo.has("mpt-ollama")).toBe(false);
  });

  it("antes de un video de MPT levanta también los que estaban parados por otra cosa (no los que no existen)", async () => {
    corriendo.delete("mpt-ollama");
    corriendo.delete("mpt-image-server");
    await m.asegurarMpt();
    expect(corriendo.has("mpt-ollama")).toBe(false);
    await m.asegurarMpt(undefined, { todos: true });
    expect(corriendo.has("mpt-ollama") && corriendo.has("mpt-image-server")).toBe(true);
  });

  it("fuera de la app de escritorio no toca Docker (desarrollo y las demás pruebas)", async () => {
    delete process.env.GEEPER_LIBERAR_MPT;
    try {
      expect(await m.pausarParaWan()).toEqual([]);
      await m.asegurarMpt(undefined, { todos: true });
      expect(ordenes).toEqual([]);
    } finally {
      process.env.GEEPER_LIBERAR_MPT = "1";
    }
  });

  it("si WSL se reinició y tumbó la API de MPT, la levanta (con los pesados) y saca de la nota lo levantado", async () => {
    corriendo.clear();
    corriendo.add("mpt-kokoro");
    const log: string[] = [];
    expect(await m.levantarMptCaido((l) => log.push(l))).toEqual(["moneyprinterturbo-api", "moneyprinterturbo-webui", "mpt-ollama", "mpt-image-server"]);
    expect(log[0]).toMatch(/estaba parado/);
    // Ya están todos: no hace nada.
    expect(await m.levantarMptCaido()).toEqual([]);
  });
});
