/**
 * SEG-05: la voz nueva y animar una escena tardan de 30 s a varios minutos. Lo que la persona edita
 * mientras tanto no se borra: lo generado se pone sobre la versión de ahora.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Palabra, Proyecto } from "@/lib/esquema";
import { proyectoDePrueba } from "./fixtures";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-encima-"));
process.env.GEEPER_DATA = dir;

/** Lo que «la persona» guarda mientras el trabajo corre (null: nadie toca nada). */
let editadoMientras: Proyecto | null = null;
let guardadoAlEmpezar: Proyecto;
const guardados: Proyecto[] = [];

vi.mock("@/lib/almacen", () => ({
  describirAsset: async (_d: string, ruta: string, o: { id: string; tipo: string; source: string; licencia: string; regenerar?: object }) => ({
    ...o, ruta, hash: "b".repeat(64), duracion: 6, regenerar: o.regenerar ?? {},
  }),
  leerGuardado: async () => structuredClone(guardadoAlEmpezar),
  guardarEncima: async (_id: string, _nota: string, aplicar: (p: Proyecto) => Proyecto, partida?: { guardada: Proyecto | null; copia: Proyecto }) => {
    const actual = editadoMientras ?? partida?.guardada ?? guardadoAlEmpezar;
    const base = !editadoMientras && partida ? partida.copia : actual;
    guardados.push(aplicar(structuredClone(base)));
    return 9;
  },
  guardarProyecto: async (_id: string, p: Proyecto) => (guardados.push(p), 9),
  registrarAssetsEnDb: async () => {},
}));
vi.mock("@/lib/modelos", () => ({ huellaPesos: async () => null, etiquetaPesos: async (m: string) => `${m}@sin-pesos-locales` }));
/** Tiempos de la voz nueva: una palabra cada 0,5 s. */
const alinear = async (_ctx: unknown, _ruta: string, texto: string): Promise<Palabra[]> =>
  texto.split(" ").map((t, k) => ({ texto: t, inicio: k * 0.5, fin: k * 0.5 + 0.4 }));
vi.mock("@/lib/voz", async (orig) => ({
  ...(await orig<typeof import("@/lib/voz")>()),
  sintetizar: async (_t: string, _v: string, _vel: number, salida: string) => fs.writeFileSync(salida, "wav"),
  alinearVozNueva: alinear,
}));

const ctx = { dir, log: () => {} };

beforeEach(() => {
  guardadoAlEmpezar = proyectoDePrueba();
  guardadoAlEmpezar.voz.motor = "kokoro";
  editadoMientras = null;
  guardados.length = 0;
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
});

describe("Voz nueva (regenerarVoz)", () => {
  it("de una escena: lo corregido en otra escena mientras tanto se conserva", async () => {
    const { regenerarVoz } = await import("@/lib/regenerar");
    editadoMientras = structuredClone(guardadoAlEmpezar);
    editadoMientras.escenas.e01!.correcciones = [{ desde: 0, hasta: 1, texto: "Corregido a mano" }];
    editadoMientras.nombre = "Nombre nuevo";
    const r = await regenerarVoz(ctx, "p1", guardadoAlEmpezar, "e02");
    expect(r.version).toBe(9);
    const g = guardados[0]!;
    expect(g.nombre).toBe("Nombre nuevo");
    expect(g.escenas.e01!.correcciones).toEqual([{ desde: 0, hasta: 1, texto: "Corregido a mano" }]);
    expect(g.pistas.find((x) => x.id === "voz")!.clips[1]!.asset).toMatch(/^voz-tts-/);
  });

  it("del guion completo: los cambios que no tocan lo que se dice se conservan", async () => {
    const { regenerarVoz } = await import("@/lib/regenerar");
    editadoMientras = structuredClone(guardadoAlEmpezar);
    editadoMientras.nombre = "Editado mientras";
    await regenerarVoz(ctx, "p1", guardadoAlEmpezar, null);
    const g = guardados[0]!;
    expect(g.nombre).toBe("Editado mientras");
    expect(new Set(g.pistas.find((x) => x.id === "voz")!.clips.map((c) => c.asset)).size).toBe(1);
  });

  it("si cambió lo que dice la escena, no se guarda y se avisa", async () => {
    const { regenerarVoz } = await import("@/lib/regenerar");
    editadoMientras = structuredClone(guardadoAlEmpezar);
    editadoMientras.escenas.e02!.recortes = [{ inicio: 3, fin: 3.4, motivo: "palabras" }];
    await expect(regenerarVoz(ctx, "p1", guardadoAlEmpezar, "e02")).rejects.toThrow(/cambió lo que dice la escena 2.*Vuelve a pedir la voz/);
    expect(guardados).toEqual([]);
  });

  it("si nadie editó, guarda la copia del trabajo (traducir le pasa cambios suyos sin guardar)", async () => {
    const { regenerarVoz } = await import("@/lib/regenerar");
    const copia = structuredClone(guardadoAlEmpezar);
    copia.nombre = "Traducido (sin guardar todavía)";
    await regenerarVoz(ctx, "p1", copia, null);
    expect(guardados[0]!.nombre).toBe("Traducido (sin guardar todavía)");
  });
});

describe("Animar una escena (ponerPlano)", () => {
  const asset: Asset = { id: "wan-1", tipo: "video", ruta: "assets/wan-1.mp4", hash: "c".repeat(64), source: "wan", licencia: "x", duracion: 3, regenerar: {} };
  const plan = { escena: "e02", numero: 2, modelo: { fps: 16 } as never, conImagen: true };

  it("pone el video sobre la versión de ahora y deja lo demás como lo dejó la persona", async () => {
    const { ponerPlano } = await import("@/lib/plano");
    const ahora = proyectoDePrueba();
    ahora.escenas.e01!.correcciones = [{ desde: 0, hasta: 1, texto: "Corregido a mano" }];
    const { p } = ponerPlano(ahora, plan, asset, "clip-02");
    expect(p.escenas.e01!.correcciones).toHaveLength(1);
    expect(p.pistas.find((x) => x.id === "visual")!.clips[1]!.asset).toBe("wan-1");
  });

  it("si la escena ya no está o cambió su imagen, no lo pone", async () => {
    const { ponerPlano } = await import("@/lib/plano");
    const sinEscena = proyectoDePrueba();
    for (const x of sinEscena.pistas) x.clips = x.clips.filter((c) => c.escena !== "e02");
    delete sinEscena.escenas.e02;
    expect(() => ponerPlano(sinEscena, plan, asset, "clip-02")).toThrow(/se quitó la escena 2/);
    const otraImagen = proyectoDePrueba();
    otraImagen.pistas.find((x) => x.id === "visual")!.clips[1]!.asset = "clip-03";
    expect(() => ponerPlano(otraImagen, plan, asset, "clip-02")).toThrow(/cambiaste la imagen de la escena 2/);
  });
});
