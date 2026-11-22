import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-cola-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

type Cola = typeof import("@/lib/cola");
type Db = typeof import("@/lib/db");
let cola: Cola;
let db: Db["db"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  cola = await import("@/lib/cola");
  db = (await import("@/lib/db")).db;
  await cola.guardarLatidoWorker();
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
}, 60_000);

describe("cola en SQLite", () => {
  it("un solo worker reclama cada trabajo", async () => {
    const t = await cola.encolar("p1", "proyecto.importar", { taskId: "x" });
    const [a, b] = await Promise.all([cola.reclamar("voz", "w1"), cola.reclamar("voz", "w2")]);
    expect([a?.id, b?.id].filter(Boolean)).toEqual([t.id]);
    await cola.fallar(t.id, a ? "w1" : "w2", "prueba");
  });

  it("al terminar encadena el siguiente, y un trabajo hecho no se relanza", async () => {
    const t = await cola.encolar("p1", "proyecto.importar", { cadena: ["render.entregar"] });
    const r = await cola.reclamar("voz", "w1");
    expect(r?.id).toBe(t.id);
    await cola.terminar(t.id, "w1", { ok: true }, { tipo: "render.entregar", payload: { version: 1 }, proyectoId: "p1" });
    const sig = await db.trabajo.findFirst({ where: { tipo: "render.entregar", estado: "pendiente" } });
    expect(sig?.payload).toEqual({ version: 1 });
    await expect(cola.relanzar(t.id)).rejects.toThrow(/Sólo se relanzan/);
  });

  it("al arrancar: lease vencido de GPU → interrumpido; de CPU → pendiente", async () => {
    await db.trabajo.updateMany({ data: { estado: "cancelado" } });
    const gpu = await cola.encolar("p1", "render.entregar", {});
    const cpu = await cola.encolar("p1", "voz.regenerar", {});
    await cola.reclamar("render", "muerto");
    await cola.reclamar("voz", "muerto");
    await db.trabajo.updateMany({ where: { id: { in: [gpu.id, cpu.id] } }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const r = await cola.recuperarAlArrancar();
    expect(r.reinicio.hubo).toBe(false);
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: gpu.id } })).estado).toBe("interrumpido");
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: cpu.id } })).estado).toBe("pendiente");
    // El interrumpido espera a la persona; al relanzarlo conserva su payload.
    await cola.relanzar(gpu.id);
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: gpu.id } })).estado).toBe("pendiente");
  }, 60_000);

  it("si hubo reinicio de Windows, todo lo que corría queda interrumpido aunque el lease siga vigente", async () => {
    await db.trabajo.updateMany({ data: { estado: "cancelado" } });
    const t = await cola.encolar("p1", "voz.regenerar", {});
    await cola.reclamar("voz", "w-viejo");
    // Último latido antes del arranque de esta máquina ⇒ hubo reinicio.
    await db.sistema.update({ where: { clave: "worker.latido" }, data: { valor: new Date(0).toISOString() } });
    const r = await cola.recuperarAlArrancar();
    expect(r.reinicio.hubo).toBe(true);
    const fila = await db.trabajo.findUniqueOrThrow({ where: { id: t.id } });
    expect(fila.estado).toBe("interrumpido");
    expect(fila.error).toMatch(/Relánzalo/);
  }, 60_000);

  it("cancelar un trabajo corriendo hace que su latido falle (el worker lo detiene)", async () => {
    const t = await cola.encolar("p1", "voz.regenerar", {});
    await cola.reclamar("voz", "w1");
    expect(await cola.latido(t.id, "w1")).toBe(true);
    await cola.cancelar(t.id);
    expect(await cola.latido(t.id, "w1")).toBe(false);
  });

  it("un trabajo de CPU que se corta dos veces queda «interrumpido» y no vuelve solo a la cola (WRK-09)", async () => {
    await db.trabajo.updateMany({ data: { estado: "cancelado" } });
    await cola.guardarLatidoWorker();
    const t = await cola.encolar("p1", "proyecto.importar", {});
    expect(t.maxIntentos).toBe(cola.MAX_INTENTOS);
    const vencer = () => db.trabajo.update({ where: { id: t.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    // Primera caída: vuelve a la cola.
    await cola.reclamar("voz", "muerto-1");
    await vencer();
    expect(await cola.recuperarVencidos()).toBe(1);
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: t.id } })).estado).toBe("pendiente");
    // Segunda caída: queda para la persona, con un mensaje claro.
    await cola.reclamar("voz", "muerto-2");
    await vencer();
    await cola.recuperarVencidos();
    const fila = await db.trabajo.findUniqueOrThrow({ where: { id: t.id } });
    expect(fila.estado).toBe("interrumpido");
    expect(fila.error).toBe(cola.CORTADO_DOS_VECES);
    // Lo mismo si la segunda caída se ve al arrancar el worker.
    await cola.relanzar(t.id);
    await cola.reclamar("voz", "muerto-3");
    await vencer();
    await cola.recuperarAlArrancar();
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: t.id } })).estado).toBe("pendiente");
    await cola.reclamar("voz", "muerto-4");
    await vencer();
    const r = await cola.recuperarAlArrancar();
    expect(r.interrumpidos).toBe(1);
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: t.id } })).error).toBe(cola.CORTADO_DOS_VECES);
  }, 60_000);

  it("lo que espera la tarjeta no va en la fila «voz» y un trabajo puede cambiar de fila sin gastar intento (GPU-06)", async () => {
    expect(cola.TIPOS["voz.disenar"].motor).toBe("tarjeta");
    expect(cola.TIPOS["proyecto.traducir"].motor).toBe("tarjeta");
    expect(cola.MOTORES).toContain("tarjeta");
    await db.trabajo.updateMany({ data: { estado: "cancelado" } });
    const t = await cola.encolar("p1", "voz.regenerar", {});
    await cola.reclamar("voz", "w1");
    expect(await cola.cambiarDeFila(t.id, "w1", "tarjeta", "En cola: espera la tarjeta gráfica")).toBe(true);
    const fila = await db.trabajo.findUniqueOrThrow({ where: { id: t.id } });
    expect(fila).toMatchObject({ estado: "pendiente", motor: "tarjeta", usaGpu: true, intentos: 0, workerId: null });
    // La fila «voz» queda libre para lo de CPU; la «tarjeta» lo toma.
    expect(await cola.reclamar("voz", "w1")).toBeNull();
    expect((await cola.reclamar("tarjeta", "w1"))?.id).toBe(t.id);
  });
});
