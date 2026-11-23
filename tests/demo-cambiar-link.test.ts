/** UX-17: un link que no abre corta antes de la voz, y «Cambiar el link» vuelve a Nuevo con lo escrito. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-cambiar-link-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_CONFIG = path.join(dir, "config");

const sintetizar = vi.hoisted(() => vi.fn());
const carpetas = vi.hoisted(() => vi.fn());
vi.mock("@/lib/regenerar", () => ({ sintetizarAsset: sintetizar }));
vi.mock("@/lib/almacen", async (original) => ({ ...(await original<typeof import("@/lib/almacen")>()), crearCarpetas: carpetas }));

let db: typeof import("@/lib/db")["db"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  db = (await import("@/lib/db")).db;
}, 60_000);

afterEach(() => vi.unstubAllGlobals());

describe("importarDemo con un link que no existe", () => {
  it("corta con el mensaje simple sin hacer la voz ni crear carpetas", async () => {
    const { importarDemo } = await import("@/lib/importador-demo");
    const { noAbre } = await import("@/lib/demo-web-toma");
    const cod = Object.assign(new Error("getaddrinfo ENOTFOUND tuproduto.co"), { code: "ENOTFOUND" });
    vi.stubGlobal("fetch", () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: cod })));
    const log: string[] = [];
    const url = "https://tuproduto.co";
    await expect(
      importarDemo(
        { dir, log: (l) => log.push(l) },
        {
          proyectoId: "p",
          slug: "p",
          nombre: "p",
          tema: "t",
          formato: "9:16",
          plantilla: { slug: "x", datos: { voz: {} } as never },
          url,
          estilo: "3d",
          texto: "Conoce Tu Producto.",
        },
      ),
    ).rejects.toThrow(noAbre(url));
    expect(sintetizar).not.toHaveBeenCalled();
    expect(carpetas).not.toHaveBeenCalled();
  });
});

describe("enlaceDeTrabajoDemo", () => {
  it("toma el link, el texto, el estilo y «es mío» del trabajo, y la forma y el estilo del canal del proyecto", async () => {
    const { enlaceDeTrabajoDemo, leerBorradorDemo } = await import("@/lib/demo-web");
    const e = enlaceDeTrabajoDemo({ url: "https://tuproduto.co", texto: "Hola.", estilo: "plano", propio: true, historia: "clic" }, { formato: "16:9", plantilla: "gta-vi-shorts" });
    expect(leerBorradorDemo(new URL(e, "http://x").searchParams)).toEqual({ url: "https://tuproduto.co", texto: "Hola.", estilo: "plano", propio: true, formato: "16:9", plantilla: "gta-vi-shorts" });
  });

  it("descarta lo que no es válido", async () => {
    const { enlaceDeTrabajoDemo } = await import("@/lib/demo-web");
    expect(enlaceDeTrabajoDemo({ url: 3, estilo: "raro", propio: "si" }, { formato: "4:3", plantilla: "../x" })).toBe("/nuevo?modo=web");
    expect(enlaceDeTrabajoDemo(null, null)).toBe("/nuevo?modo=web");
  });
});

describe("GET /api/demos/borrador", () => {
  it("da el enlace de un demo.crear y un 404 simple para otro trabajo", async () => {
    await db.proyecto.create({ data: { id: "pd", slug: "pd", nombre: "Demo", tema: "t", formato: "9:16", plantilla: "gta-vi-shorts" } });
    const t = await db.trabajo.create({ data: { proyectoId: "pd", tipo: "demo.crear", motor: "cpu", estado: "fallido", payload: { url: "https://tuproduto.co", texto: "Hola.", estilo: "3d" } } });
    const otro = await db.trabajo.create({ data: { proyectoId: "pd", tipo: "render.final", motor: "cpu", estado: "fallido", payload: {} } });
    const { GET } = await import("@/app/api/demos/borrador/route");
    const r = await GET(new Request(`http://x/api/demos/borrador?trabajo=${t.id}`));
    expect(r.status).toBe(200);
    const { enlace } = (await r.json()) as { enlace: string };
    expect(enlace).toBe("/nuevo?modo=web&url=https%3A%2F%2Ftuproduto.co&texto=Hola.&formato=9%3A16&estilo=3d&plantilla=gta-vi-shorts");
    const r2 = await GET(new Request(`http://x/api/demos/borrador?trabajo=${otro.id}`));
    expect(r2.status).toBe(404);
    expect(((await r2.json()) as { error: string }).error).toMatch(/Vuelve a Nuevo/);
    expect((await GET(new Request("http://x/api/demos/borrador"))).status).toBe(404);
  });
});

describe("¿Dónde va «Cambiar el link»?", () => {
  it("sólo en un video de página web que no llegó a armarse", async () => {
    const { ofreceCambiarLink } = await import("@/components/cambiar-link");
    expect(ofreceCambiarLink({ tipo: "demo.crear", estado: "fallido" })).toBe(true);
    expect(ofreceCambiarLink({ tipo: "demo.crear", estado: "interrumpido" })).toBe(true);
    expect(ofreceCambiarLink({ tipo: "demo.crear", estado: "hecho" })).toBe(false);
    expect(ofreceCambiarLink({ tipo: "render.final", estado: "fallido" })).toBe(false);
  });
});
