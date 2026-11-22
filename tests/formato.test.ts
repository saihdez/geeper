/** A11-11: números, duraciones y fechas se escriben de una sola forma. */
import { describe, expect, it } from "vitest";
import { fecha, haceCuanto, IDIOMA_FORMATO, numero, segundos } from "@/lib/formato";

describe("formato (A11-11)", () => {
  it("un solo signo decimal y de miles", () => {
    expect(IDIOMA_FORMATO).toBe("es-MX");
    expect(numero(1234)).toBe("1,234");
    expect(numero(12.34, 1)).toBe("12.3");
    expect(numero(3, 1)).toBe("3");
    expect(numero(Number.NaN)).toBe("—");
  });

  it("duraciones: decimal sólo en lo muy corto, y horas para lo largo", () => {
    expect(segundos(null)).toBe("—");
    expect(segundos(0.62)).toBe("0.6 s");
    expect(segundos(9.96)).toBe("10 s");
    expect(segundos(12.3)).toBe("12 s");
    expect(segundos(50.1)).toBe("50 s");
    expect(segundos(59.6)).toBe("1 min");
    expect(segundos(150)).toBe("2 min 30 s");
    expect(segundos(459)).toBe("7 min 39 s");
    expect(segundos(3600)).toBe("1 h");
    expect(segundos(12_000)).toBe("3 h 20 min");
  });

  it("la versión de comun.tsx es la misma", async () => {
    const comun = await import("@/components/comun");
    expect(comun.segundos(150)).toBe(segundos(150));
    expect(comun.segundos(4.25)).toBe("4.3 s");
  });

  it("fechas en el mismo idioma y «hace cuánto»", () => {
    const d = new Date(2026, 10, 21, 15, 28);
    expect(fecha(d)).toBe(d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }));
    expect(fecha("no es fecha")).toBe("—");
    const ahora = d.getTime();
    expect(haceCuanto(ahora - 20_000, ahora)).toBe("hace un momento");
    expect(haceCuanto(ahora - 5 * 60_000, ahora)).toBe("hace 5 min");
    expect(haceCuanto(ahora - 2 * 3_600_000, ahora)).toBe("hace 2 h");
    expect(haceCuanto(ahora - 30 * 3_600_000, ahora)).toMatch(/^ayer, /);
    expect(haceCuanto(ahora - 5 * 86_400_000, ahora)).toBe(fecha(ahora - 5 * 86_400_000));
  });
});
