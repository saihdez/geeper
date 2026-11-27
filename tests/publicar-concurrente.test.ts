/** SEG-04 (ronda 2): publicar no falla si otro proceso está escribiendo en la base a la vez. */
import Database from "better-sqlite3";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-publicar-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_CONFIG = path.join(dir, "config");

let db: typeof import("@/lib/db")["db"];
let ruta: typeof import("@/app/api/proyectos/[id]/publicar/route");

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  db = (await import("@/lib/db")).db;
  await (await import("@/lib/db")).prepararDb();
  ruta = await import("@/app/api/proyectos/[id]/publicar/route");
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "Proyecto", tema: "t", formato: "16:9", plantilla: "x" } });
  await db.render.create({ data: { id: "r1", proyectoId: "p1", versionNumero: 1, perfil: "youtube-16x9", ruta: "renders/v1.mp4", estado: "aprobado" } });
  for (const c of ["c1", "c2"]) {
    await db.cuenta.create({ data: { id: c, red: "youtube", externoId: `canal-${c}`, usuario: `@${c}`, estado: "conectada" } });
  }
}, 60_000);

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const TOMAR = path.join(process.cwd(), "tests", "ayudas", "tomar-base.ts");

/** Lanza un proceso que toma la base escribiendo durante `ms`; resuelve cuando ya la tiene, con su fin. */
function tomarBase(ms: number): Promise<{ fin: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const h = spawn(TSX, [TOMAR, process.env.GEEPER_DB!, String(ms)], { stdio: ["ignore", "pipe", "inherit"] });
    const fin = new Promise<void>((ok) => h.on("exit", () => ok()));
    h.on("error", reject);
    // Un objeto y no la promesa: resolve(fin) la adoptaría y el POST correría con la base ya libre.
    h.stdout.once("data", () => resolve({ fin }));
  });
}

const pedido = (cuentaId: string) =>
  new Request("http://x/api/proyectos/p1/publicar", {
    method: "POST",
    body: JSON.stringify({ renderId: "r1", destinos: [{ cuentaId, titulo: "Hola", descripcion: "", privacidad: "privado" }] }),
  });
const ctx = { params: Promise.resolve({ id: "p1" }) };

describe("publicar con la base ocupada por otro proceso (SEG-04)", () => {
  it("espera su turno y encola, sin fallar al instante", async () => {
    // Otro proceso (el worker) tiene la base tomada escribiendo mientras publicar empieza.
    const otro = await tomarBase(800);
    const r = await ruta.POST(pedido("c1"), ctx);
    await otro.fin;
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ publicaciones: [{ cuentaId: "c1", estado: "pendiente" }] });
    // Lo ve otra conexión (otro proceso): quedó guardado de verdad, no en una transacción a medias.
    const fuera = new Database(process.env.GEEPER_DB!, { readonly: true });
    expect(fuera.prepare(`SELECT COUNT(*) AS n FROM "Trabajo" WHERE "tipo" = 'publicar.subir'`).get()).toEqual({ n: 1 });
    expect(fuera.prepare(`SELECT COUNT(*) AS n FROM "Publicacion" WHERE "cuentaId" = 'c1'`).get()).toEqual({ n: 1 });
    // WRK-09: el trabajo guarda el mismo tope de intentos que el resto de la cola.
    expect(fuera.prepare(`SELECT "maxIntentos" AS m FROM "Trabajo" WHERE "tipo" = 'publicar.subir'`).get()).toEqual({ m: 2 });
    fuera.close();
  }, 30_000);

  it("dos pedidos a la vez del mismo render y cuenta: uno encola y el otro recibe un mensaje claro", async () => {
    const [a, b] = await Promise.all([ruta.POST(pedido("c2"), ctx), ruta.POST(pedido("c2"), ctx)]);
    const estados = [a.status, b.status].sort();
    expect(estados).toEqual([201, 400]);
    const fallida = a.status === 400 ? a : b;
    expect((await fallida.json()).error).toMatch(/Ya existe una publicación/);
  }, 30_000);
});
