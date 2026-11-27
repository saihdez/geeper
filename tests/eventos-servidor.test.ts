/** WEB-13: el vigía del canal de avisos nota los cambios en la base y la ruta /api/eventos los manda. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Cambio } from "@/lib/eventos-avisos";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-eventos-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

type Eventos = typeof import("@/lib/eventos");
let ev: Eventos;
let cola: typeof import("@/lib/cola");
let db: (typeof import("@/lib/db"))["db"];
let ruta: typeof import("@/app/api/eventos/route");

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  ev = await import("@/lib/eventos");
  cola = await import("@/lib/cola");
  db = (await import("@/lib/db")).db;
  ruta = await import("@/app/api/eventos/route");
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
  await db.proyecto.create({ data: { id: "p2", slug: "p2", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
}, 60_000);

const bajas: (() => void)[] = [];
afterEach(() => {
  for (const b of bajas.splice(0)) b();
});

/** Escucha con un vigía rápido (50 ms) y espera a que haya leído las marcas de partida. */
async function escuchar(): Promise<Cambio[]> {
  const recibidos: Cambio[] = [];
  const antes = ev.estadoVigia().lecturas;
  bajas.push(ev.escucharCambios((c) => recibidos.push(c), 50));
  await expect.poll(() => ev.estadoVigia().lecturas, { interval: 10 }).toBeGreaterThan(antes + 1);
  return recibidos;
}

describe("vigía de cambios (WEB-13)", () => {
  it("un cambio llega: el avance de un trabajo avisa con su proyecto", async () => {
    const t = await cola.encolar("p1", "voz.regenerar", {});
    const recibidos = await escuchar();
    await cola.reclamar("voz", "w1");
    await cola.marcarEtapa(t.id, "Voz", 0.5);
    await expect.poll(() => recibidos, { interval: 20, timeout: 3000 }).toContainEqual({ tipo: "trabajos", ids: ["p1"] });
    expect(recibidos.some((c) => c.tipo === "proyecto")).toBe(false);
    await cola.fallar(t.id, "w1", "prueba");
  });

  it("guardar un proyecto avisa sólo ese proyecto; borrar uno avisa a todos", async () => {
    const recibidos = await escuchar();
    await db.proyecto.update({ where: { id: "p2" }, data: { nombre: "otro" } });
    await expect.poll(() => recibidos, { interval: 20, timeout: 3000 }).toContainEqual({ tipo: "proyecto", ids: ["p2"] });
    await db.proyecto.create({ data: { id: "p3", slug: "p3", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
    await expect.poll(() => recibidos.filter((c) => c.tipo === "proyecto" && !c.ids).length, { interval: 20, timeout: 3000 }).toBe(1);
    await db.proyecto.delete({ where: { id: "p3" } });
    await expect.poll(() => recibidos.filter((c) => c.tipo === "proyecto" && !c.ids).length, { interval: 20, timeout: 3000 }).toBe(2);
  });

  it("el motor que vuelve a dar señales avisa «motor»", async () => {
    await db.sistema.deleteMany({ where: { clave: "worker.latido" } });
    const recibidos = await escuchar();
    await cola.guardarLatidoWorker();
    await expect.poll(() => recibidos, { interval: 20, timeout: 3000 }).toContainEqual({ tipo: "motor" });
  });

  it("sin cambios no avisa nada; un solo vigía para todos, y se apaga cuando no queda nadie", async () => {
    const a = await escuchar();
    const b = await escuchar();
    expect(ev.estadoVigia()).toMatchObject({ oyentes: 2, activo: true });
    await new Promise((r) => setTimeout(r, 500));
    expect([...a, ...b]).toEqual([]);
    for (const x of bajas.splice(0)) x();
    expect(ev.estadoVigia()).toMatchObject({ oyentes: 0, activo: false });
  });
});

describe("ruta /api/eventos", () => {
  it("abre un canal sin búfer, manda «cambio» y al cerrarse deja de escuchar", async () => {
    const ctrl = new AbortController();
    const r = ruta.GET(new Request("http://localhost/api/eventos", { signal: ctrl.signal }));
    expect(r.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(r.headers.get("cache-control")).toContain("no-transform");
    expect(r.headers.get("x-accel-buffering")).toBe("no");
    expect(ruta.dynamic).toBe("force-dynamic");
    expect(ruta.runtime).toBe("nodejs");
    const lector = r.body!.getReader();
    const dec = new TextDecoder();
    let texto = dec.decode((await lector.read()).value);
    expect(texto).toContain("retry:");
    expect(ev.estadoVigia().oyentes).toBe(1);
    // El vigía de la ruta va a 1 s: se deja leer la marca de partida antes de cambiar algo.
    await new Promise((r) => setTimeout(r, 1300));
    await db.proyecto.update({ where: { id: "p1" }, data: { nombre: "cambiado" } });
    while (!texto.includes("event: cambio")) texto += dec.decode((await lector.read()).value);
    expect(texto).toContain(`data: ${JSON.stringify({ tipo: "proyecto", ids: ["p1"] })}`);
    ctrl.abort();
    expect(ev.estadoVigia()).toMatchObject({ oyentes: 0, activo: false });
    expect((await lector.read()).done).toBe(true);
  });
});
