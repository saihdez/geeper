import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { puntuarPalabras, topePorProbabilidad, UMBRAL_DUDOSA } from "@/lib/confianza";
import { runtimeJsYtdlp } from "@/lib/fuentes";
import { FFMPEG } from "@/lib/rutas";
import { limpiarGlosario, palabrasDeWhisperJson, rutaModeloWhisper, rutaWhisperCli, transcribirWhisper } from "@/lib/whisper";

const tok = (text: string, from: number, to: number, p = 0.99) => ({ text, p, offsets: { from, to } });

describe("palabrasDeWhisperJson", () => {
  it("une tokens en palabras, ignora marcas y toma la menor p sin contar la puntuación", () => {
    const j = {
      transcription: [
        {
          tokens: [tok("[_BEG_]", 0, 0), tok(" Dis", 100, 200, 0.98), tok("pers", 200, 450, 0.9), tok("os", 450, 590, 0.95), tok(" se", 600, 700), tok(" hier", 700, 900, 0.31), tok("guen", 900, 1100, 0.8), tok(".", 1100, 1100, 0.05)],
        },
      ],
    };
    expect(palabrasDeWhisperJson(j)).toEqual([
      { text: "Dispersos", start: 0.1, end: 0.59, p: 0.9 },
      { text: "se", start: 0.6, end: 0.7, p: 0.99 },
      { text: "hierguen.", start: 0.7, end: 1.1, p: 0.31 },
    ]);
  });

  it("reparte las palabras de duración cero entre sus vecinas", () => {
    const j = { transcription: [{ tokens: [tok(" a", 0, 500), tok(" b", 500, 500), tok(" c", 500, 500), tok(" d", 900, 1000)] }] };
    const w = palabrasDeWhisperJson(j);
    expect(w.map((x) => [x.start, x.end])).toEqual([
      [0, 0.5],
      [0.5, 0.7],
      [0.7, 0.9],
      [0.9, 1],
    ]);
  });

  it("descarta la puntuación suelta al principio", () => {
    const j = { transcription: [{ tokens: [tok(" ¿", 0, 100, 0.2), tok(" Qué", 100, 300, 0.9)] }] };
    expect(palabrasDeWhisperJson(j)).toEqual([{ text: "Qué", start: 0.1, end: 0.3, p: 0.9 }]);
  });

  it("acepta un JSON sin transcripción", () => {
    expect(palabrasDeWhisperJson({})).toEqual([]);
  });
});

describe("glosario", () => {
  it("separa por coma, punto y coma o salto, quita repetidos y vacíos", () => {
    expect(limpiarGlosario(" GTA VI ,Lucia;\nVice   City,, Lucia ")).toBe("GTA VI, Lucia, Vice City");
    expect(limpiarGlosario("")).toBeNull();
    expect(limpiarGlosario(undefined)).toBeNull();
  });

  it("no pasa de 400 caracteres ni corta un término", () => {
    const g = limpiarGlosario(Array.from({ length: 100 }, (_, i) => `termino${i}`).join(","))!;
    expect(g.length).toBeLessThanOrEqual(400);
    expect(g.endsWith(",")).toBe(false);
    expect(g.split(", ").every((t) => /^termino\d+$/.test(t))).toBe(true);
  });
});

describe("confianza con la probabilidad de whisper", () => {
  it("tope: < 0,35 dudosa, sube hasta 1 en 0,85", () => {
    expect(topePorProbabilidad(0.28)).toBeLessThan(UMBRAL_DUDOSA);
    expect(topePorProbabilidad(0.35)).toBeCloseTo(0.6);
    expect(topePorProbabilidad(0.6)).toBeCloseTo(0.8);
    expect(topePorProbabilidad(0.85)).toBe(1);
    expect(topePorProbabilidad(0.99)).toBe(1);
  });

  const oidas = [
    { text: "faros", start: 0, end: 0.4, p: 0.99 },
    { text: "hierguen", start: 0.5, end: 0.9, p: 0.31 },
  ];
  const palabras = oidas.map((o) => ({ texto: o.text, inicio: o.start, fin: o.end }));

  it("en clips (palabras = lo que oyó whisper) marca la palabra improbable", () => {
    const r = puntuarPalabras(palabras, oidas, [], { probabilidad: true });
    expect(r[0]!.confianza).toBe(1);
    expect(r[1]!.confianza!).toBeLessThan(UMBRAL_DUDOSA);
  });

  it("sin la opción (voz TTS alineada al guion) no cambia nada", () => {
    const r = puntuarPalabras(palabras, oidas, []);
    expect(r.map((w) => w.confianza)).toEqual([1, 1]);
  });
});

describe("yt-dlp", () => {
  it("usa el Node de Geeper como runtime de JavaScript", () => {
    const js = runtimeJsYtdlp();
    expect(js.args).toEqual(["--js-runtimes", `node:${process.execPath}`]);
  });
});

// Integración: whisper real sobre una voz de ~/geeper-data con 6 s de ruido rosa al final. Se salta si
// whisper, el modelo o la voz no están en esta máquina.
const vozReal = path.join(os.homedir(), "geeper-data", "faros-en-costas-escarpadas-92736d", "assets", "voz-mpt.mp3");
const hay = fs.existsSync(rutaWhisperCli()) && fs.existsSync(rutaModeloWhisper("medium")) && fs.existsSync(vozReal);

describe.skipIf(!hay)("whisper directo (real)", () => {
  it("trae p por palabra y no inventa palabras en la cola sin voz", { timeout: 180_000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-wt-"));
    try {
      const wav = path.join(tmp, "prueba.wav");
      // 8 s de voz + 6 s de ruido rosa suave (sin voz).
      execFileSync(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", vozReal, "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.05:duration=6:sample_rate=16000",
        "-filter_complex", "[0]atrim=0:8,aresample=16000,aformat=channel_layouts=mono[v];[1]aformat=channel_layouts=mono[n];[v][n]concat=n=2:v=0:a=1", "-ar", "16000", "-ac", "1", wav,
      ]);
      const w = await transcribirWhisper(wav, { modelo: "medium", idioma: "es" });
      expect(w.length).toBeGreaterThan(10);
      expect(w.every((x) => typeof x.p === "number" && x.p >= 0 && x.p <= 1)).toBe(true);
      expect(w.filter((x) => x.start > 8.3)).toEqual([]);
      expect(w[0]!.text.toLowerCase()).toContain("dispers");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
