/** SRV-01 (ronda 2): subir un clip propio lo recibe en flujo a assets/, con el nombre por su sha256. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-clip-flujo-"));
process.env.GEEPER_DATA = dir;

const guardados: { nota: string }[] = [];
vi.mock("@/lib/db", () => ({ db: { proyecto: { findUniqueOrThrow: async () => ({ id: "p1", slug: "mi-video" }) } } }));
vi.mock("@/lib/render", () => ({ versionDeProyecto: async () => ({ p: { escenas: {} } }) }));
vi.mock("@/lib/ediciones", () => ({ aplicarEdicion: (p: unknown) => p, registrarAsset: (p: unknown) => p, reemplazarVisual: (p: unknown) => p }));
vi.mock("@/lib/caras", () => ({ conFocos: async (_c: unknown, p: unknown) => ({ p }) }));
vi.mock("@/lib/mezcla-auto", () => ({ detectarMezcla: async () => null }));
vi.mock("@/lib/almacen", () => ({
  describirAsset: async (_d: string, ruta: string, o: { id: string; tipo: string }) => ({ ...o, ruta }),
  guardarProyecto: async (_id: string, _p: unknown, nota: string) => (guardados.push({ nota }), 7),
  registrarAssetsEnDb: async () => {},
}));

const ctx = { params: Promise.resolve({ id: "p1" }) };
const assets = path.join(dir, "mi-video", "assets");

function pedido(fd: FormData) {
  return new Request("http://x/api/proyectos/p1/clip", { method: "POST", body: fd });
}

beforeEach(() => {
  fs.rmSync(assets, { recursive: true, force: true });
  guardados.length = 0;
});

describe("POST /api/proyectos/[id]/clip en flujo (SRV-01)", () => {
  it("un audio a una pista: queda en assets/subido-<sha256>.wav, sin temporales", async () => {
    const { POST } = await import("@/app/api/proyectos/[id]/clip/route");
    const contenido = Buffer.alloc(200_000, 7);
    const fd = new FormData();
    fd.set("pista", "sfx");
    fd.set("inicio", "2.5");
    fd.set("archivo", new File([contenido], "golpe.wav"));
    const r = await POST(pedido(fd), ctx);
    const cuerpo = await r.json();
    expect(r.status).toBe(201);
    const sha = createHash("sha256").update(contenido).digest("hex");
    expect(cuerpo).toEqual({ version: 7, asset: `subido-${sha.slice(0, 12)}` });
    expect(fs.readdirSync(assets)).toEqual([`subido-${sha.slice(0, 12)}.wav`]);
    expect(fs.readFileSync(path.join(assets, `subido-${sha.slice(0, 12)}.wav`)).equals(contenido)).toBe(true);
    expect(guardados[0]!.nota).toMatch(/Efecto de sonido en sfx \(2\.5 s\): golpe\.wav/);
  });

  it("formato no admitido o audio en una escena: error claro y no queda nada", async () => {
    const { POST } = await import("@/app/api/proyectos/[id]/clip/route");
    const fd = new FormData();
    fd.set("escena", "e01");
    fd.set("archivo", new File(["x"], "virus.exe"));
    const r = await POST(pedido(fd), ctx);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Formato no admitido: .exe");

    const fd2 = new FormData();
    fd2.set("escena", "e01");
    fd2.set("archivo", new File(["x"], "voz.mp3"));
    const r2 = await POST(pedido(fd2), ctx);
    expect((await r2.json()).error).toBe("Formato no admitido: .mp3");
    expect(fs.readdirSync(assets)).toEqual([]);
  });

  it("un SVG de más de 20 MB se corta mientras llega", async () => {
    const { POST } = await import("@/app/api/proyectos/[id]/clip/route");
    const fd = new FormData();
    fd.set("escena", "e01");
    fd.set("archivo", new File([Buffer.alloc(21 * 1024 ** 2, 32)], "logo.svg"));
    const r = await POST(pedido(fd), ctx);
    expect((await r.json()).error).toMatch(/pasa de 20 MB/);
    expect(fs.readdirSync(assets)).toEqual([]);
  });

  it("un pedido que dice pesar más de 2 GB se rechaza antes de leerlo", async () => {
    const { POST } = await import("@/app/api/proyectos/[id]/clip/route");
    const r = new Request("http://x", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=a", "content-length": String(3 * 1024 ** 3) } });
    const res = await POST(r, ctx);
    expect((await res.json()).error).toBe("El archivo pasa de 2 GB");
  });
});
