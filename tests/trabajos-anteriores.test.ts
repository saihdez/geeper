/** UX-41: «Volver a intentar» guarda el intento anterior (error, etapa, registro y fechas) y la API lo entrega. */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-anteriores-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

let cola: typeof import("@/lib/cola");
let db: typeof import("@/lib/db")["db"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  cola = await import("@/lib/cola");
  db = (await import("@/lib/db")).db;
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
}, 60_000);

describe("intentos anteriores (UX-41)", () => {
  it("al relanzar se guarda el intento que falló y la API de trabajos lo muestra", async () => {
    const t = await cola.encolar("p1", "proyecto.importar", { taskId: "x" });
    expect((await cola.reclamar("voz", "w1"))?.id).toBe(t.id);
    await db.trabajo.update({ where: { id: t.id }, data: { etapa: "Alineando la voz", log: "p1/logs/t.log" } });
    await cola.fallar(t.id, "w1", "Whisper se quedó sin memoria");
    await cola.relanzar(t.id);

    const f = await db.trabajo.findUniqueOrThrow({ where: { id: t.id } });
    expect(f.estado).toBe("pendiente");
    expect(f.iniciado).toBeNull();
    expect(f.terminado).toBeNull();
    const anteriores = f.anteriores as unknown as import("@/lib/cola").IntentoAnterior[];
    expect(anteriores).toHaveLength(1);
    expect(anteriores[0]).toMatchObject({ estado: "fallido", error: "Whisper se quedó sin memoria", etapa: "Alineando la voz", log: "p1/logs/t.log" });
    expect(Date.parse(anteriores[0]!.terminado!)).toBeGreaterThanOrEqual(Date.parse(anteriores[0]!.iniciado!));

    // Segundo intento que también falla: quedan los dos, del más viejo al más nuevo.
    expect((await cola.reclamar("voz", "w1"))?.id).toBe(t.id);
    await cola.fallar(t.id, "w1", "Otra vez");
    await cola.relanzar(t.id);
    const dos = (await db.trabajo.findUniqueOrThrow({ where: { id: t.id } })).anteriores as unknown as { error: string }[];
    expect(dos.map((x) => x.error)).toEqual(["Whisper se quedó sin memoria", "Otra vez"]);

    const { GET } = await import("@/app/api/trabajos/route");
    const { trabajos } = (await (await GET(new Request("http://x/api/trabajos"))).json()) as { trabajos: { id: string; anteriores: { error: string }[] | null }[] };
    expect(trabajos.find((x) => x.id === t.id)?.anteriores?.map((x) => x.error)).toEqual(["Whisper se quedó sin memoria", "Otra vez"]);
  });

  it("un trabajo que no terminó mal no se relanza ni guarda nada", async () => {
    const t = await cola.encolar("p1", "proyecto.importar", {});
    await expect(cola.relanzar(t.id)).rejects.toThrow(/Sólo se relanzan/);
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: t.id } })).anteriores).toBeNull();
  });

  it("conIntentoAnterior guarda los últimos y recorta errores largos", () => {
    const fila = { estado: "fallido", error: "x".repeat(5000), etapa: "e", log: null, iniciado: null, terminado: null };
    let l: unknown = null;
    for (let i = 0; i < cola.MAX_ANTERIORES + 3; i++) l = cola.conIntentoAnterior(l, fila);
    expect((l as unknown[]).length).toBe(cola.MAX_ANTERIORES);
    expect((l as { error: string }[])[0]!.error.length).toBe(2000);
  });
});

describe("una base vieja recibe la columna nueva sin db push", () => {
  it("completarColumnas agrega Trabajo.anteriores una sola vez y no toca bases sin la tabla", async () => {
    const { completarColumnas } = await import("@/lib/db");
    const vieja = path.join(dir, "vieja.db");
    const b = new Database(vieja);
    b.exec(`CREATE TABLE "Trabajo" ("id" TEXT PRIMARY KEY, "estado" TEXT NOT NULL)`);
    b.exec(`INSERT INTO "Trabajo" VALUES ('t1', 'hecho')`);
    b.close();
    expect(completarColumnas(vieja)).toEqual(["Trabajo.anteriores"]);
    expect(completarColumnas(vieja)).toEqual([]);
    const c = new Database(vieja, { readonly: true });
    expect((c.prepare(`PRAGMA table_info("Trabajo")`).all() as { name: string }[]).map((x) => x.name)).toContain("anteriores");
    expect(c.prepare(`SELECT "estado" FROM "Trabajo"`).get()).toEqual({ estado: "hecho" });
    c.close();
    const vacia = path.join(dir, "vacia.db");
    new Database(vacia).close();
    expect(completarColumnas(vacia)).toEqual([]);
    expect(completarColumnas(path.join(dir, "no-existe.db"))).toEqual([]);
  });
});
