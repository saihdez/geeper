import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { filtroLut } from "@/lib/looks";
import { correr } from "@/lib/proceso";
import { FFMPEG } from "@/lib/rutas";

/** ESC-09: la ruta de la LUT no va dentro del filtro de ffmpeg (en Windows lleva «C:» y «\»). */
describe("filtro de color con la LUT", () => {
  const tmps: string[] = [];
  afterAll(async () => {
    for (const t of tmps) await fs.rm(t, { recursive: true, force: true });
  });

  it("en una ruta de Windows nombra sólo el archivo y corre en su carpeta", () => {
    const r = filtroLut("C:\\Users\\Ana\\AppData\\Roaming\\Geeper\\datos\\color\\luts\\0a1b2c3d4e5f6789.cube");
    expect(r.filtro).toBe("lut3d=file=0a1b2c3d4e5f6789.cube");
    expect(r.cwd).toBe("C:\\Users\\Ana\\AppData\\Roaming\\Geeper\\datos\\color\\luts");
  });

  it("en Linux y macOS da el mismo filtro", () => {
    expect(filtroLut("/home/x/geeper-data/color/luts/abc.cube")).toEqual({ filtro: "lut3d=file=abc.cube", cwd: "/home/x/geeper-data/color/luts" });
  });

  it("rechaza un nombre con caracteres que ffmpeg interpreta", () => {
    expect(() => filtroLut("/tmp/a:b.cube")).toThrow();
    expect(() => filtroLut("/tmp/a'b.cube")).toThrow();
  });

  it("ffmpeg aplica la LUT aunque la carpeta tenga «:» y comillas", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lut-"));
    tmps.push(dir);
    const raro = path.join(dir, "C: d'e");
    await fs.mkdir(raro);
    const lut = path.join(raro, "invertir.cube");
    // LUT 2³ que invierte los colores: el resultado tiene que cambiar.
    const filas = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) filas.push(`${1 - r} ${1 - g} ${1 - b}`);
    await fs.writeFile(lut, `LUT_3D_SIZE 2\n${filas.join("\n")}\n`);
    const salida = path.join(dir, "out.png");
    const { filtro, cwd } = filtroLut(lut);
    await correr(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16", "-vf", filtro, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", salida], { cwd });
    const px = await fs.readFile(salida);
    expect(px[0]).toBeGreaterThan(200);
  });
});
