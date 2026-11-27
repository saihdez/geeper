import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  agregarEfectoLibre,
  animoDeCarpeta,
  animoSugerido,
  momentosSonidosSolos,
  musicaLibreActual,
  PISTA_SONIDOS_SOLOS,
  ponerMusicaLibre,
  ponerSonidosSolos,
  quitarMusica,
  quitarSonidosSolos,
  SIN_MUSICA,
  VOLUMEN_MUSICA,
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

describe("animoSugerido", () => {
  it("elige el ánimo por palabras del tema, sin importar acentos", () => {
    expect(animoSugerido("Los misterios sin resolver del Titanic")).toBe("dramatic");
    expect(animoSugerido("Cómo invertir tu dinero en 2027")).toBe("corporate");
    expect(animoSugerido("Meditación para dormir mejor")).toBe("calm");
    expect(animoSugerido("Lo que se sabe de GTA VI")).toBe("cinematic");
    expect(animoSugerido("Recetas fáciles con huevo")).toBe("upbeat");
  });
});

describe("elegirMusica cuando el estilo no trae música", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-musica-sola-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ctx = { dir: tmp, log: () => {} };
  fs.mkdirSync(path.join(tmp, "assets"), { recursive: true });

  it("sin carpeta, o con una carpeta que no existe, usa música libre del ánimo del tema", async () => {
    for (const carpeta of [null, path.join(tmp, "no-existe")]) {
      const a = (await elegirMusica(ctx, "p-2", { volumen: 0.12, ducking: true, carpeta, licencia: "sin música" }, "El misterio del triángulo de las Bermudas"))!;
      expect(a.licencia).toBe(LICENCIA_LIBRE);
      expect(musicaLibre("dramatic").map((s) => s.sha256)).toContain(a.hash);
    }
  });

  it("«ninguna» respeta que el estilo no lleve música", async () => {
    expect(await elegirMusica(ctx, "p-2", { volumen: 0.12, ducking: true, carpeta: SIN_MUSICA, licencia: "sin música" }, "x")).toBeNull();
  });
});

describe("cambiar la música del proyecto", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-poner-musica-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("pone una canción libre, conserva el volumen y borra los pulsos de la anterior; quitarla deja el video sin música", async () => {
    const base = proyectoDePrueba();
    base.marcadores.push({ id: "pulso-1", tiempo: 1, nombre: "pulso", tipo: "pulso" }, { id: "n1", tiempo: 2, nombre: "nota", tipo: "nota" });
    const s = sonidoLibre("still-water")!;
    const p = await ponerMusicaLibre(tmp, base, s);
    expect(musicaLibreActual(p)?.id).toBe("still-water");
    expect(p.pistas.find((x) => x.id === "musica")!.clips).toHaveLength(1);
    expect(p.pistas.find((x) => x.id === "musica")!.clips[0]!.volumen).toBe(VOLUMEN_MUSICA);
    const otra = await ponerMusicaLibre(tmp, { ...p, marcadores: [...p.marcadores, { id: "pulso-2", tiempo: 3, nombre: "pulso", tipo: "pulso" }] }, sonidoLibre("dark-pulse")!);
    expect(musicaLibreActual(otra)?.id).toBe("dark-pulse");
    expect(otra.marcadores.map((m) => m.id)).toEqual(["n1"]);
    const sin = quitarMusica(otra);
    expect(sin.pistas.some((x) => x.id === "musica")).toBe(false);
    expect(sin.assets.musica).toBeUndefined();
    await expect(ponerMusicaLibre(tmp, base, sonidoLibre("pop-small")!)).rejects.toThrow(/efecto/);
  });
});

describe("Poner sonidos solos", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-sonidos-solos-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("un whoosh antes de cada cambio de escena y un pop en cada texto, sin dos a menos de medio segundo", () => {
    const p = proyectoDePrueba();
    p.textos.push({ id: "t1", texto: "Hola", inicio: 1, duracion: 2, estilo: "titulo", posicion: "arriba" });
    p.textos.push({ id: "t2", texto: "Pegado", inicio: 3.2, duracion: 2, estilo: "rotulo", posicion: "arriba" });
    const m = momentosSonidosSolos(p);
    // Escenas de 3 s desde 0,3: cambios en 3,3 y 6,3 → whoosh en 3,05 y 6,05; el pop de 3,2 se pisa con el primero.
    expect(m.map((x) => [x.id, Number(x.inicio.toFixed(2))])).toEqual([["pop-small", 1], ["whoosh-soft", 3.05], ["whoosh-soft", 6.05]]);
  });

  it("los pone en su propia pista, volver a ponerlos no los duplica y quitarlos no toca los elegidos a mano", async () => {
    let p = await agregarEfectoLibre(tmp, proyectoDePrueba(), sonidoLibre("boom")!, 1);
    const r = await ponerSonidosSolos(tmp, p);
    expect(r.puestos).toBe(2);
    const otra = await ponerSonidosSolos(tmp, r.p);
    expect(otra.p.pistas.find((x) => x.id === PISTA_SONIDOS_SOLOS)!.clips).toHaveLength(2);
    p = quitarSonidosSolos(otra.p);
    expect(p.pistas.some((x) => x.id === PISTA_SONIDOS_SOLOS)).toBe(false);
    expect(p.pistas.find((x) => x.id === PISTA_EFECTOS)!.clips).toHaveLength(1);
  });
});
