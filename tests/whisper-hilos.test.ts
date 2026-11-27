/** GPU-04: whisper-cli usa los núcleos de la máquina (sin `-t` se quedaba en 4 de 32). Sin whisper real. */
import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ llamadas: [] as { bin: string; args: string[] }[] }));

vi.mock("@/lib/proceso", async (orig) => ({
  ...(await orig<typeof import("@/lib/proceso")>()),
  correr: async (bin: string, args: string[]) => {
    m.llamadas.push({ bin, args });
    const i = args.indexOf("--output-file");
    if (i >= 0) await fs.writeFile(`${args[i + 1]}.json`, JSON.stringify({ transcription: [] }));
    return { codigo: 0, stdout: "", stderr: "" };
  },
}));

const { hilosWhisper, transcribirWhisper } = await import("@/lib/whisper");

describe("hilos de whisper (GPU-04)", () => {
  it("la mitad de los núcleos, entre 4 y 8; nunca más que los que hay", () => {
    expect(hilosWhisper(32, undefined)).toBe(8);
    expect(hilosWhisper(12, undefined)).toBe(6);
    expect(hilosWhisper(8, undefined)).toBe(4);
    expect(hilosWhisper(4, undefined)).toBe(4);
    expect(hilosWhisper(2, undefined)).toBe(2);
    expect(hilosWhisper(1, undefined)).toBe(1);
  });

  it("GEEPER_WHISPER_HILOS lo fija a mano; un valor raro se ignora", () => {
    expect(hilosWhisper(32, "12")).toBe(12);
    expect(hilosWhisper(32, "0")).toBe(8);
    expect(hilosWhisper(32, "muchos")).toBe(8);
  });

  it("transcribirWhisper pasa --threads a whisper-cli", async () => {
    m.llamadas = [];
    await transcribirWhisper("/tmp/no-importa.mp3", { modelo: "small", idioma: "es", vad: false });
    const cli = m.llamadas.find((l) => l.args.includes("--output-json-full"))!;
    const i = cli.args.indexOf("--threads");
    expect(i).toBeGreaterThan(-1);
    expect(Number(cli.args[i + 1])).toBe(hilosWhisper());
  });
});
