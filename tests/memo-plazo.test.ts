import { describe, expect, it, vi } from "vitest";
import { memoConPlazo } from "@/lib/memo-plazo";

describe("Sistema a demanda con caché de 60 s (WEB-03)", () => {
  it("dos pedidos a la vez corren una sola revisión", async () => {
    let soltar!: (v: number) => void;
    const fn = vi.fn(() => new Promise<number>((ok) => { soltar = ok; }));
    const m = memoConPlazo(fn, 60_000);
    const a = m();
    const b = m(true);
    soltar(7);
    expect((await a).valor).toBe(7);
    expect((await b).valor).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("dentro de los 60 s devuelve lo guardado; después, o con forzar, vuelve a revisar", async () => {
    let t = 1_000;
    let n = 0;
    const fn = vi.fn(async () => ++n);
    const m = memoConPlazo(fn, 60_000, () => t);
    expect((await m()).valor).toBe(1);
    t += 59_000;
    expect((await m()).valor).toBe(1);
    expect((await m(true)).valor).toBe(2);
    t += 60_000;
    expect((await m()).valor).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("un fallo no queda guardado", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(5);
    const m = memoConPlazo(fn as () => Promise<number>, 60_000);
    await expect(m()).rejects.toThrow("x");
    expect((await m()).valor).toBe(5);
  });
});
