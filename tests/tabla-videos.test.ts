import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { leerPedido } from "../src/lib/pedido-video";
import { celdas, EJEMPLO_CSV, leerTabla, MAX_FILAS, pareceTabla, separador } from "../src/lib/tabla-videos";

describe("leerTabla", () => {
  it("lee lo pegado desde Excel o Sheets (tabuladores) con fila de títulos en español", () => {
    const r = leerTabla("Tema\tTítulo\tGuion\tFinal\nFaros\tLos faros\t\tSíguenos\nHoteles raros\t\tHola, hoy…\t\n");
    expect(r.filas).toEqual([
      { tema: "Faros", titulo: "Los faros", cta: "Síguenos" },
      { tema: "Hoteles raros", guion: "Hola, hoy…" },
    ]);
    expect(r.avisos).toEqual([]);
  });

  it("lee un .csv de Excel en español (con «;», BOM y comillas) y el ejemplo que se descarga", () => {
    const r = leerTabla(`﻿tema;guion\r\n"Uno; con punto y coma";"Dijo ""hola""\r\ny siguió"\r\n`);
    expect(r.filas).toEqual([{ tema: "Uno; con punto y coma", guion: 'Dijo "hola"\r\ny siguió' }]);
    expect(leerTabla(EJEMPLO_CSV).filas).toHaveLength(2);
  });

  it("sin fila de títulos, las columnas van en orden: tema, título, guion, final", () => {
    expect(leerTabla("Faros,Los faros,,Síguenos").filas).toEqual([{ tema: "Faros", titulo: "Los faros", cta: "Síguenos" }]);
  });

  it("avisa de filas sin tema, frases finales largas y más de 50 videos", () => {
    const largas = leerTabla(`Tema\tFinal\n\tsin tema\nX\t${"a".repeat(80)}`);
    expect(largas.filas[0]!.cta).toHaveLength(60);
    expect(largas.avisos.join(" ")).toMatch(/fila 2 no tiene tema/);
    expect(largas.avisos.join(" ")).toMatch(/muy larga/);
    const muchas = leerTabla(Array.from({ length: 60 }, (_, i) => `Tema ${i}`).join("\n"));
    expect(muchas.filas).toHaveLength(MAX_FILAS);
    expect(muchas.avisos.join(" ")).toMatch(/primeros 50/);
  });
});

describe("pareceTabla", () => {
  it("un tema por línea no es tabla; con tabuladores o títulos conocidos, sí", () => {
    expect(pareceTabla("Por qué los faros, hoy\nOtro tema")).toBe(false);
    expect(pareceTabla("Faros\tLos faros")).toBe(true);
    expect(pareceTabla("Tema;Final\nFaros;Síguenos")).toBe(true);
  });
  it("elige el separador de la primera fila", () => {
    expect(separador("a;b\nc")).toBe(";");
    expect(celdas("a,b\n\nc,d", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("leerPedido", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-pedido-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  it("sin archivo o roto, vacío; con frase final, la devuelve", async () => {
    expect(await leerPedido(tmp)).toEqual({});
    fs.writeFileSync(path.join(tmp, "pedido.json"), "{roto");
    expect(await leerPedido(tmp)).toEqual({});
    fs.writeFileSync(path.join(tmp, "pedido.json"), JSON.stringify({ cta: "Síguenos" }));
    expect(await leerPedido(tmp)).toEqual({ cta: "Síguenos" });
  });
});
