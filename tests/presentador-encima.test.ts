/** SEG-05: el presentador se guarda sobre la versión de ahora, no sobre la copia leída al empezar. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aplicarEdicion } from "@/lib/ediciones";
import type { Proyecto } from "@/lib/esquema";
import { pista } from "@/lib/esquema";
import { proyectoDePrueba } from "./fixtures";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-presentador-"));
const m = vi.hoisted(() => ({ ahora: null as unknown as Proyecto, guardado: null as Proyecto | null, registrados: null as Proyecto | null }));

vi.mock("@/lib/almacen", () => ({
  leerGuardado: async () => proyectoDePrueba(),
  describirAsset: async (_d: string, ruta: string, x: Record<string, unknown>) => ({ ...x, ruta, hash: "b".repeat(64), duracion: 9.3, ancho: 480, alto: 640 }),
  guardarEncima: async (_id: string, _nota: string, aplicar: (b: Proyecto) => Proyecto) => ((m.guardado = aplicar(structuredClone(m.ahora))), 7),
  registrarAssetsEnDb: async (_id: string, p: Proyecto) => void (m.registrados = p),
}));
vi.mock("@/lib/avatares", () => ({ leerAvatar: async (id: string) => ({ id, nombre: "Sofía", licencia: "propia" }), rutaRetrato: () => path.join(dir, "retrato.png") }));
vi.mock("@/lib/proceso", () => ({ correr: async () => undefined }));
vi.mock("@/lib/caras", () => ({ conFocos: async (_c: unknown, p: Proyecto) => ({ p }) }));
vi.mock("@/lib/wan2gp", () => ({
  instalacionWan2gp: () => ({}),
  probarWan2gp: async () => ({}),
  generarPlano: async () => {
    const v = path.join(dir, "salida.mp4");
    await fs.writeFile(v, "video");
    return v;
  },
}));

const { generarPresentador, PISTA_PRESENTADOR } = await import("@/lib/presentador");
const ctx = { dir, log: () => undefined };

beforeEach(async () => {
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.writeFile(path.join(dir, "retrato.png"), "png");
  m.guardado = null;
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe("presentador sobre la versión de ahora (SEG-05)", () => {
  it("lo editado mientras se generaba queda, y el presentador se agrega encima", async () => {
    m.ahora = aplicarEdicion(proyectoDePrueba(), { tipo: "renombrar", nombre: "Editado mientras tanto" });
    const r = await generarPresentador(ctx, "p1", proyectoDePrueba(), { avatar: "sofia-1a2b", modo: "burbuja" });
    expect(r.version).toBe(7);
    expect(m.guardado!.nombre).toBe("Editado mientras tanto");
    expect(m.guardado!.pistas.find((x) => x.id === PISTA_PRESENTADOR)?.clips[0]?.asset).toBe(r.asset);
    expect(m.registrados).toBe(m.guardado);
  });

  it("si se quitó una escena del presentador, no guarda y lo dice", async () => {
    m.ahora = aplicarEdicion(proyectoDePrueba(), { tipo: "quitarEscena", escena: "e03" });
    await expect(generarPresentador(ctx, "p1", proyectoDePrueba(), { avatar: "sofia-1a2b", modo: "pantalla", escenas: ["e01", "e03"] })).rejects.toThrow(/escena 3 se quitó/);
    expect(m.guardado).toBeNull();
    expect(pista(m.ahora, "visual").clips.length).toBe(2);
  });
});
