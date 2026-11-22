import { describe, expect, it } from "vitest";
import { PRESETS, idEfecto } from "@/lib/efectos-sonido";
import { KOKORO_ES, TEXTO_MUESTRA, idDeVoz } from "@/lib/voces";
import { Voz } from "@/lib/esquema";

describe("voces", () => {
  it("el id de una voz sale del nombre, sin tildes ni signos", () => {
    expect(idDeVoz("Narradora cálida del canal", "3fa2")).toBe("narradora-calida-del-canal-3fa2");
    expect(idDeVoz("¡¡¡", "00aa")).toBe("voz-00aa");
    expect(idDeVoz("Narradora", "")).toMatch(/^narradora-?$/);
  });
  it("el esquema acepta una voz diseñada (motor voxcpm) y sigue aceptando las de antes", () => {
    expect(Voz.parse({ motor: "voxcpm", voz: "narradora-calida-3fa2" }).velocidad).toBe(1);
    expect(Voz.parse({ motor: "mpt", voz: "kokoro:ef_dora", velocidad: 0.85 }).idioma).toBe("es");
    expect(() => Voz.parse({ motor: "otro", voz: "x" })).toThrow();
  });
  it("las voces fijas son de Kokoro en español y la muestra cabe en una toma", () => {
    expect(KOKORO_ES.every((k) => /^e[fm]_/.test(k.voz))).toBe(true);
    expect(TEXTO_MUESTRA.length).toBeLessThan(220);
  });
});

describe("efectos de sonido", () => {
  it("el mismo pedido da el mismo archivo (no se vuelve a generar)", () => {
    expect(idEfecto("Whoosh ", 2)).toBe(idEfecto("whoosh", 2));
    expect(idEfecto("whoosh", 2)).not.toBe(idEfecto("whoosh", 3));
    expect(idEfecto("whoosh", 2)).toMatch(/^sfx-[0-9a-f]{12}$/);
  });
  it("los sonidos listos tienen ids únicos, descripción en inglés y duran lo que admite el modelo", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.segundos).toBeGreaterThanOrEqual(1);
      expect(p.segundos).toBeLessThanOrEqual(30);
      expect(p.prompt).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
