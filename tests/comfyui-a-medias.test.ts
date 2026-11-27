/** UX-06: una instalación de ComfyUI cortada a medias vuelve a ofrecer el instalador, no un error sin salida. */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

let falta: string | null = null;
let catalogo: () => Promise<unknown> = async () => ({ workflows: [], archivos: {} });
vi.mock("@/lib/instalar-comfyui", () => ({ revisarComfyui: () => ({ falta, corriendo: false, disponible: true }) }));
vi.mock("@/lib/comfyui", async (original) => ({ ...(await original<typeof import("@/lib/comfyui")>()), leerCatalogo: () => catalogo() }));
vi.mock("@/lib/db", () => ({ db: { trabajo: { findMany: async () => [] } } }));

describe("instalación de ComfyUI a medias (UX-06)", () => {
  it("con código y Python pero sin la marca del final, falta terminarla", async () => {
    const { A_MEDIAS, CACHE_CATALOGO, faltaComfyui } = await import("@/lib/comfyui");
    const dir = mkdtempSync(path.join(os.tmpdir(), "comfy-medias-"));
    const python = path.join(dir, "python");
    expect(faltaComfyui(dir, python)).toBe("ComfyUI no está instalado");
    writeFileSync(path.join(dir, "main.py"), "");
    expect(faltaComfyui(dir, python)).toBe("Falta el Python de ComfyUI");
    writeFileSync(python, "");
    expect(faltaComfyui(dir, python)).toBe(A_MEDIAS);
    writeFileSync(path.join(dir, CACHE_CATALOGO), "{}");
    expect(faltaComfyui(dir, python)).toBeNull();
  });

  it("GET /api/workflows: a medias y sin catálogo legible sale el instalador con «Reparar»; se prueba una sola vez", async () => {
    const { A_MEDIAS } = await import("@/lib/comfyui");
    falta = A_MEDIAS;
    let lecturas = 0;
    catalogo = async () => {
      lecturas++;
      throw new Error("No pude leer el catálogo de workflows: ModuleNotFoundError");
    };
    delete (globalThis as { __comfyAMediasProbada?: string }).__comfyAMediasProbada;
    const { GET } = await import("@/app/api/workflows/route");
    const { comfy } = (await (await GET()).json()) as { comfy: { listo: boolean; aMedias: boolean; detalle: string } };
    expect(comfy).toMatchObject({ listo: false, aMedias: true });
    expect(comfy.detalle).toMatch(/catálogo/);
    // El sondeo (cada 4 s) no vuelve a correr Python.
    await GET();
    expect(lecturas).toBe(1);
  });

  it("GET /api/workflows: a medias pero el catálogo se lee bien → lista (ComfyUI propia sin la marca)", async () => {
    const { A_MEDIAS } = await import("@/lib/comfyui");
    falta = A_MEDIAS;
    catalogo = async () => ({ workflows: [], archivos: {} });
    delete (globalThis as { __comfyAMediasProbada?: string }).__comfyAMediasProbada;
    const { GET } = await import("@/app/api/workflows/route");
    const { comfy } = (await (await GET()).json()) as { comfy: { listo: boolean; aMedias: boolean } };
    expect(comfy).toMatchObject({ listo: true, aMedias: false });
  });

  it("GET /api/workflows: si el catálogo no se puede leer, también ofrece reparar (no un error)", async () => {
    falta = null;
    catalogo = async () => {
      throw new Error("No pude leer el catálogo de workflows: ModuleNotFoundError");
    };
    const { GET } = await import("@/app/api/workflows/route");
    const r = await GET();
    expect(r.status).toBe(200);
    const { comfy } = (await r.json()) as { comfy: { listo: boolean; aMedias: boolean; detalle: string } };
    expect(comfy).toMatchObject({ listo: false, aMedias: true });
    expect(comfy.detalle).toMatch(/catálogo/);
  });
});
