import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { comoRematar } from "../escritorio/reglas";

const VIGIA = path.join(__dirname, "..", "escritorio", "vigia.mjs");
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-vigia-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Lanza `codigo` por vigia.mjs como lo hace la carcasa; cuando imprime «listo», le cierra la entrada. */
function correr(codigo: string, args: string[] = []): Promise<{ codigo: number | null; salida: string; ms: number }> {
  const script = path.join(tmp, "hijo.mjs");
  fs.writeFileSync(script, codigo);
  return new Promise((ok, mal) => {
    const p = spawn(process.execPath, [VIGIA, script, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let salida = "";
    let desde = 0;
    p.stdout.on("data", (d: Buffer) => {
      salida += d.toString();
      if (!desde && salida.includes("listo")) {
        desde = Date.now();
        p.stdin.end();
      }
    });
    p.stderr.on("data", (d: Buffer) => (salida += d.toString()));
    p.on("error", mal);
    p.on("exit", (c) => ok({ codigo: c, salida, ms: Date.now() - desde }));
  });
}

describe("vigia.mjs: el hijo se apaga en orden cuando la app cierra (ESC-11)", () => {
  it("si el proceso atiende Ctrl+C, se le avisa y sale por su cuenta", async () => {
    const r = await correr(`
      process.on("SIGINT", () => { console.log("interrumpido en orden"); setTimeout(() => process.exit(0), 50); });
      setInterval(() => {}, 1000);
      console.log("listo");
    `);
    expect(r.salida).toContain("interrumpido en orden");
    expect(r.codigo).toBe(0);
  });

  it("si no lo atiende, sale enseguida igual (no queda huérfano)", async () => {
    const r = await correr(`setInterval(() => {}, 1000); console.log("listo");`);
    expect(r.codigo).toBe(0);
    expect(r.ms).toBeLessThan(3000);
  });

  it("si tarda demasiado en salir, a los 5 s se cierra solo", async () => {
    const r = await correr(`process.on("SIGINT", () => {}); setInterval(() => {}, 1000); console.log("listo");`);
    expect(r.codigo).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(4500);
    expect(r.ms).toBeLessThan(9000);
  }, 15_000);

  it("el script ve sus argumentos como si lo hubieran lanzado directo", async () => {
    const r = await correr(`console.log(JSON.stringify(process.argv.slice(1))); console.log("listo");`, ["--x"]);
    expect(r.salida).toContain(JSON.stringify([path.join(tmp, "hijo.mjs"), "--x"]));
  });
});

describe("rematar al que no salió a tiempo (ESC-11)", () => {
  it("en Windows con taskkill /T /F (también sus hijos); en el resto con SIGKILL", () => {
    expect(comoRematar("win32", 42)).toEqual({ comando: "taskkill", args: ["/PID", "42", "/T", "/F"] });
    expect(comoRematar("darwin", 42)).toEqual({ senal: "SIGKILL" });
    expect(comoRematar("linux", undefined)).toBeNull();
  });
});
