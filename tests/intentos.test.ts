/** UX-41: el texto del intento anterior para la lista de Trabajos. */
import { describe, expect, it } from "vitest";
import { textoIntentos } from "@/lib/intentos";

const t = (estado: string, segs: number | null) => ({
  estado,
  error: "x",
  iniciado: segs == null ? null : "2026-11-22T10:00:00.000Z",
  terminado: segs == null ? "2026-11-22T10:00:00.000Z" : new Date(Date.parse("2026-11-22T10:00:00.000Z") + segs * 1000).toISOString(),
});

describe("textoIntentos (UX-41)", () => {
  it("primer intento: nada", () => {
    expect(textoIntentos(null)).toBeNull();
    expect(textoIntentos([])).toBeNull();
  });

  it("dice el número de intento y cómo terminó el anterior", () => {
    expect(textoIntentos([t("fallido", 396)])).toBe("2.º intento (el 1.º falló a los 6 min 36 s)");
    expect(textoIntentos([t("fallido", 30), t("interrumpido", 75)])).toBe("3.º intento (el 2.º se cortó a los 1 min 15 s)");
    expect(textoIntentos([t("cancelado", null)])).toBe("2.º intento (el 1.º se canceló antes de empezar)");
  });
});
