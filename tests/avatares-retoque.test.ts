import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Datos en una carpeta temporal: GEEPER_DATA se lee al llamar a dirDatos().
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-retoque-"));
process.env.GEEPER_DATA = tmp;
const { elegirRetoque, leerAvatar, OPCIONES_RETOQUE, vistaAvatar } = await import("@/lib/avatares");

const ID = "prueba-1a2b";
const dir = path.join(tmp, "avatares", ID);
const corrida = "2026-11-22T04-30-44-359Z";

async function armar() {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, "_retoques", corrida), { recursive: true });
  await fs.writeFile(path.join(dir, "retrato.png"), "actual");
  await fs.writeFile(path.join(dir, "_retoques", corrida, "toma-1.png"), "opcion-1");
  await fs.writeFile(path.join(dir, "_retoques", corrida, "toma-2.png"), "opcion-2");
  const ahora = "2026-11-22T04:00:00.000Z";
  await fs.writeFile(path.join(dir, "avatar.json"), JSON.stringify({
    id: ID, nombre: "Prueba", descripcion: "personaje de prueba", estilo: "caricatura", origen: "descripcion", versiones: [],
    retoque: { corrida, nota: "ponle lentes", tomas: ["toma-1.png", "toma-2.png"], fecha: ahora },
    creado: ahora, actualizado: ahora, licencia: "Apache-2.0 (Tongyi-MAI/Z-Image-Turbo); generado con WanGP",
  }));
}

describe("retoque con opciones: nada cambia hasta elegir", () => {
  beforeAll(armar);
  afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

  it("deja 2 opciones y la vista las muestra junto al actual", async () => {
    expect(OPCIONES_RETOQUE).toBe(2);
    const v = vistaAvatar(await leerAvatar(ID));
    expect(v.retoque?.nota).toBe("ponle lentes");
    expect(v.retoque?.opciones).toHaveLength(2);
    expect(v.retoque?.opciones[0]).toMatch(/^\/api\/archivos\/avatares\/prueba-1a2b\/_retoques\/2026-11-22T04-30-44-359Z\/toma-1\.png\?v=/);
  });

  it("elegir la opción 2: pasa a ser el retrato y el anterior queda como versión (se puede deshacer)", async () => {
    const a = await elegirRetoque(ID, 2);
    expect(await fs.readFile(path.join(dir, "retrato.png"), "utf8")).toBe("opcion-2");
    expect(await fs.readFile(path.join(dir, "version-1.png"), "utf8")).toBe("actual");
    expect(a.versiones).toEqual([expect.objectContaining({ archivo: "version-1.png", nota: "ponle lentes" })]);
    expect(a.retoque).toBeUndefined();
    expect(a.licencia).toContain("Qwen-Image-Edit");
    expect(existsSync(path.join(dir, "_retoques", corrida))).toBe(false);
    await expect(elegirRetoque(ID, 1)).rejects.toThrow(/no tiene un retoque esperando/);
  });

  it("quedarse con el actual: el retrato no cambia y no se agrega versión", async () => {
    await armar();
    const a = await elegirRetoque(ID, null);
    expect(await fs.readFile(path.join(dir, "retrato.png"), "utf8")).toBe("actual");
    expect(a.versiones).toEqual([]);
    expect(a.retoque).toBeUndefined();
  });

  it("una opción que no existe no toca nada", async () => {
    await armar();
    await expect(elegirRetoque(ID, 5)).rejects.toThrow(/ya no existe/);
    expect(await fs.readFile(path.join(dir, "retrato.png"), "utf8")).toBe("actual");
    expect((await leerAvatar(ID)).retoque).toBeDefined();
  });
});
