import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-almacen-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const HIJO = path.join(process.cwd(), "tests", "ayudas", "guardar-hijo.ts");

type Db = typeof import("@/lib/db");
let db: Db["db"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  db = (await import("@/lib/db")).db;
  await (await import("@/lib/db")).prepararDb();
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
  fs.mkdirSync(path.join(dir, "p1"), { recursive: true });
}, 60_000);

function hijo(cuantos: number, quien: string): Promise<{ fallos: number; errores: string[] }> {
  return new Promise((resolve, reject) => {
    const h = spawn(TSX, [HIJO, "p1", String(cuantos), quien], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    let salida = "";
    h.stdout.on("data", (d) => (salida += d));
    h.on("error", reject);
    h.on("exit", () => {
      try {
        resolve(JSON.parse(salida));
      } catch (e) {
        reject(new Error(`Salida inválida del hijo: ${salida} (${String(e)})`));
      }
    });
  });
}

describe("tabla Asset (SRV-03)", () => {
  it("registrarAssetsEnDb ya no escribe filas que nadie lee", async () => {
    const { registrarAssetsEnDb } = await import("@/lib/almacen");
    const { proyectoDePrueba } = await import("./fixtures");
    await registrarAssetsEnDb("p1", proyectoDePrueba());
    expect(await db.asset.count()).toBe(0);
  });
});

describe("guardarProyecto con varios procesos a la vez (SEG-04)", () => {
  it("ningún guardado falla y no se repite ningún número de versión", async () => {
    const N = 25;
    const r = await Promise.all([hijo(N, "web"), hijo(N, "worker"), hijo(N, "otro")]);
    expect({ fallos: r.reduce((s, x) => s + x.fallos, 0), errores: r.flatMap((x) => x.errores) }).toEqual({ fallos: 0, errores: [] });
    const versiones = await db.version.findMany({ where: { proyectoId: "p1" }, select: { numero: true, nota: true }, orderBy: { numero: "asc" } });
    expect(versiones.map((v) => v.numero)).toEqual(Array.from({ length: 3 * N }, (_, i) => i + 1));
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id: "p1" } });
    expect(fila.versionActual).toBe(3 * N);
    // El geeper.json en disco es el de la última versión (se escribe con la base bloqueada).
    const enDisco = JSON.parse(fs.readFileSync(path.join(dir, "p1", "geeper.json"), "utf8")) as { nombre: string };
    expect(enDisco.nombre).toBe(versiones[versiones.length - 1]!.nota);
  }, 120_000);
});

describe("guardarEncima: un trabajo largo no pisa lo editado mientras tanto (SEG-05)", () => {
  it("aplica lo generado sobre la versión de ahora, no sobre la copia de cuando empezó", async () => {
    const { guardarProyecto, guardarEncima, leerProyecto } = await import("@/lib/almacen");
    const { proyectoDePrueba } = await import("./fixtures");
    await db.proyecto.create({ data: { id: "p2", slug: "p2", nombre: "p", tema: "t", formato: "9:16", plantilla: "x" } });
    fs.mkdirSync(path.join(dir, "p2"), { recursive: true });
    await guardarProyecto("p2", { ...proyectoDePrueba(), nombre: "inicio" }, "inicio");

    const copiaDelTrabajo = (await leerProyecto("p2"))!; // el trabajo lee al empezar…
    const editado = structuredClone(copiaDelTrabajo); // …y la persona edita mientras tanto
    editado.escenas.e01!.texto = "Texto corregido a mano.";
    await guardarProyecto("p2", editado, "Subtítulo corregido");

    // Al terminar, el trabajo sólo pone lo suyo (aquí, un texto en la escena 2).
    const n = await guardarEncima("p2", "Voz regenerada: escena e02", (actual) => {
      actual.escenas.e02!.texto = "Generado por el trabajo.";
      return actual;
    });
    const final = (await leerProyecto("p2"))!;
    expect(final.escenas.e01!.texto).toBe("Texto corregido a mano.");
    expect(final.escenas.e02!.texto).toBe("Generado por el trabajo.");
    expect(n).toBe(3);
    expect(copiaDelTrabajo.escenas.e01!.texto).not.toBe("Texto corregido a mano.");
  });

  it("si lo generado ya no encaja, no guarda nada ni gasta un número de versión", async () => {
    const { guardarEncima, leerProyecto } = await import("@/lib/almacen");
    const antes = await db.proyecto.findUniqueOrThrow({ where: { id: "p2" } });
    await expect(
      guardarEncima("p2", "x", (actual) => {
        if (!actual.escenas.e99) throw new Error("La escena ya no existe: no apliqué la voz nueva.");
        return actual;
      }),
    ).rejects.toThrow(/ya no existe/);
    expect((await db.proyecto.findUniqueOrThrow({ where: { id: "p2" } })).versionActual).toBe(antes.versionActual);
    expect(await db.version.count({ where: { proyectoId: "p2" } })).toBe(antes.versionActual);
    expect((await leerProyecto("p2"))!.escenas.e02!.texto).toBe("Generado por el trabajo.");
  });

  it("con «partida»: si nadie guardó, aplica sobre la copia del trabajo; si alguien guardó, sobre lo de ahora", async () => {
    const { guardarProyecto, guardarEncima, leerGuardado, leerProyecto } = await import("@/lib/almacen");
    const guardada = (await leerGuardado("p2"))!;
    const copia = { ...structuredClone(guardada), nombre: "Copia del trabajo (sin guardar)" };
    await guardarEncima("p2", "sin cambios", (b) => b, { guardada, copia });
    expect((await leerProyecto("p2"))!.nombre).toBe("Copia del trabajo (sin guardar)");

    const otra = (await leerGuardado("p2"))!;
    await guardarProyecto("p2", { ...otra, nombre: "La persona lo cambió" }, "editado");
    await guardarEncima("p2", "con cambios", (b) => b, { guardada: otra, copia: { ...otra, nombre: "Copia vieja" } });
    expect((await leerProyecto("p2"))!.nombre).toBe("La persona lo cambió");
  });
});
