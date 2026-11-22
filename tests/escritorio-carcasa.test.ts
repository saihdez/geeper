import { describe, expect, it } from "vitest";
import { permitirReinicio } from "../escritorio/reglas";

describe("carcasa de escritorio: reinicios del worker (ESC-03)", () => {
  it("deja 5 reinicios en 10 minutos y el sexto no", () => {
    const h: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(permitirReinicio(h, t0 + i * 1000)).toBe(true);
    expect(permitirReinicio(h, t0 + 6000)).toBe(false);
    expect(h).toHaveLength(5);
  });
  it("los reinicios de hace más de 10 minutos ya no cuentan", () => {
    const h: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) permitirReinicio(h, t0 + i);
    expect(permitirReinicio(h, t0 + 10 * 60_000 + 10)).toBe(true);
    expect(h).toEqual([t0 + 10 * 60_000 + 10]);
  });
});
