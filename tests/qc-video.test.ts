import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { correrQc } from "@/lib/qc";
import { ffmpeg } from "@/lib/media";
import { FFMPEG } from "@/lib/rutas";

/**
 * QC sobre un video sintético (sin GPU): 1,5 s con la imagen congelada y 2 s en movimiento, con un
 * tono de audio. Sirve de red para medir en paralelo (REN-11) y para la regla de duplicados.
 */
const hayFfmpeg = existsSync(FFMPEG);
const dir = path.join(os.tmpdir(), `geeper-qc-${process.pid}`);
const video = path.join(dir, "prueba.mp4");

describe.skipIf(!hayFfmpeg)("QC sobre un video sintético", () => {
  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });
    await ffmpeg([
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=2,tpad=start_mode=clone:start_duration=1.5",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video,
    ]);
  }, 60_000);
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("mide sonoridad, fotogramas, duplicados y congelados y arma la hoja de contacto", async () => {
    const informe = await correrQc(
      video,
      {
        formato: "9:16", fps: 30, total: 3.5, inicioTarjeta: 3.5, grupos: [], cajas: [], licencias: [],
        momentos: [{ t: 0.5, nota: "Escena 1" }, { t: 1.5, nota: "Escena 2" }, { t: 3, nota: "Escena 3" }],
      },
      path.join(dir, "hoja"),
      () => {},
    );
    const regla = (id: string) => informe.reglas.find((r) => r.id === id)!;
    expect(regla("fotogramas").medido).toBe(105);
    expect(regla("fotogramas").ok).toBe(true);
    expect(Number.isFinite(regla("sonoridad").medido as number)).toBe(true);
    const dup = regla("duplicados");
    expect(dup.ok).toBe(false);
    const medido = dup.medido as { proporcion: number; congelados: { dur: number }[] };
    expect(medido.congelados.length).toBe(1);
    expect(medido.congelados[0]!.dur).toBeGreaterThanOrEqual(1);
    expect(medido.proporcion).toBeGreaterThan(0.3);
    expect(informe.fotogramas.map((f) => f.nota)).toEqual(["Escena 1", "Escena 2", "Escena 3"]);
    expect(existsSync(informe.hojaContacto!)).toBe(true);
    expect(informe.aprobado).toBe(false);
  });
});
