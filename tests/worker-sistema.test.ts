import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-sistema-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

type Cola = typeof import("@/lib/cola");
let cola: Cola;
let db: typeof import("@/lib/db")["db"];
let sistema: typeof import("../worker/sistema");

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  cola = await import("@/lib/cola");
  db = (await import("@/lib/db")).db;
  sistema = await import("../worker/sistema");
}, 60_000);

const vencer = (id: string) => db.trabajo.update({ where: { id }, data: { leaseUntil: new Date(Date.now() - 1000) } });

describe("barrerLeases (WRK-06)", () => {
  it("tras una pausa larga no corta los trabajos propios, sí los de un worker muerto", async () => {
    const propio = await cola.encolar(null, "render.entregar", {});
    await cola.reclamar("render", "yo");
    const ajeno = await cola.encolar(null, "proyecto.importar", {});
    await cola.reclamar("voz", "muerto");
    await vencer(propio.id);
    await vencer(ajeno.id);

    const r = await sistema.barrerLeases([propio.id], "yo");
    expect(r).toEqual({ recuperados: 1, perdidos: [] });
    const [p, a] = await Promise.all([db.trabajo.findUniqueOrThrow({ where: { id: propio.id } }), db.trabajo.findUniqueOrThrow({ where: { id: ajeno.id } })]);
    expect(p.estado).toBe("corriendo");
    expect(p.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(a.estado).toBe("pendiente");
  });

  it("un trabajo propio que ya no es nuestro (cancelado) sale en «perdidos»", async () => {
    const t = await cola.encolar(null, "render.entregar", {});
    await cola.reclamar("render", "yo2");
    await cola.cancelar(t.id);
    const r = await sistema.barrerLeases([t.id], "yo2");
    expect(r.perdidos).toEqual([t.id]);
  });
});

describe("yaNoSonNuestros (WRK-13)", () => {
  it("devuelve los cancelados y los de otro worker; no los que siguen corriendo aquí", async () => {
    const a = await cola.encolar(null, "publicar.subir", {});
    await cola.reclamar("red", "w13");
    const b = await cola.encolar(null, "publicar.subir", {});
    await cola.reclamar("red", "w13");
    await cola.cancelar(b.id);
    expect(await sistema.yaNoSonNuestros([a.id, b.id, "no-existe"], "w13")).toEqual([b.id, "no-existe"]);
    expect(await sistema.yaNoSonNuestros([a.id], "otro")).toEqual([a.id]);
    expect(await sistema.yaNoSonNuestros([], "w13")).toEqual([]);
  });
});

describe("esperarVacio (WRK-07)", () => {
  it("vuelve en cuanto los trabajos terminan, no a un plazo fijo", async () => {
    const m = new Map([["a", 1]]);
    setTimeout(() => m.delete("a"), 300);
    const t0 = Date.now();
    expect(await sistema.esperarVacio(m, 5000, 20)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("respeta el tope si alguno no termina", async () => {
    expect(await sistema.esperarVacio(new Map([["a", 1]]), 200, 20)).toBe(false);
    expect(await sistema.esperarVacio(new Map(), 200)).toBe(true);
  });
});
