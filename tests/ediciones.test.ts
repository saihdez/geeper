import { describe, expect, it } from "vitest";
import { compilar } from "@/lib/compilador";
import { aplicarEdicion } from "@/lib/ediciones";
import { pista, validarProyecto } from "@/lib/esquema";
import { escenasEnLinea, todosLosGrupos } from "@/lib/linea";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { revisarSubtitulos } from "@/lib/qc";
import { proyectoDePrueba } from "./fixtures";

const plantilla = PLANTILLAS_INICIALES[0]!.datos;

describe("ediciones sin GPU", () => {
  it("mostrar cambia lo que se lee, no lo que se oye", () => {
    const p = proyectoDePrueba();
    const textos = todosLosGrupos(p).map((g) => g.texto).join(" ");
    expect(textos).toContain("GTA VI.");
    expect(textos).not.toContain("seis");
    expect(p.escenas.e01!.texto).toContain("GTA seis");
  });

  it("quitar una escena corre las siguientes y sus subtítulos", () => {
    const p = aplicarEdicion(proyectoDePrueba(), { tipo: "quitarEscena", escena: "e01" });
    const es = escenasEnLinea(p);
    expect(es.map((e) => e.escena.id)).toEqual(["e02", "e03"]);
    expect(es[0]!.inicio).toBeCloseTo(0.3); // tras la entrada en silencio
    const g = todosLosGrupos(p);
    expect(g[0]!.inicio).toBeCloseTo(0.3); // la palabra de 3.0 s en la voz cae al final de la entrada
    expect(g[0]!.texto.startsWith("Escena 2")).toBe(true);
  });

  it("reordenar mueve visual y voz juntos", () => {
    const p = aplicarEdicion(proyectoDePrueba(), { tipo: "moverEscena", escena: "e03", a: 0 });
    expect(pista(p, "voz").clips.map((c) => c.escena)).toEqual(["e03", "e01", "e02"]);
    expect(pista(p, "visual").clips.map((c) => c.escena)).toEqual(["e03", "e01", "e02"]);
    expect(todosLosGrupos(p)[0]!.texto.startsWith("Escena 3")).toBe(true);
  });

  it("corregir un subtítulo sólo toca lo mostrado", () => {
    const p = aplicarEdicion(proyectoDePrueba(), { tipo: "corregirSubtitulo", escena: "e02", desde: 0, hasta: 2, texto: "Segunda escena" });
    expect(todosLosGrupos(p).some((g) => g.texto.startsWith("Segunda escena"))).toBe(true);
    expect(p.escenas.e02!.palabras[0]!.texto).toBe("Escena");
  });

  it("corregir una palabra «revisada» (clips) la saca de las dudosas; sin la marca no toca la confianza", () => {
    const base = structuredClone(proyectoDePrueba());
    base.escenas.e02!.palabras[1] = { ...base.escenas.e02!.palabras[1]!, confianza: 0.4 };
    const sin = aplicarEdicion(base, { tipo: "corregirSubtitulo", escena: "e02", desde: 1, hasta: 2, texto: "escenas" });
    expect(sin.escenas.e02!.palabras[1]!.confianza).toBe(0.4);
    const con = aplicarEdicion(base, { tipo: "corregirSubtitulo", escena: "e02", desde: 1, hasta: 2, texto: "escenas", revisada: true });
    expect(con.escenas.e02!.palabras[1]!.confianza).toBe(1);
    expect(con.escenas.e02!.correcciones).toEqual([{ desde: 1, hasta: 2, texto: "escenas" }]);
  });

  it("rechaza un geeper.json inconsistente", () => {
    const p = structuredClone(proyectoDePrueba());
    pista(p, "visual").clips.pop();
    expect(() => validarProyecto(p)).toThrow(/mismo orden/);
  });

  it("compila los tres formatos con texto dentro de la banda segura", () => {
    for (const f of ["9:16", "16:9", "1:1"] as const) {
      const p = aplicarEdicion(proyectoDePrueba(), { tipo: "cambiarFormato", formato: f });
      const c = compilar(p, plantilla, "/tmp/mezcla.wav", "/tmp/p");
      expect(c.cajas.filter((x) => !x.dentro)).toEqual([]);
      expect(c.total).toBeCloseTo(0.3 + 9 + plantilla.tarjetaFinal.duracion);
      expect(c.html).toContain('data-start="0.000"'); // la primera escena cubre la entrada
      // Un clip de 9:16 en 16:9 se contiene sobre un fondo desenfocado.
      expect(c.html.includes("clip fondo desenfoque")).toBe(f !== "9:16"); // 9:16 en 16:9 o 1:1: contenido sobre fondo desenfocado
      expect(revisarSubtitulos(f, c.grupos, c.inicioTarjeta).peorLineas).toBeLessThanOrEqual(2);
    }
  });
});
