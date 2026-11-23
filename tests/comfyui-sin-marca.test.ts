/**
 * UX-06 (objeción del revisor): una ComfyUI completa sin la caché del catálogo (carpeta propia con
 * GEEPER_COMFYUI o caché borrada) no se queda «a medias» para siempre: se lee el catálogo una vez,
 * eso escribe la marca y Workflows queda lista.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "comfy-sin-marca-"));
const python = path.join(dir, "python");
writeFileSync(path.join(dir, "main.py"), "");
writeFileSync(python, "");
process.env.GEEPER_COMFYUI = dir;
process.env.GEEPER_COMFYUI_PYTHON = python;

let lecturas = 0;
vi.mock("@/lib/comfyui", async (original) => {
  const o = await original<typeof import("@/lib/comfyui")>();
  // Como el de verdad: si lee bien, escribe la caché (que es la marca del final).
  return { ...o, leerCatalogo: async () => (lecturas++, writeFileSync(path.join(o.COMFYUI_DIR, o.CACHE_CATALOGO), "{}"), { workflows: [], archivos: {} }) };
});
vi.mock("@/lib/db", () => ({ db: { trabajo: { findMany: async () => [] } } }));
vi.mock("@/lib/workflows", async (original) => ({ ...(await original<typeof import("@/lib/workflows")>()), listarCorridas: async () => [] }));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("ComfyUI completa sin la marca (UX-06)", () => {
  it("con main.py y Python pero sin caché, la respuesta es listo: true y queda la marca", async () => {
    const { CACHE_CATALOGO, faltaComfyui, A_MEDIAS } = await import("@/lib/comfyui");
    expect(faltaComfyui()).toBe(A_MEDIAS);
    const { GET } = await import("@/app/api/workflows/route");
    const { comfy } = (await (await GET()).json()) as { comfy: { listo: boolean; aMedias: boolean } };
    expect(comfy).toMatchObject({ listo: true, aMedias: false });
    expect(existsSync(path.join(dir, CACHE_CATALOGO))).toBe(true);
    expect(faltaComfyui()).toBeNull();
    expect(lecturas).toBeGreaterThan(0);
  });
});
