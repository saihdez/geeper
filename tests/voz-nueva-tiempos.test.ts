/**
 * REN-05: al rehacer toda la voz, whisper con VAD dejó los tiempos hasta 1,8 s tarde; las últimas
 * palabras caían después del final y la última escena duraba 0,05 s. Con datos sintéticos (un WAV de
 * 3 s hecho con ffmpeg y un whisper falso), sin modelos.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FFMPEG } from "@/lib/rutas";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-voz-nueva-"));
const wav = path.join(dir, "assets", "voz-tts-prueba.wav");
const TEXTO = "Hola mundo esto es una prueba";

/** Una palabra cada 0,5 s, con `corrimiento` s de más (lo que hacía el VAD). */
const oidas = (corrimiento: number) =>
  TEXTO.split(" ").map((t, k) => ({ text: t, start: k * 0.5 + corrimiento, end: k * 0.5 + 0.4 + corrimiento, p: 0.95 }));

const llamadas: (boolean | undefined)[] = [];
let respuesta: (vad: boolean | undefined) => ReturnType<typeof oidas> = () => oidas(0);
vi.mock("@/lib/whisper", async (orig) => ({
  ...(await orig<typeof import("@/lib/whisper")>()),
  whisperDirectoDisponible: async () => true,
  transcribirWhisper: async (_a: string, o: { vad?: boolean }) => (llamadas.push(o.vad), respuesta(o.vad)),
}));
vi.mock("@/lib/modelos", () => ({ etiquetaPesos: async (m: string) => `${m}@sin-pesos-locales`, huellaPesos: async () => null }));

const ctx = { dir, log: () => {} };

beforeAll(() => {
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-ar", "16000", "-ac", "1", wav]);
});

beforeEach(() => {
  llamadas.length = 0;
  // Sin manifiestos ni salidas del caso anterior (si no, el paso los reutiliza).
  for (const f of fs.readdirSync(path.join(dir, "assets"))) if (f.startsWith("palabras-")) fs.rmSync(path.join(dir, "assets", f));
  fs.rmSync(path.join(dir, "manifiestos"), { recursive: true, force: true });
});

describe("palabrasFueraDelAudio", () => {
  it("cuenta las que empiezan en el final o terminan después", async () => {
    const { palabrasFueraDelAudio } = await import("@/lib/voz");
    expect(palabrasFueraDelAudio(oidas(0), 3)).toBe(0);
    // Corridas 1,8 s: las tres últimas (de 2,8 s en adelante) quedan fuera de 3 s de voz.
    expect(palabrasFueraDelAudio(oidas(1.8), 3)).toBe(4);
  });
});

describe("alinearVozNueva", () => {
  it("alinea primero sin VAD y se queda con esos tiempos si caben en el audio", async () => {
    const { alinearVozNueva } = await import("@/lib/voz");
    respuesta = (vad) => oidas(vad === false ? 0 : 1.8);
    const palabras = await alinearVozNueva(ctx, wav, TEXTO, "es");
    expect(llamadas).toEqual([false]);
    expect(palabras.map((w) => w.texto)).toEqual(TEXTO.split(" "));
    expect(palabras.at(-1)!.inicio).toBeCloseTo(2.5, 2);
    expect(palabras.every((w) => w.fin > w.inicio)).toBe(true);
  });

  it("si sin VAD quedan palabras fuera, prueba con VAD", async () => {
    const { alinearVozNueva } = await import("@/lib/voz");
    respuesta = (vad) => oidas(vad === false ? 1.8 : 0);
    const palabras = await alinearVozNueva(ctx, wav, TEXTO, "es");
    expect(llamadas).toEqual([false, true]);
    expect(palabras.at(-1)!.inicio).toBeCloseTo(2.5, 2);
  });

  it("si las dos quedan corridas, no devuelve tiempos: falla diciendo qué cambiar", async () => {
    const { alinearVozNueva, NO_SE_ACOMODA } = await import("@/lib/voz");
    respuesta = () => oidas(1.8);
    await expect(alinearVozNueva(ctx, wav, TEXTO, "es", { escena: 3 })).rejects.toThrow(
      `${NO_SE_ACOMODA} Cambia un poco el texto de la escena 3 o elige otro ritmo de voz.`,
    );
  });

  it("una alineación mala no queda guardada: al pedirla otra vez se vuelve a alinear", async () => {
    const { alinearVozNueva } = await import("@/lib/voz");
    respuesta = () => oidas(1.8);
    await expect(alinearVozNueva(ctx, wav, TEXTO, "es")).rejects.toThrow(/otro ritmo de voz/);
    expect(llamadas).toEqual([false, true]);
    respuesta = () => oidas(0);
    const palabras = await alinearVozNueva(ctx, wav, TEXTO, "es");
    expect(llamadas).toEqual([false, true, false]);
    expect(palabras.at(-1)!.inicio).toBeCloseTo(2.5, 2);
  });

  it("la revisión de quien llama también cuenta, y dice qué escena cambiar", async () => {
    const { alinearVozNueva } = await import("@/lib/voz");
    respuesta = () => oidas(0);
    const revisar = () => ({ problema: "la escena 2 quedaría de menos de 0.2 s", escena: 2 });
    await expect(alinearVozNueva(ctx, wav, TEXTO, "es", { revisar })).rejects.toThrow(/el texto de la escena 2 o elige otro ritmo/);
    expect(llamadas).toEqual([false, true]);
  });
});

describe("Reparto del guion completo en escenas", () => {
  it("detecta la escena de 0,05 s que quedó en la versión 20 (49,908 s + 0,05 s)", async () => {
    const { escenaMuyCorta, repartirGuion } = await import("@/lib/regenerar");
    // Las dos últimas palabras, corridas más allá del final y recortadas a él (49,958 s).
    const palabras = [
      { texto: "una", inicio: 48.9, fin: 49.3 },
      { texto: "frase", inicio: 49.35, fin: 49.85 },
      { texto: "final", inicio: 49.958, fin: 49.958 },
      { texto: "aquí", inicio: 49.958, fin: 49.958 },
    ];
    const { limites } = repartirGuion(palabras, [2, 2], 49.958);
    expect(escenaMuyCorta(limites)).toBe(2);
    expect(escenaMuyCorta(repartirGuion(oidas(0).map((w) => ({ texto: w.text, inicio: w.start, fin: w.end })), [3, 3], 3).limites)).toBeNull();
  });
});
