import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comandosVenv, entornoUv, estadoEstudio, modoEnlaceUv, PAQUETES, prepararEstudio, PYTHON_VERSION } from "@/lib/estudio";
import { pythonDeVenv } from "@/lib/plataforma";

describe("Preparar el estudio", () => {
  it("uv deja Python, caché y venvs dentro de las herramientas, sin usar el Python del sistema", () => {
    const base = path.join("h", "herramientas");
    const e = entornoUv(base, () => null);
    expect(e.UV_PYTHON_INSTALL_DIR).toBe(path.join(base, "python"));
    expect(e.UV_PYTHON_PREFERENCE).toBe("only-managed");
    expect(e.UV_LINK_MODE).toBe("copy");
  });

  it("la caché de uv se enlaza si está en el mismo disco que los venvs, y se copia si no (TER-02)", () => {
    expect(modoEnlaceUv("/h/uv-cache", "/h", () => 7)).toBe("hardlink");
    expect(modoEnlaceUv("/onedrive/uv-cache", "/h", (p) => (p.startsWith("/onedrive") ? 9 : 7))).toBe("copy");
    expect(modoEnlaceUv("/h/uv-cache", "/h", () => null)).toBe("copy");
    // Con el disco real: una carpeta temporal y su subcarpeta (aún sin crear) están en el mismo disco.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-uv-"));
    expect(modoEnlaceUv(path.join(tmp, "uv-cache"), tmp)).toBe("hardlink");
  });

  it("crea el venv desde cero con la versión fijada y le instala los paquetes fijados", () => {
    const venv = path.join("h", "venvs", "voz");
    expect(comandosVenv(venv, PAQUETES.voz)).toEqual([
      ["venv", "--clear", "--python", PYTHON_VERSION, venv],
      ["pip", "install", "--python", pythonDeVenv(venv), "kokoro-onnx==0.6.1", "soundfile==0.14.0"],
    ]);
    for (const p of [...PAQUETES.voz, ...PAQUETES.clips]) expect(p).toMatch(/==\d/);
  });

  it("fuera de la app de escritorio no instala nada (el estudio de desarrollo se arma a mano)", () => {
    expect(estadoEstudio().disponible).toBe(false);
    expect(() => prepararEstudio()).toThrow(/app de escritorio/);
  });
});

describe("recursos del instalador", () => {
  const manifiesto = JSON.parse(fs.readFileSync(path.join(process.cwd(), "escritorio", "recursos.json"), "utf8")) as Record<string, unknown>;
  for (const programa of ["ffmpeg", "uv", "whisper"]) {
    it(`${programa} está fijado para Windows y macOS con su suma o su commit`, () => {
      const p = manifiesto[programa] as Record<string, { archivos?: { url: string; sha256: string; sacar: Record<string, string> }[]; compilar?: { commit: string; tag: string } }>;
      for (const sistema of ["win32-x64", "darwin-arm64"]) {
        const r = p[sistema]!;
        expect(r.archivos ?? r.compilar, `${programa} ${sistema}`).toBeTruthy();
        for (const a of r.archivos ?? []) {
          expect(a.url).toMatch(/^https:\/\//);
          expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
          expect(Object.keys(a.sacar).length).toBeGreaterThan(0);
        }
        if (r.compilar) expect(r.compilar.commit).toMatch(/^[a-f0-9]{40}$/);
      }
    });
  }
});
