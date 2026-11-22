import { describe, expect, it } from "vitest";
import { Marco } from "@/lib/esquema";
import { metricas } from "@/lib/formatos";
import { cajaMarco } from "@/lib/marco";
import { mejorEsquina, puntajes, resolverMarco, type Zona } from "@/lib/marco-auto";

const m = metricas("9:16", { plataformas: ["tiktok"] });
const burbuja = Marco.parse({ forma: "redondeado", tamano: 0.34 });

/** Una cara del tamaño de una cara real en 9:16, centrada en (x, y) del cuadro. */
const cara = (x: number, y: number, peso = 1): Zona => ({ caja: { x: x - 110, y: y - 140, w: 220, h: 280 }, peso });

describe("burbuja del presentador en «auto»: la esquina que menos tapa las caras", () => {
  it("por defecto es «auto» y, sin caras, queda abajo a la derecha (lo de siempre)", () => {
    expect(Marco.parse({}).esquina).toBe("auto");
    expect(mejorEsquina(burbuja, m, [])).toBe("abajo-derecha");
  });

  it("una cara abajo a la derecha la manda a la izquierda; una cara arriba no la mueve de abajo", () => {
    expect(mejorEsquina(burbuja, m, [cara(700, 480)])).toBe("abajo-derecha");
    const zonas = [cara(720, 1100)];
    const e = mejorEsquina(burbuja, m, zonas);
    expect(e.endsWith("izquierda")).toBe(true);
    const b = cajaMarco({ ...burbuja, esquina: e }, m);
    const z = zonas[0]!.caja;
    // No se encima con la cara.
    expect(b.x + b.w <= z.x || b.x >= z.x + z.w || b.y + b.h <= z.y || b.y >= z.y + z.h).toBe(true);
  });

  it("pesa cada escena por lo que dura: manda la cara que más tiempo está", () => {
    const zonas = [cara(300, 800, 0.2), cara(800, 800, 0.8)];
    const pts = puntajes(burbuja, m, zonas);
    expect(pts["abajo-izquierda"]).toBeLessThan(pts["abajo-derecha"]);
    expect(mejorEsquina(burbuja, m, zonas).endsWith("izquierda")).toBe(true);
  });

  it("un recorte de cuerpo entero sólo va abajo, aunque arriba tape menos", () => {
    const recorte = { ...burbuja, forma: "recorte" } as unknown as Marco;
    const zonas = [cara(250, 820), cara(830, 820)];
    expect(mejorEsquina(recorte, m, zonas).startsWith("abajo")).toBe(true);
  });

  it("si en todas las esquinas tapa una cara, la achica lo justo (nunca menos que «Chica») y deja de tapar", () => {
    const grande = { ...burbuja, tamano: 0.45 };
    const zonas = [cara(540, 620), cara(540, 1100)];
    expect(Math.min(...Object.values(puntajes(grande, m, zonas)))).toBeGreaterThan(0.03);
    const r = resolverMarco(grande, m, zonas);
    expect(r.tamano).toBeLessThan(0.45);
    expect(r.tamano).toBeGreaterThanOrEqual(0.26);
    expect(puntajes(r, m, zonas)[r.esquina]).toBeLessThanOrEqual(0.03);
    // Si hay caras por todo el cuadro (ningún tamaño deja de tapar), queda el tamaño pedido.
    const llenas: Zona[] = [];
    for (let x = 100; x < 1080; x += 150) for (let y = 150; y < 1920; y += 150) llenas.push(cara(x, y));
    expect(resolverMarco(grande, m, llenas).tamano).toBe(0.45);
  });

  it("una esquina elegida a mano se respeta", () => {
    expect(resolverMarco({ ...burbuja, esquina: "arriba-izquierda" }, m, [cara(200, 400)]).esquina).toBe("arriba-izquierda");
    expect(resolverMarco(burbuja, m, [cara(830, 820)]).esquina).not.toBe("auto");
  });
});
