import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { necesitaBuild, puedeReiniciar, puertoOcupado } from "../scripts/arranque";

const temporales: string[] = [];
function raizFalsa(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-up-"));
  temporales.push(r);
  fs.mkdirSync(path.join(r, "src"));
  fs.writeFileSync(path.join(r, "src", "a.ts"), "x");
  return r;
}
function tocar(ruta: string, segundos: number) {
  const t = new Date(Date.now() + segundos * 1000);
  fs.utimesSync(ruta, t, t);
}
afterEach(() => {
  for (const r of temporales.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("pnpm run up: ¿hace falta next build?", () => {
  it("sí cuando no hay ninguna versión preparada", () => {
    expect(necesitaBuild(raizFalsa()).si).toBe(true);
  });

  it("no cuando el build es más nuevo que todo src; sí cuando cambia un archivo", () => {
    const r = raizFalsa();
    fs.mkdirSync(path.join(r, ".next"));
    fs.writeFileSync(path.join(r, ".next", "BUILD_ID"), "x");
    tocar(path.join(r, "src", "a.ts"), -60);
    tocar(path.join(r, "src"), -60);
    expect(necesitaBuild(r)).toEqual({ si: false, motivo: expect.any(String) });
    tocar(path.join(r, "src", "a.ts"), 60);
    const b = necesitaBuild(r);
    expect(b.si).toBe(true);
    expect(b.motivo).toContain("src");
  });
});

describe("pnpm run up: reinicio del worker", () => {
  it("como dev:up: hasta 5 reinicios en 10 minutos y vuelve a dejar pasado ese plazo", () => {
    const r: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(puedeReiniciar(r, t0 + i)).toBe(true);
    expect(puedeReiniciar(r, t0 + 10)).toBe(false);
    expect(puedeReiniciar(r, t0 + 10 * 60_000 + 10)).toBe(true);
  });
});

describe("pnpm run up: puerto ocupado", () => {
  it("detecta un puerto en uso y uno libre", async () => {
    const s = net.createServer();
    await new Promise<void>((ok) => s.listen(0, "127.0.0.1", () => ok()));
    const puerto = (s.address() as net.AddressInfo).port;
    expect(await puertoOcupado(puerto)).toBe(true);
    await new Promise<void>((ok) => s.close(() => ok()));
    expect(await puertoOcupado(puerto)).toBe(false);
  });
});
