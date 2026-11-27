/** UX-36: las recetas pesadas preguntan antes de bajar y nada llena el disco sin avisar. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { avisoDescarga, bytesPorBajar, faltaEspacio, LIGERA } from "@/lib/workflows-texto";
import { bajarModelo, espacioLibre } from "@/lib/workflows";

const GB = 1e9;

describe("antes de bajar los modelos (UX-36)", () => {
  it("lo que ya está en el disco se descuenta; si no falta nada, no baja nada", () => {
    expect(bytesPorBajar(32 * GB, 2, 12 * GB)).toBe(20 * GB);
    expect(bytesPorBajar(32 * GB, 0, 0)).toBe(0);
    expect(bytesPorBajar(5 * GB, 1, 9 * GB)).toBe(0);
  });

  it("pregunta si baja más de 10 GB, con el espacio que queda; si no cabe, no deja empezar", () => {
    expect(avisoDescarga(32 * GB, 200 * GB).pregunta).toBe("Esta receta baja unos 32 GB. Puede tardar mucho y quizá no quepa en tu tarjeta de video. En el disco quedan 200 GB libres. ¿Seguir?");
    expect(avisoDescarga(LIGERA - 1, 200 * GB)).toEqual({});
    expect(avisoDescarga(0, 1)).toEqual({});
    expect(avisoDescarga(32 * GB, 20 * GB).bloqueo).toMatch(/^No hay espacio: esta receta baja unos 32 GB y en el disco quedan 20 GB libres/);
    expect(avisoDescarga(4 * GB, 5 * GB).bloqueo).toBeDefined(); // deja 2 GB de margen
    expect(avisoDescarga(32 * GB, null).pregunta).toBe("Esta receta baja unos 32 GB. Puede tardar mucho y quizá no quepa en tu tarjeta de video. ¿Seguir?");
  });

  it("un modelo que no cabe no se empieza a bajar", () => {
    expect(faltaEspacio("wan.safetensors", 30 * GB, 10 * GB)).toMatch(/No hay espacio en el disco para bajar wan\.safetensors: pesa 30 GB y quedan 10 GB libres/);
    expect(faltaEspacio("x", 1 * GB, 10 * GB)).toBeNull();
    expect(faltaEspacio("x", 0, 1)).toBeNull(); // sin tamaño conocido se baja como antes
  });
});

describe("bajarModelo mira el disco (UX-36)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-descarga-"));
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("sabe cuánto queda libre, aunque la carpeta todavía no exista", async () => {
    expect(await espacioLibre(path.join(dir, "no", "existe"))).toBeGreaterThan(0);
  });

  it("con un modelo más grande que el disco, avisa y no deja archivo", async () => {
    const cancelar = vi.fn(async () => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-length": String(1e18) }), body: { cancel: cancelar } })));
    const destino = path.join(dir, "models", "vae", "enorme.safetensors");
    await expect(bajarModelo("https://example.invalid/enorme", destino, () => {})).rejects.toThrow(/No hay lugar suficiente en el disco (\S+ )?para bajar enorme\.safetensors/);
    expect(cancelar).toHaveBeenCalled();
    expect(fs.existsSync(destino)).toBe(false);
    expect(fs.existsSync(`${destino}.part`)).toBe(false);
  });
});
