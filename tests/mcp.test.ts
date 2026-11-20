import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proyectoDePrueba } from "./fixtures";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-mcp-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

let cliente: Client;
let db: typeof import("@/lib/db")["db"];
const FFMPEG = path.join(os.homedir(), ".local", "bin", "ffmpeg");

type Resultado = { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };
async function llamar(name: string, args: Record<string, unknown>): Promise<Resultado> {
  return (await cliente.callTool({ name, arguments: args })) as Resultado;
}
async function json(name: string, args: Record<string, unknown>) {
  const r = await llamar(name, args);
  expect(r.isError, r.content[0]?.text).toBeFalsy();
  return JSON.parse(r.content[0]!.text!);
}

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  db = (await import("@/lib/db")).db;
  const { guardarProyecto } = await import("@/lib/almacen");
  await db.proyecto.create({ data: { id: "p1", slug: "faros", nombre: "Prueba", tema: "t", formato: "9:16", plantilla: "gta-vi-shorts" } });
  await guardarProyecto("p1", proyectoDePrueba(), "Inicial");
  const { crearServidor } = await import("@/lib/mcp");
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await crearServidor().connect(st);
  cliente = new Client({ name: "prueba", version: "1" });
  await cliente.connect(ct);
}, 60_000);

afterAll(async () => {
  await cliente?.close();
});

describe("servidor MCP de Geeper (B1)", () => {
  it("anuncia sus herramientas con permisos: escribir pide confirmación, nada publica", async () => {
    const { tools } = await cliente.listTools();
    const por = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(por).sort()).toEqual(
      ["aplicar_cambio", "encolar", "esquema", "fotograma", "momentos_buscar", "proponer_cambio", "proyecto_leer", "proyectos_listar", "trabajo_estado"].sort(),
    );
    for (const n of ["proyectos_listar", "proyecto_leer", "esquema", "proponer_cambio", "trabajo_estado", "fotograma"]) expect(por[n]!.annotations?.readOnlyHint, n).toBe(true);
    for (const n of ["aplicar_cambio", "encolar"]) expect(por[n]!.annotations?.destructiveHint, n).toBe(true);
    expect(JSON.stringify(tools)).not.toMatch(/publicar\.subir|mpt\.generar/);
  });

  it("proyectos_listar y proyecto_leer", async () => {
    const lista = await json("proyectos_listar", {});
    expect(lista).toEqual([expect.objectContaining({ slug: "faros", version: 1, ultimoRender: null })]);
    const p = await json("proyecto_leer", { slug: "faros" });
    expect(p.version).toBe(1);
    expect(p.geeper.escenas.e02.id).toBe("e02");
    expect(p.versiones[0].nota).toBe("Inicial");
    expect((await llamar("proyecto_leer", { slug: "no-existe" })).isError).toBe(true);
  });

  it("esquema devuelve el JSON Schema publicado", async () => {
    const j = await json("esquema", { nombre: "director" });
    expect(j.$id).toBe("https://geeper.local/esquemas/director.schema.json");
  });

  it("proponer_cambio muestra diferencias sin guardar; aplicar_cambio guarda sobre la versión revisada", async () => {
    const propuesta = [{ tipo: "quitarEscena", escena: "e03" }];
    const ev = await json("proponer_cambio", { slug: "faros", propuesta });
    expect(ev.valida).toBe(true);
    expect(ev.diferencias.escenas.some((l: string) => l.startsWith("- e03"))).toBe(true);
    expect((await json("proyecto_leer", { slug: "faros" })).version).toBe(1);

    const vieja = await llamar("aplicar_cambio", { slug: "faros", propuesta, versionBase: 0 });
    expect(vieja.isError).toBe(true);
    expect(vieja.content[0]!.text).toMatch(/cambió/);

    const ok = await json("aplicar_cambio", { slug: "faros", propuesta, versionBase: ev.version });
    expect(ok.aplicada).toBe(2);
    const p = await json("proyecto_leer", { slug: "faros" });
    expect(Object.keys(p.geeper.escenas)).not.toContain("e03");
  });

  it("dos guardados sobre la misma versión: el segundo no pisa al primero (comprobado dentro de la transacción)", async () => {
    const { guardarProyecto } = await import("@/lib/almacen");
    const { versionDeProyecto } = await import("@/lib/render");
    const { p, numero } = await versionDeProyecto("p1");
    const [a, b] = await Promise.allSettled([guardarProyecto("p1", p, "A", { versionBase: numero }), guardarProyecto("p1", p, "B", { versionBase: numero })]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(String((a.status === "rejected" ? a : b as PromiseRejectedResult).reason)).toMatch(/El proyecto cambió/);
  });

  it("momentos_buscar no acepta una fuente que parezca una opción", async () => {
    expect((await llamar("momentos_buscar", { src: "--exec=touch /tmp/x" })).isError).toBe(true);
  });

  it("una propuesta inválida no se aplica y dice el paso", async () => {
    const { versionActual } = await db.proyecto.findUniqueOrThrow({ where: { id: "p1" } });
    const r = await llamar("aplicar_cambio", { slug: "faros", propuesta: [{ tipo: "quitarEscena", escena: "e99" }], versionBase: versionActual });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/paso 1/);
  });

  it("encolar fija la cadena (no se puede encadenar una publicación) y trabajo_estado lo muestra", async () => {
    const r = await json("encolar", { slug: "faros", tipo: "voz.regenerar", payload: { escena: "e01", cadena: ["publicar.subir"] } });
    const t = await db.trabajo.findUniqueOrThrow({ where: { id: r.trabajo } });
    expect(t.payload).toEqual({ escena: "e01", cadena: ["render.entregar"] });
    const est = await json("trabajo_estado", { id: r.trabajo });
    expect(est).toMatchObject({ tipo: "voz.regenerar", estado: "pendiente" });
    expect((await llamar("encolar", { slug: "faros", tipo: "publicar.subir" })).isError).toBe(true);
    const render = await json("encolar", { slug: "faros", tipo: "render.entregar", payload: { version: 1 } });
    const { versionActual } = await db.proyecto.findUniqueOrThrow({ where: { id: "p1" } });
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: render.trabajo } })).payload).toEqual({ version: versionActual });
  });

  it("momentos_buscar encola la búsqueda", async () => {
    const r = await json("momentos_buscar", { src: "/tmp/no-importa.mp4" });
    expect((await db.trabajo.findUniqueOrThrow({ where: { id: r.trabajo } })).tipo).toBe("clip.momentos");
  });

  it.skipIf(!fs.existsSync(FFMPEG))("fotograma devuelve un PNG del último render", async () => {
    expect((await llamar("fotograma", { slug: "faros", segundo: 0 })).isError).toBe(true);
    const renders = path.join(dir, "faros", "renders");
    fs.mkdirSync(renders, { recursive: true });
    execFileSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=1", "-pix_fmt", "yuv420p", path.join(renders, "v2-shorts.mp4")]);
    await db.render.create({ data: { proyectoId: "p1", versionNumero: 3, perfil: "shorts-9x16", ruta: "renders/v2-shorts.mp4", estado: "aprobado", duracion: 1 } });
    const r = await llamar("fotograma", { slug: "faros", segundo: 0.5 });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(r.content[0]!.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect((await llamar("fotograma", { slug: "faros", segundo: 9 })).content[0]!.text).toMatch(/dura/);
  });
});
