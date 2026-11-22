/** COD-02: una sola búsqueda del Chrome sin ventana, que no lanza error si no lo encuentra. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { abrirNavegador, rutaChrome } from "@/lib/navegador";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "geeper-nav-"));
const poner = (base: string, version: string, sub: string, exe: string) => {
  const dir = path.join(base, "chrome", "chrome-headless-shell", version, sub);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, exe), "");
  return path.join(dir, exe);
};

describe("rutaChrome", () => {
  it("sin caché devuelve undefined (se cae al navegador de Playwright)", () => {
    expect(rutaChrome([path.join(tmp(), "no-existe")])).toBeUndefined();
  });

  it("elige la versión más nueva y encuentra el de Windows", () => {
    const base = tmp();
    poner(base, "linux-140.0.1", "chrome-headless-shell-linux64", "chrome-headless-shell");
    const nueva = poner(base, "win64-141.0.2", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    expect(rutaChrome([base])).toBe(nueva);
  });

  it("si la primera caché está vacía, mira la segunda", () => {
    const vacia = tmp();
    fs.mkdirSync(path.join(vacia, "chrome", "chrome-headless-shell"), { recursive: true });
    const otra = tmp();
    const exe = poner(otra, "linux-140", "chrome-headless-shell-linux64", "chrome-headless-shell");
    expect(rutaChrome([vacia, otra])).toBe(exe);
  });

  it("ningún archivo de src ni de scripts/ui la vuelve a copiar", () => {
    const archivos = [
      ...["comfyui.ts", "demo-web-toma.ts"].map((f) => path.join("src", "lib", f)),
      ...["capturas", "desborde", "reeditar", "vista-en-vivo", "editar-texto", "relanzar"].map((f) => path.join("scripts", "ui", `${f}.ts`)),
    ];
    for (const f of archivos) {
      const s = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(s, f).not.toContain('"chrome-headless-shell"');
      expect(s, f).toContain("rutaChrome()");
    }
  });
});

describe("abrirNavegador", () => {
  it("dice en palabras simples que no abrió y deja el detalle", async () => {
    await expect(abrirNavegador(() => Promise.reject(new Error("Executable doesn't exist at /x\nmás")))).rejects.toThrow(
      /No se pudo abrir el navegador sin ventana.*Detalle: Executable doesn't exist at \/x\)$/,
    );
    await expect(abrirNavegador(() => Promise.resolve(7))).resolves.toBe(7);
  });
});
