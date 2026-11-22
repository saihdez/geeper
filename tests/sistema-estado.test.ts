/** A11-13 y A11-12: los estados de Sistema se dicen en palabras y «cargando» se anuncia. */
import { describe, expect, it } from "vitest";
import { estadoChequeo } from "@/components/sistema";

describe("estado de un chequeo", () => {
  it("lleva texto además del signo, y cada estado su signo", () => {
    expect(estadoChequeo({ ok: true })).toMatchObject({ signo: "✓", texto: "Listo" });
    expect(estadoChequeo({ ok: false, aviso: true })).toMatchObject({ signo: "!", texto: "Con aviso" });
    expect(estadoChequeo({ ok: false })).toMatchObject({ signo: "✗", texto: "Falta o falla" });
  });
});
