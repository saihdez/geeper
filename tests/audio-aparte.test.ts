import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpeg, probar } from "@/lib/media";
import { calcularInputHash } from "@/lib/pasos";
import { argsLimitador, asegurarPicoReal, filtroLoudnorm, medirSonoridad, normalizarAudio } from "@/lib/qc";
import { entradasCaptura } from "@/lib/render-entradas";
import { FFMPEG } from "@/lib/rutas";

/**
 * REN-07: el sonido de la entrega sale de la mezcla en WAV y del render sólo se toma el video, así
 * que cambiar sólo el audio no vuelve a capturar.
 */
const hayFfmpeg = existsSync(FFMPEG);
const dir = path.join(os.tmpdir(), `geeper-audio-aparte-${process.pid}`);
const crudo = path.join(dir, "build", "crudo.mp4");
const mezcla = path.join(dir, "build", "mezcla.wav");

describe("la captura no depende de la mezcla", () => {
  it("quita sólo la mezcla de las entradas de la captura", () => {
    const archivos = ["/p/build/hf/index.html", "/p/build/mezcla.wav", "/p/assets/a.mp4"];
    expect(entradasCaptura(archivos, "/p/build/./mezcla.wav")).toEqual(["/p/build/hf/index.html", "/p/assets/a.mp4"]);
  });
});

describe.skipIf(!hayFfmpeg)("entrega con el audio aparte", () => {
  beforeAll(async () => {
    await fs.mkdir(path.dirname(crudo), { recursive: true });
    // Crudo de 2 s con audio mudo (el «audio viejo») y una mezcla nueva de 1,5 s con un tono.
    await ffmpeg([
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=2",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", crudo,
    ]);
    await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.5", "-ac", "2", mezcla]);
  }, 60_000);
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("el sonido sale del WAV y dura lo mismo que el video", async () => {
    const salida = path.join(dir, "final.mp4");
    await normalizarAudio(crudo, salida, () => {}, 30, mezcla);
    const info = await probar(salida);
    expect(Number(info.video?.duration)).toBeCloseTo(2, 1);
    expect(Number(info.audio?.duration)).toBeGreaterThan(1.9);
    expect(Number(info.audio?.duration)).toBeLessThan(2.1);
    // No es el silencio del crudo: es el tono de la mezcla.
    expect(Number((await medirSonoridad(salida)).input_i)).toBeGreaterThan(-30);
  }, 60_000);

  it("cambiar la mezcla no cambia la clave de la captura", async () => {
    const ctx = { dir, log: () => {} };
    const archivos = [crudo, mezcla];
    const entradas = () => ({ archivos: entradasCaptura(archivos, mezcla), params: {}, motor: "x" });
    const antes = await calcularInputHash(ctx, "hyperframes.render", entradas());
    await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=1.5", "-ac", "2", mezcla]);
    expect(await calcularInputHash(ctx, "hyperframes.render", entradas())).toBe(antes);
  }, 60_000);
});

describe("el limitador de pico parte de la mezcla (REN-07)", () => {
  const medido = { input_i: "-20.0", input_tp: "-3.0", input_lra: "5.0", input_thresh: "-30.0", target_offset: "0.1" };

  it("con la mezcla, toma el audio del WAV con loudnorm y copia el video", () => {
    const a = argsLimitador("/p/final.mp4", "/p/tmp.mp4", -1.5, { audio: "/p/mezcla.wav", medido }, 2);
    expect(a.slice(a.indexOf("-i"), a.indexOf("-c:v"))).toEqual(["-i", "/p/final.mp4", "-i", "/p/mezcla.wav", "-map", "0:v:0", "-map", "1:a:0", "-t", "2.000"]);
    const filtro = a[a.indexOf("-af") + 1]!;
    expect(filtro.startsWith(filtroLoudnorm(medido))).toBe(true);
    expect(filtro).toContain("alimiter=limit=0.8414");
    expect(a[a.indexOf("-c:v") + 1]).toBe("copy");
  });

  it("sin la mezcla, recodifica el audio del propio archivo", () => {
    const a = argsLimitador("/p/final.mp4", "/p/tmp.mp4", -1.5);
    expect(a).toContain("0:a:0");
    expect(a.join(" ")).not.toContain("loudnorm");
  });
});

describe.skipIf(!hayFfmpeg)("limitador desde la mezcla con ffmpeg", () => {
  const d = path.join(os.tmpdir(), `geeper-pico-${process.pid}`);
  const final = path.join(d, "final.mp4");
  const wav = path.join(d, "mezcla.wav");
  beforeAll(async () => {
    await fs.mkdir(d, { recursive: true });
    // Entrega con un audio cuadrado casi a 0 dBFS (pico por encima de −1 dBTP) y una mezcla con un tono suave.
    await ffmpeg([
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=2",
      "-f", "lavfi", "-i", "aevalsrc='0.99*sgn(sin(2*PI*220*t))':s=48000:d=2", "-ac", "2", "-t", "2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", final,
    ]);
    await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.5", "-ac", "2", wav]);
  }, 60_000);
  afterAll(() => fs.rm(d, { recursive: true, force: true }));

  it("el reintento rehace el sonido desde el WAV, deja el pico bajo −1 dBTP y dura lo del video", async () => {
    expect(Number((await medirSonoridad(final)).input_tp)).toBeGreaterThan(-1);
    const r = await asegurarPicoReal(final, () => {}, { audio: wav, medido: await medirSonoridad(wav) });
    expect(r.intentos).toBeGreaterThanOrEqual(1);
    expect(r.tp).toBeLessThanOrEqual(-1);
    const s = await medirSonoridad(final);
    // Es el tono normalizado a ≈ −14 LUFS, no la onda cuadrada limitada (que quedaría cerca de −3).
    expect(Number(s.input_i)).toBeLessThan(-10);
    const info = await probar(final);
    expect(Number(info.audio?.duration)).toBeGreaterThan(1.9);
    expect(Number(info.audio?.duration)).toBeLessThan(2.1);
  }, 60_000);
});
