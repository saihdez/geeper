/**
 * DSC-11 (objeción del revisor): un video del que se sacaron clips hace poco no se ofrece como «sin usar»
 * aunque se haya bajado hace 40 días, y la huella de los planos sólo se calcula si coincide el tamaño.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-dsc11-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_COMFYUI = path.join(dir, "comfy");

const huellas = vi.hoisted(() => ({ leidas: [] as string[] }));
vi.mock("@/lib/archivos", async (orig) => {
  const o = await orig<typeof import("@/lib/archivos")>();
  return { ...o, sha256Archivo: (r: string) => (huellas.leidas.push(r), o.sha256Archivo(r)) };
});

const AHORA = new Date();
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);
let m: typeof import("@/lib/liberar-espacio");
let db: typeof import("@/lib/db")["db"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  m = await import("@/lib/liberar-espacio");
  db = (await import("@/lib/db")).db;
}, 60_000);

function texto(ruta: string, contenido: string, dias: number) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido);
  fs.utimesSync(ruta, hace(dias), hace(dias));
}

describe("DSC-11", () => {
  it("una fuente vieja con un clip.importar terminado hace 2 días no se ofrece; otra sin uso, sí", async () => {
    const fuentes = path.join(dir, "_fuentes");
    texto(path.join(fuentes, "cccccccccccc", "fuente.mp4"), "vod-con-clip", 40);
    texto(path.join(fuentes, "dddddddddddd", "fuente.mp4"), "vod-sin-uso", 40);
    await db.trabajo.create({ data: { tipo: "clip.importar", motor: "cpu", estado: "hecho", payload: { fuenteId: "cccccccccccc" }, creado: hace(2) } });
    // Uno igual de terminado, pero de hace 45 días: ya no cuenta como uso reciente.
    await db.trabajo.create({ data: { tipo: "clip.importar", motor: "cpu", estado: "hecho", payload: { fuenteId: "dddddddddddd" }, creado: hace(45) } });
    const e = await m.medirEspacio(AHORA);
    expect(e.borrable.fuentes).toEqual({ cuantos: 1, bytes: "vod-sin-uso".length });
    expect((await m.liberar("fuentes", true, AHORA)).cuantos).toBe(1);
    expect(fs.existsSync(path.join(fuentes, "cccccccccccc", "fuente.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(fuentes, "dddddddddddd", "fuente.mp4"))).toBe(false);
  });

  it("los planos de otro tamaño que los assets/wan-* no se leen enteros", async () => {
    await db.proyecto.create({ data: { id: "ia", slug: "ia", nombre: "IA", tema: "t", formato: "9:16", plantilla: "x" } });
    const { dirProyecto } = await import("@/lib/rutas");
    const p = dirProyecto("ia");
    const h = createHash("sha256").update("plano-1").digest("hex").slice(0, 12);
    texto(path.join(p, "build", "planos", "e01", "salida.mp4"), "plano-1", 1);
    texto(path.join(p, "assets", `wan-${h}.mp4`), "plano-1", 1);
    texto(path.join(p, "build", "planos", "e02", "salida.mp4"), "otro plano más largo", 1);
    huellas.leidas = [];
    const e = await m.medirEspacio(AHORA);
    expect(e.borrable.copias).toEqual({ cuantos: 1, bytes: "plano-1".length });
    const planos = huellas.leidas.filter((r) => r.includes(`${path.sep}planos${path.sep}`));
    expect(planos).toEqual([path.join(p, "build", "planos", "e01", "salida.mp4")]);
  });
});
