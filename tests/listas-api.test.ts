/** Las listas que se sondean (/api/proyectos, /api/trabajos, /api/proyectos/[id]) traen sólo lo que pintan. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-listas-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_CONFIG = path.join(dir, "config");

let db: typeof import("@/lib/db")["db"];
let rutaProyectos: typeof import("@/app/api/proyectos/route");
let rutaTrabajos: typeof import("@/app/api/trabajos/route");
let vista: typeof import("@/lib/vista");

const SESION = "https://upload.ejemplo/sesion-secreta-123";

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  db = (await import("@/lib/db")).db;
  rutaProyectos = await import("@/app/api/proyectos/route");
  rutaTrabajos = await import("@/app/api/trabajos/route");
  vista = await import("@/lib/vista");
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "Proyecto", tema: "t", formato: "9:16", plantilla: "x" } });
  await db.render.create({ data: { id: "r1", proyectoId: "p1", versionNumero: 1, perfil: "shorts-9x16", ruta: "renders/v1.mp4", estado: "aprobado", informeQc: { aprobado: true, reglas: [] } } });
  await db.render.create({ data: { id: "r0", proyectoId: "p1", versionNumero: 1, perfil: "shorts-9x16", ruta: "renders/v0.mp4", estado: "rechazado", informeQc: { aprobado: false, reglas: [{ id: "x" }] }, creado: new Date(Date.now() - 60_000) } });
  await db.trabajo.create({ data: { proyectoId: "p1", tipo: "publicar.subir", motor: "red", estado: "hecho", payload: { sesion: SESION }, resultado: { grande: "x".repeat(1000) }, terminado: new Date() } });
});

describe("listas sondeadas livianas (WEB-04)", () => {
  it("/api/proyectos no trae informes, payloads ni la sesión de subida", async () => {
    const texto = await (await rutaProyectos.GET()).text();
    const d = JSON.parse(texto) as { proyectos: Record<string, unknown>[] };
    expect(texto).not.toContain(SESION);
    expect(texto).not.toContain("informeQc");
    expect(texto).not.toContain("payload");
    expect(d.proyectos[0]).toMatchObject({ id: "p1", nombre: "Proyecto", formato: "9:16", estado: expect.any(String), versionActual: 0 });
    expect(d.proyectos[0]!.renders).toEqual([{ estado: "aprobado", ruta: "renders/v1.mp4", creado: expect.any(String) }]);
    expect(d.proyectos[0]!.trabajos).toEqual([{ tipo: "publicar.subir", estado: "hecho", etapa: "", progreso: 0 }]);
  });

  it("/api/trabajos no trae payload ni resultado, y no cambia mientras nada cambia", async () => {
    const pedir = async () => (await rutaTrabajos.GET(new Request("http://x/api/trabajos"))).text();
    const a = await pedir();
    expect(a).not.toContain(SESION);
    expect(a).not.toContain("payload");
    expect(a).not.toContain("resultado");
    await new Promise((r) => setTimeout(r, 5));
    expect(await pedir()).toBe(a); // nada en curso: «ahora» va fijo y la respuesta es idéntica
  });

  it("/api/proyectos/[id] no deja salir la sesión de subida", async () => {
    const v = await vista.vistaProyecto("p1");
    const texto = JSON.stringify(v);
    expect(texto).not.toContain(SESION);
    expect(v!.fila.trabajos[0]).not.toHaveProperty("payload");
    expect(v!.fila.trabajos[0]).toMatchObject({ tipo: "publicar.subir", estado: "hecho" });
  });
});
