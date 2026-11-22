/** A11-13 y A11-12: los estados de Sistema se dicen en palabras y «cargando» se anuncia. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Cargando } from "@/components/comun";
import { estadoChequeo } from "@/components/sistema";

describe("estado de un chequeo", () => {
  it("lleva texto además del signo, y cada estado su signo", () => {
    expect(estadoChequeo({ ok: true })).toMatchObject({ signo: "✓", texto: "Listo" });
    expect(estadoChequeo({ ok: false, aviso: true })).toMatchObject({ signo: "!", texto: "Con aviso" });
    expect(estadoChequeo({ ok: false })).toMatchObject({ signo: "✗", texto: "Falta o falla" });
  });

  it("Cargando se anuncia con role=status", () => {
    expect(renderToStaticMarkup(createElement(Cargando, null))).toBe('<p class="text-sm text-tenue" role="status">Cargando…</p>');
  });
});
