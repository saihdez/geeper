/** WEB-10 (resto): el editor ya no pide /api/trabajos cada 2 s en reposo. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { falloReciente, verTrabajos } from "@/components/editor-estado";
import { Plegable } from "@/components/plegable";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("lista de trabajos del editor (WEB-10)", () => {
  it("en reposo y sin abrirla: no se monta (antes, 30 peticiones por minuto)", () => {
    expect(verTrabajos(null, false, false)).toBe(false);
  });
  it("con algo en marcha o mientras se crea el proyecto: se abre sola", () => {
    expect(verTrabajos(null, true, false)).toBe(true);
    expect(verTrabajos(null, false, true)).toBe(true);
  });
  it("si el último trabajo acaba de fallar, se abre sola para ver su registro (y no se queda pidiendo)", () => {
    const ahora = Date.parse("2026-11-22T12:00:00Z");
    const fallo = (estado: string, terminado: string) => [{ id: "a", tipo: "voz.regenerar", estado, terminado }];
    expect(falloReciente(fallo("fallido", "2026-11-22T11:58:00Z"), ahora)).toBe(true);
    expect(falloReciente(fallo("interrumpido", "2026-11-22T11:55:00Z"), ahora)).toBe(true);
    expect(falloReciente(fallo("fallido", "2026-11-22T11:00:00Z"), ahora)).toBe(false);
    expect(falloReciente(fallo("cancelado", "2026-11-22T11:59:00Z"), ahora)).toBe(false);
    expect(falloReciente(fallo("hecho", "2026-11-22T11:59:00Z"), ahora)).toBe(false);
    expect(verTrabajos(null, false, false, true)).toBe(true);
    expect(verTrabajos(false, false, false, true)).toBe(false);
    expect(editor).toContain("falloReciente(fila.trabajos)");
  });
  it("lo que elija la persona manda", () => {
    expect(verTrabajos(true, false, false)).toBe(true);
    expect(verTrabajos(false, true, false)).toBe(false);
  });
  it("plegada no monta lo de adentro", () => {
    const Hijo = () => createElement("p", null, "ADENTRO");
    expect(renderToStaticMarkup(createElement(Plegable, { titulo: "T", abierto: false }, createElement(Hijo)))).not.toContain("ADENTRO");
    expect(renderToStaticMarkup(createElement(Plegable, { titulo: "T", abierto: true }, createElement(Hijo)))).toContain("ADENTRO");
  });
  it("la lista va dentro de la sección plegable", () => {
    expect(editor).toMatch(/<Plegable id="trabajos"[\s\S]*?<ListaTrabajos proyectoId=\{id\} \/>\s*<\/Plegable>/);
  });
});
