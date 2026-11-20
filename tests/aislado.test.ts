import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-aislado-"));
process.env.GEEPER_DATA = dir;
// bwrap falso: anota sus argumentos y corre lo que va después de «--» (así se prueba la tubería sin bwrap real).
const falso = path.join(dir, "bwrap-falso");
const anotado = path.join(dir, "bwrap.log");
fs.writeFileSync(falso, `#!/bin/sh\necho "$@" >> ${anotado}\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`, { mode: 0o755 });
process.env.GEEPER_BWRAP = falso;

const ais = await import("@/lib/aislado");

beforeEach(() => {
  ais.reiniciarDeteccion();
  fs.rmSync(anotado, { force: true });
  delete process.env.GEEPER_AISLAR;
});

describe("aislamiento del material de fuera (D2)", () => {
  it("sabe qué viene de fuera", () => {
    expect(ais.esExterno(path.join(dir, "_fuentes", "abc", "fuente.mp4"))).toBe(true);
    expect(ais.esExterno(path.join(dir, "_subidos", "x.mp4"))).toBe(true);
    expect(ais.esExterno(path.join(dir, "mi-proyecto", "assets", "clip.mp4"))).toBe(false);
    expect(ais.esExterno(path.join(dir, "_fuentes-no", "x.mp4"))).toBe(false);
  });

  it("sin red, todo en sólo lectura salvo la salida, /tmp propio", () => {
    const a = ais.argsBwrap("/usr/bin/ffmpeg", ["-i", "x"], ["/salida", "/salida"]);
    expect(a).toEqual(expect.arrayContaining(["--unshare-net", "--die-with-parent"]));
    expect(a.join(" ")).toContain("--ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --bind /salida /salida -- /usr/bin/ffmpeg -i x");
  });

  it("lee entradas y carpeta de salida de una línea de ffmpeg", () => {
    expect(ais.entradasYSalida(["-ss", "1", "-i", "/a/v.mp4", "-i", "lavfi:x", "-vf", "s", "/b/c/out.jpg"])).toEqual({ entradas: ["/a/v.mp4"], salidas: ["/b/c"] });
    expect(ais.entradasYSalida(["-i", "/a/v.mp4", "-f", "s16le", "-"])).toEqual({ entradas: ["/a/v.mp4"], salidas: [] });
  });

  it("aísla sólo lo de fuera, y si no se puede corre igual", async () => {
    const fuera = path.join(dir, "_fuentes", "f.mp4");
    expect((await ais.comando("ffprobe", [fuera], [fuera], [])).aislado).toBe(true);
    expect((await ais.comando("ffprobe", ["/x/propio.mp4"], ["/x/propio.mp4"], [])).aislado).toBe(false);
    process.env.GEEPER_AISLAR = "0";
    ais.reiniciarDeteccion();
    expect((await ais.comando("ffprobe", [fuera], [fuera], [])).aislado).toBe(false);
  });

  it("el comando aislado corre de verdad a través de bwrap", async () => {
    const fuera = path.join(dir, "_subidos", "nota.txt");
    fs.mkdirSync(path.dirname(fuera), { recursive: true });
    fs.writeFileSync(fuera, "hola");
    const r = await ais.correrSiExterno("cat", [fuera], [fuera], []);
    expect(r.stdout).toBe("hola");
    expect(fs.readFileSync(anotado, "utf8")).toMatch(/--unshare-net .* -- cat .*nota\.txt/);
  });
});
