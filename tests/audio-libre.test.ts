import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  agregarEfectoLibre,
  animoDeCarpeta,
  ANIMOS,
  efectosLibres,
  GRUPOS_EFECTO,
  musicaLibre,
  NOMBRES_EFECTO,
  PISTA_EFECTOS,
  rutaSonidoLibre,
  sonidoLibre,
  sonidosLibres,
  VOLUMEN_EFECTO,
} from "../src/lib/audio-libre";
import { PISTA_EFECTOS as PISTA_MOSS, VOLUMEN_EFECTO as VOLUMEN_MOSS } from "../src/lib/efectos-sonido";
import { usoComercial } from "../src/lib/licencias";
import { LICENCIA_LIBRE } from "../src/lib/animos-musica";
import { elegirMusica } from "../src/lib/importador";
import { proyectoDePrueba } from "./fixtures";

describe("biblioteca de audio libre (audio-libre/)", () => {
  it("trae las 24 pistas y los 88 efectos, con su archivo y su sha256", () => {
    const todos = sonidosLibres();
    expect(todos.filter((s) => s.tipo === "musica")).toHaveLength(24);
    expect(efectosLibres()).toHaveLength(88);
    for (const s of todos) {
      const datos = fs.readFileSync(rutaSonidoLibre(s));
      expect(createHash("sha256").update(datos).digest("hex"), s.archivo).toBe(s.sha256);
    }
  });

  it("cada efecto tiene nombre en español y un grupo que existe; cada pista, un ánimo conocido", () => {
    for (const e of efectosLibres()) {
      expect(NOMBRES_EFECTO[e.id], e.id).toBeDefined();
      expect(Object.keys(GRUPOS_EFECTO)).toContain(e.grupo);
    }
    for (const m of musicaLibre(null)) expect(Object.keys(ANIMOS), m.id).toContain(m.grupo);
    // Ningún nombre de sobra (de un efecto que ya no está).
    expect(Object.keys(NOMBRES_EFECTO).sort()).toEqual(efectosLibres().map((e) => e.id).sort());
  });

  it("cada ánimo tiene música", () => {
    for (const a of Object.keys(ANIMOS)) expect(musicaLibre(a).length, a).toBeGreaterThan(0);
  });

  it("la licencia cuenta como uso comercial permitido en el QC", () => {
    expect(usoComercial(LICENCIA_LIBRE)).toBe("si");
  });

  it("usa la misma pista y el mismo volumen que los efectos de MOSS", () => {
    expect(PISTA_EFECTOS).toBe(PISTA_MOSS);
    expect(VOLUMEN_EFECTO).toBe(VOLUMEN_MOSS);
  });
});

describe("animoDeCarpeta", () => {
  it("una carpeta normal no es música libre", () => {
    expect(animoDeCarpeta("/home/x/canciones")).toBeUndefined();
    expect(animoDeCarpeta(null)).toBeUndefined();
  });
  it("«libre:» es cualquier ánimo; acepta la clave o el nombre en español", () => {
    expect(animoDeCarpeta("libre:")).toBeNull();
    expect(animoDeCarpeta("libre:calm")).toBe("calm");
    expect(animoDeCarpeta("libre:Tranquila")).toBe("calm");
    expect(animoDeCarpeta("libre:épica")).toBe("cinematic");
  });
  it("un ánimo que no existe es un error que dice cuáles hay", () => {
    expect(() => animoDeCarpeta("libre:metal")).toThrow(/Alegre/);
  });
});

describe("agregarEfectoLibre", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-audio-libre-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("copia el efecto al proyecto y lo pone en la pista de efectos con licencia CC0", async () => {
    const p = proyectoDePrueba();
    const s = sonidoLibre("whoosh-fast")!;
    const nuevo = await agregarEfectoLibre(tmp, p, s, 2.5);
    const a = nuevo.assets["libre-whoosh-fast"]!;
    expect(a.licencia).toBe(LICENCIA_LIBRE);
    expect(a.hash).toBe(s.sha256);
    expect(fs.existsSync(path.join(tmp, a.ruta))).toBe(true);
    const clip = nuevo.pistas.find((x) => x.id === PISTA_EFECTOS)!.clips[0]!;
    expect(clip).toMatchObject({ asset: "libre-whoosh-fast", inicio: 2.5, volumen: VOLUMEN_EFECTO });
  });
});

describe("elegirMusica con música libre", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-musica-libre-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("toma una pista del ánimo pedido, siempre la misma para el proyecto, con licencia CC0", async () => {
    fs.mkdirSync(path.join(tmp, "assets"), { recursive: true });
    const ctx = { dir: tmp, log: () => {} };
    const musica = { volumen: 0.15, ducking: true, carpeta: "libre:tranquila", licencia: "da igual" };
    const a = (await elegirMusica(ctx, "proyecto-1", musica))!;
    const b = (await elegirMusica(ctx, "proyecto-1", musica))!;
    expect(a.licencia).toBe(LICENCIA_LIBRE);
    expect(a.ruta).toBe("assets/musica.ogg");
    expect(a.hash).toBe(b.hash);
    expect(musicaLibre("calm").map((s) => s.sha256)).toContain(a.hash);
  });
});
