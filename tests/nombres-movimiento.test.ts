/** UX-35: los movimientos de cámara se llaman igual en «Animar» y en «Mover la cámara». */
import { describe, expect, it } from "vitest";
import { NOMBRES } from "@/lib/prompt-camara";
import { MOVIMIENTOS } from "@/lib/rehacer";

describe("nombres de movimiento (UX-35)", () => {
  it("los paneos dicen «Hacia la derecha/izquierda» en los dos paneles", () => {
    expect(NOMBRES.movimiento["paneo-der"]).toBe("Hacia la derecha");
    expect(NOMBRES.movimiento["paneo-izq"]).toBe("Hacia la izquierda");
    for (const m of MOVIMIENTOS) if (m.vista === "paneo-der" || m.vista === "paneo-izq") expect(m.nombre).toBe(NOMBRES.movimiento[m.vista]);
    expect(MOVIMIENTOS.some((m) => m.nombre.startsWith("Girar a la"))).toBe(false);
  });
});
