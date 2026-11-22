import { describe, expect, it } from "vitest";
import { Marco, type Proyecto } from "@/lib/esquema";
import { clipBurbuja, motivoParaGenerar, notaReubicar, reubicarPresentador } from "@/lib/presentador-ubicar";
import { MODELO_HABLAR, PISTA_PRESENTADOR } from "@/lib/presentador";
import { proyectoDePrueba } from "./fixtures";

const h = "a".repeat(64);

function conBurbuja(forma = "redondeado"): Proyecto {
  const p = proyectoDePrueba();
  p.assets["pres"] = { id: "pres", tipo: "video", ruta: "assets/pres.mp4", hash: h, source: "wan", licencia: "x", duracion: 18, ancho: 480, alto: 640, regenerar: { motor: MODELO_HABLAR, avatar: "sofia-1a2b" } } as Proyecto["assets"][string];
  p.pistas.push({ id: PISTA_PRESENTADOR, tipo: "video", clips: [{ id: "presentador-x", asset: "pres", rango: { inicio: 0, duracion: 18 }, inicio: 0, marco: Marco.parse({ forma, esquina: "abajo-derecha", tamano: 0.45 }) }] } as Proyecto["pistas"][number]);
  return p;
}

describe("mover el presentador sin generarlo otra vez", () => {
  it("cambia sólo el marco de la burbuja: el video del avatar, la voz y las escenas quedan iguales", () => {
    const p = conBurbuja();
    const n = reubicarPresentador(p, { esquina: "auto", tamano: 0.34 });
    expect(clipBurbuja(n)!.marco).toEqual({ forma: "redondeado", esquina: "auto", tamano: 0.34 });
    expect(clipBurbuja(n)!.asset).toBe("pres");
    expect(n.assets).toEqual(p.assets);
    expect(n.escenas).toEqual(p.escenas);
    // El original no cambia.
    expect(clipBurbuja(p)!.marco!.esquina).toBe("abajo-derecha");
  });

  it("círculo ↔ rectángulo también es al instante", () => {
    expect(motivoParaGenerar(conBurbuja("circulo"), { forma: "redondeado" })).toBeNull();
  });

  it("sin burbuja, o pasando a/desde «recorte», hay que generarlo", () => {
    expect(motivoParaGenerar(proyectoDePrueba(), { esquina: "auto" })).toMatch(/generarlo/);
    expect(() => reubicarPresentador(conBurbuja(), { forma: "recorte" } as unknown as Partial<Marco>)).toThrow(/recorte/);
  });

  it("la nota de la versión dice qué cambió", () => {
    const antes = Marco.parse({ forma: "redondeado", esquina: "abajo-derecha", tamano: 0.45 });
    expect(notaReubicar(antes, { ...antes, esquina: "auto", tamano: 0.39 })).toBe("Presentador movido sin regenerar: esquina automática, tamaño 39 %");
  });
});
