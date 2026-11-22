/** SEG-03 (ronda 2): destino según dónde corre, poda de temporales cortados y el aviso de Sistema. */
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textoRespaldo, type Respaldo } from "@/components/sistema";
import { DESTINO_POR_DEFECTO, destinoRespaldo, estadoRespaldo, respaldar } from "@/lib/respaldo";

function preparar() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-respaldo-auto-"));
  const datos = path.join(raiz, "datos");
  const destino = path.join(raiz, "otro-disco");
  fs.mkdirSync(path.join(datos, "mi-video"), { recursive: true });
  fs.writeFileSync(path.join(datos, "mi-video", "geeper.json"), "{}");
  const base = path.join(datos, "geeper.db");
  const con = new Database(base);
  con.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('uno');");
  con.close();
  return { datos, destino, base };
}

/** Un PID que ya no vive: el de un proceso que terminó. */
function pidMuerto(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid!;
}

const dia = (n: number) => new Date(2026, 10, n, 12, 0, 0);

describe("destino del respaldo", () => {
  it("GEEPER_RESPALDO manda; vacío quiere decir sin otro disco", () => {
    expect(destinoRespaldo({ env: { GEEPER_RESPALDO: "/tmp/x" }, escritorio: true, wsl: false })).toBe("/tmp/x");
    expect(destinoRespaldo({ env: { GEEPER_RESPALDO: "" }, escritorio: false, wsl: true })).toBeNull();
  });

  it("/mnt/d sólo en WSL y nunca en la app de escritorio", () => {
    expect(destinoRespaldo({ env: {}, escritorio: false, wsl: true })).toBe(DESTINO_POR_DEFECTO);
    expect(destinoRespaldo({ env: {}, escritorio: true, wsl: true })).toBeNull();
    expect(destinoRespaldo({ env: {}, escritorio: false, wsl: false })).toBeNull();
  });
});

describe("poda de temporales de un respaldo cortado", () => {
  it("borra los .parcial y .db.tmp de un proceso muerto o viejos, y deja los de una copia en curso", async () => {
    const { datos, destino, base } = preparar();
    const muerto = pidMuerto();
    const vivo = process.ppid;
    const respaldos = path.join(datos, "respaldos");
    fs.mkdirSync(path.join(destino, `.geeper-2026-11-18-${muerto}.parcial`, "mi-video"), { recursive: true });
    fs.writeFileSync(path.join(destino, `.geeper-2026-11-18-${muerto}.parcial`, "mi-video", "v1.mp4"), "video a medias");
    fs.mkdirSync(path.join(destino, `.geeper-2026-11-19-${vivo}.parcial`));
    const viejo = path.join(destino, `.geeper-2026-11-17-${vivo}.parcial`);
    fs.mkdirSync(viejo);
    fs.mkdirSync(respaldos, { recursive: true });
    fs.writeFileSync(path.join(respaldos, `.geeper-2026-11-18-${muerto}.db.tmp`), "x");
    fs.writeFileSync(path.join(destino, "otra-cosa.parcial"), "no es nuestro");
    const ahora = new Date();
    const haceDosDias = new Date(ahora.getTime() - 48 * 3_600_000);
    fs.utimesSync(viejo, haceDosDias, haceDosDias);

    const r = await respaldar({ datos, baseDatos: base, destino, ahora });
    expect(r.error).toBeNull();
    const quedan = fs.readdirSync(destino).sort();
    expect(quedan).toContain(`.geeper-2026-11-19-${vivo}.parcial`);
    expect(quedan).toContain("otra-cosa.parcial");
    expect(quedan).not.toContain(`.geeper-2026-11-18-${muerto}.parcial`);
    expect(quedan).not.toContain(`.geeper-2026-11-17-${vivo}.parcial`);
    expect(fs.readdirSync(respaldos).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("estado del respaldo en Sistema", () => {
  it("dice dónde quedó la última copia", async () => {
    const { datos, destino, base } = preparar();
    await respaldar({ datos, baseDatos: base, destino, ahora: dia(20) });
    expect((await estadoRespaldo(datos, dia(20))).copia).toBe(path.join(destino, "geeper-2026-11-20"));
    const otro = preparar();
    await respaldar({ datos: otro.datos, baseDatos: otro.base, destino: null, ahora: dia(20) });
    const e = await estadoRespaldo(otro.datos, dia(20));
    expect(e.copia).toBeNull();
    expect(e.aviso).toBeNull();
  });

  const r = (o: Partial<Respaldo>): Respaldo => ({ hecho: "2026-11-20T12:00:00.000Z", dias: 0.5, copia: "/d/geeper-2026-11-20", error: null, aviso: null, otroDisco: true, ...o });
  const fecha = () => "20 de noviembre";

  it("avisa si no hay copia, si tiene más de 2 días o si no llegó al otro disco", () => {
    expect(textoRespaldo(r({ hecho: null, dias: null, aviso: "Todavía no hay ninguna copia de seguridad." }), fecha)).toMatchObject({ tipo: "alerta", detalle: /una vez al día/ });
    expect(textoRespaldo(r({ dias: 3.2, aviso: "La última copia de seguridad es de hace 3 días." }), fecha)).toMatchObject({ tipo: "alerta", titulo: /hace 3 días/ });
    expect(textoRespaldo(r({ copia: null, error: "No se pudo copiar", aviso: "La última copia de seguridad no llegó al otro disco." }), fecha)).toMatchObject({ tipo: "alerta", detalle: /disco esté conectado/ });
  });

  it("al día: dice la fecha y si quedó en el otro disco", () => {
    expect(textoRespaldo(r({}), fecha)).toEqual({ tipo: "ok", titulo: "Copia de seguridad al día: la última es del 20 de noviembre.", detalle: "También quedó guardada en el otro disco." });
    expect(textoRespaldo(r({ copia: null, otroDisco: false }), fecha).detalle).toMatch(/sólo en esta computadora/);
  });
});
