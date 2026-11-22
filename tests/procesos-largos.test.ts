import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.GEEPER_DATA = mkdtempSync(path.join(os.tmpdir(), "geeper-procesos-"));
const { anotarProceso, cerrarHuerfanos, dirProcesos, inicioDe } = await import("@/lib/procesos-largos");

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarA = async (cond: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 50));
  return cond();
};
const lanzar = () => spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
const nota = (pid: number) => path.join(dirProcesos(), `${pid}.json`);
/** Hace como si el dueño anotado fuera un proceso que ya murió. */
const sinDueno = (pid: number) => {
  const a = JSON.parse(readFileSync(nota(pid), "utf8"));
  writeFileSync(nota(pid), JSON.stringify({ ...a, dueno: 2 ** 22 + 7, inicioDueno: "1" }));
};

describe.skipIf(process.platform === "win32")("procesos largos sin dueño (WRK-04)", () => {
  it("anota mientras vive y borra la nota al cerrarse", async () => {
    const h = lanzar();
    anotarProceso(h, "Prueba");
    expect(existsSync(nota(h.pid!))).toBe(true);
    expect(JSON.parse(readFileSync(nota(h.pid!), "utf8"))).toMatchObject({ nombre: "Prueba", dueno: process.pid, inicio: inicioDe(h.pid!) });
    process.kill(-h.pid!, "SIGTERM");
    expect(await esperarA(() => !existsSync(nota(h.pid!)))).toBe(true);
  });

  it("cierra el grupo de un proceso cuyo dueño murió y deja los que tienen dueño vivo", async () => {
    const huerfano = lanzar();
    const conDueno = lanzar();
    anotarProceso(huerfano, "ComfyUI");
    anotarProceso(conDueno, "Editor");
    sinDueno(huerfano.pid!);
    expect(cerrarHuerfanos()).toEqual(["ComfyUI"]);
    expect(await esperarA(() => !vivo(huerfano.pid!))).toBe(true);
    expect(vivo(conDueno.pid!)).toBe(true);
    expect(existsSync(nota(conDueno.pid!))).toBe(true);
    process.kill(-conDueno.pid!, "SIGTERM");
  });

  it("no mata un PID reciclado: si la hora de arranque no coincide, sólo borra la nota", () => {
    const h = lanzar();
    anotarProceso(h, "Viejo");
    sinDueno(h.pid!);
    const a = JSON.parse(readFileSync(nota(h.pid!), "utf8"));
    writeFileSync(nota(h.pid!), JSON.stringify({ ...a, inicio: "1" }));
    expect(cerrarHuerfanos()).toEqual([]);
    expect(vivo(h.pid!)).toBe(true);
    expect(readdirSync(dirProcesos()).includes(`${h.pid}.json`)).toBe(false);
    process.kill(-h.pid!, "SIGTERM");
  });

  it("notas ilegibles o de procesos que ya no existen se limpian sin tocar nada", () => {
    writeFileSync(path.join(dirProcesos(), "roto.json"), "{");
    writeFileSync(path.join(dirProcesos(), "999999.json"), JSON.stringify({ pid: 4_000_000, nombre: "x", inicio: null, dueno: 4_000_001, inicioDueno: null }));
    expect(cerrarHuerfanos()).toEqual([]);
    expect(readdirSync(dirProcesos()).filter((n) => n === "roto.json" || n === "999999.json")).toEqual([]);
  });
});
