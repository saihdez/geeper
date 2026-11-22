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

/**
 * Lanza `codigo` por vigia.mjs como lo hace la carcasa; cuando imprime «listo», le cierra la entrada.
 * `ms` cuenta desde que esta prueba vio «listo»; `msDesdeAviso`, desde que el hijo imprimió «aviso <hora>»
 * al recibir el Ctrl+C. Con la máquina cargada, esta prueba puede ver «listo» tarde (y `ms` sale más corto
 * de lo real): para los pisos se usa la hora que anota el propio hijo.
 */
function correr(
  codigo: string,
  args: string[] = [],
  topeMs?: number,
): Promise<{ codigo: number | null; salida: string; ms: number; msDesdeAviso: number | null }> {
  const script = path.join(tmp, "hijo.mjs");
  fs.writeFileSync(script, codigo);
  const env = { ...process.env, GEEPER_VIGIA_TOPE_MS: topeMs ? String(topeMs) : undefined };
  return new Promise((ok, mal) => {
    const p = spawn(process.execPath, [VIGIA, script, ...args], { stdio: ["pipe", "pipe", "pipe"], env });
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
    p.on("exit", (c) => {
      const fin = Date.now();
      const aviso = /aviso (\d+)/.exec(salida);
      ok({ codigo: c, salida, ms: fin - desde, msDesdeAviso: aviso ? fin - Number(aviso[1]) : null });
    });
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
    // Con un tope de 30 s, salir antes de 15 s sólo puede ser por no esperar (holgura para una máquina cargada).
    const r = await correr(`setInterval(() => {}, 1000); console.log("listo");`, [], 30_000);
    expect(r.codigo).toBe(0);
    expect(r.ms).toBeLessThan(15_000);
  }, 40_000);

  it("si tarda demasiado en salir, al llegar al tope se cierra solo", async () => {
    // Tope corto para la prueba. El piso se mide desde que el hijo recibió el aviso (el temporizador de
    // vigia.mjs arranca antes, así que no puede salir antes de 1 s) y el techo deja 20 s de holgura por si
    // la máquina está cargada (antes fallaba con 9 s).
    const r = await correr(`process.on("SIGINT", () => console.log("aviso " + Date.now())); setInterval(() => {}, 1000); console.log("listo");`, [], 1000);
    const detalle = JSON.stringify(r);
    expect(r.codigo, detalle).toBe(0);
    expect(r.salida, detalle).toContain("aviso ");
    expect(r.msDesdeAviso, detalle).toBeGreaterThanOrEqual(900);
    expect(r.ms, detalle).toBeLessThan(21_000);
  }, 40_000);

  it("si el proceso necesita tiempo para cerrar en orden, se le dan los segundos que pida dentro del tope", async () => {
    const r = await correr(
      `process.on("SIGINT", () => { console.log("aviso " + Date.now()); setTimeout(() => { console.log("cerré en orden"); process.exit(0); }, 1500); }); setInterval(() => {}, 1000); console.log("listo");`,
      [],
      30_000,
    );
    // Si vigia.mjs lo hubiera cortado antes, no habría llegado a escribir esto.
    expect(r.salida).toContain("cerré en orden");
    expect(r.codigo).toBe(0);
    expect(r.msDesdeAviso).toBeGreaterThanOrEqual(1400);
  }, 40_000);

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
