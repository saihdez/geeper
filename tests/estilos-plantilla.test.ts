import { describe, expect, it } from "vitest";
import { contrastePeor, textoSobre } from "@/lib/colores-marca";
import { aplicarEstilo, ESTILOS_PLANTILLA, FUENTES_ESTILOS } from "@/lib/estilos-plantilla";
import { DatosPlantilla, PLANTILLAS_INICIALES } from "@/lib/plantillas";

describe("estilos de partida de las plantillas", () => {
  it("tienen ids únicos y datos que valida el esquema", () => {
    expect(new Set(ESTILOS_PLANTILLA.map((e) => e.id)).size).toBe(ESTILOS_PLANTILLA.length);
    for (const e of ESTILOS_PLANTILLA) expect(() => DatosPlantilla.parse(aplicarEstilo(PLANTILLAS_INICIALES[0]!.datos, e))).not.toThrow();
  });

  // Los mismos cuatro textos que mide el editor (Legibilidad en editor-plantilla.tsx), con video claro u oscuro debajo.
  it.each(ESTILOS_PLANTILLA.map((e) => [e.id, e] as const))("%s se lee bien sobre cualquier video", (_id, e) => {
    const c = e.colores;
    expect(contrastePeor(c.tinta, c.fondoPastilla)!, "subtítulos").toBeGreaterThanOrEqual(4.5);
    expect(contrastePeor(c.activa, c.fondoPastilla)!, "palabra que suena").toBeGreaterThanOrEqual(4.5);
    expect(contrastePeor(textoSobre(c.acento1, c.tinta), c.acento1)!, "botón final").toBeGreaterThanOrEqual(4.5);
    expect(Math.min(contrastePeor(c.acento1, c.fondoCierre)!, contrastePeor(c.acento2, c.fondoCierre)!), "título final").toBeGreaterThanOrEqual(3);
  });

  it("la palabra que suena se distingue del resto del subtítulo", () => {
    for (const e of ESTILOS_PLANTILLA) expect(e.colores.activa.toLowerCase(), e.id).not.toBe(e.colores.tinta.toLowerCase());
  });

  it("aplicar un estilo sólo cambia colores y letra", () => {
    const base = PLANTILLAS_INICIALES[0]!.datos;
    const n = aplicarEstilo(base, ESTILOS_PLANTILLA[0]!);
    expect({ ...n, colores: base.colores, tipografia: base.tipografia }).toEqual(base);
    expect(n.colores).toEqual(ESTILOS_PLANTILLA[0]!.colores);
    expect(base.colores).toEqual(PLANTILLAS_INICIALES[0]!.datos.colores);
  });

  it("no usa el índigo por defecto de Tailwind (la señal típica de diseño hecho por IA)", () => {
    const indigo = ["#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#8b5cf6", "#7c3aed", "#a855f7"];
    for (const e of ESTILOS_PLANTILLA) for (const v of Object.values(e.colores)) expect(indigo, e.id).not.toContain(v.toLowerCase());
  });

  it("junta las letras sin repetir", () => {
    expect(new Set(FUENTES_ESTILOS).size).toBe(FUENTES_ESTILOS.length);
    expect(FUENTES_ESTILOS).toContain("Playfair Display");
  });
});
