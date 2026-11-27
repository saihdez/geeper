import { describe, expect, it } from "vitest";
import {
  acentoDe,
  aSalida,
  componerDemo,
  elegirCta,
  fpsDominante,
  gradienteMarca,
  leerRgb,
  medidas,
  planDemo,
  puntuarCta,
  rangosZoomPorClics,
  type Candidato,
  type RegistroDemo,
} from "@/lib/demo-web";

const pagina = { url: "https://producto.com/", altoVentana: 800 };
const boton = (texto: string, href: string | null, extra: Partial<Candidato> = {}): Candidato => ({
  texto,
  href,
  relleno: true,
  fondo: "rgb(90, 60, 220)",
  caja: { x: 500, y: 400, width: 180, height: 48 },
  ...extra,
});

function registro(extra: Partial<RegistroDemo> = {}): RegistroDemo {
  return {
    url: "https://producto.com/",
    titulo: "Producto",
    historia: "clic",
    formato: "16:9",
    cta: "Cómo funciona",
    acento: [90, 60, 220],
    fondoPagina: [255, 255, 255],
    eventos: [
      { nombre: "heroe", t: 0.1, x: 0.5, y: 0.3 },
      { nombre: "cta", t: 1.4, x: 0.45, y: 0.55 },
      { nombre: "clic", t: 2.9 },
      { nombre: "listo", t: 5.2 },
      { nombre: "pagina2", t: 5.2, x: 0.4, y: 0.2 },
      { nombre: "scroll2", t: 7.2 },
      { nombre: "fin", t: 11.5 },
    ],
    cursor: [
      { t: 0, x: 0.55, y: 0.45 },
      { t: 2.5, x: 0.45, y: 0.55 },
      { t: 6, x: 0.55, y: 0.5 },
    ],
    clics: [2.9],
    duracion: 11.6,
    ancho: 1920,
    alto: 1200,
    ...extra,
  };
}

describe("demo web (ideas de cap-demo)", () => {
  it("prefiere el botón que lleva a contenido sobre el de registro", () => {
    const cands = [boton("Prueba gratis", "https://producto.com/registro"), boton("Cómo funciona", "https://producto.com/como-funciona")];
    expect(elegirCta(cands, pagina)?.texto).toBe("Cómo funciona");
    expect(puntuarCta(boton("Iniciar sesión", "https://producto.com/login"), pagina)).toBeLessThan(5);
    // Un enlace al blog o a la misma página no abre la historia.
    expect(elegirCta([boton("Ver el blog", "https://producto.com/blog/hola")], pagina)).toBeNull();
    expect(elegirCta([boton("Ver más", "https://producto.com/")], pagina)).toBeNull();
  });

  it("arma el degradado de marca y lee colores CSS", () => {
    expect(leerRgb("rgba(0, 0, 0, 0)")).toBeNull();
    expect(leerRgb("rgb(12, 34, 56)")).toEqual([12, 34, 56]);
    const g = gradienteMarca([90, 60, 220], [255, 255, 255]);
    expect(g.desde).toMatch(/^#[0-9a-f]{6}$/);
    // Sin acento y con fondo claro: degradado claro.
    const claro = gradienteMarca(null, [250, 248, 255]);
    expect(parseInt(claro.desde.slice(1, 3), 16)).toBeGreaterThan(200);
    expect(gradienteMarca(null, null)).toEqual({ desde: "#26283a", hasta: "#10111a" });
    // Un botón blanco o negro no es color de marca; uno violeta sí.
    const rel = (fondo: string) => ({ relleno: true, fondo });
    expect(acentoDe([rel("rgb(255, 255, 255)"), rel("rgb(17, 17, 17)"), rel("rgb(90, 60, 220)")])).toEqual([90, 60, 220]);
    expect(acentoDe([rel("rgb(255, 255, 255)")])).toBeNull();
  });

  it("zoom por clics con las reglas de auto_zoom de Cap", () => {
    expect(rangosZoomPorClics([2], 10)).toEqual([[1.7, 4.5]]);
    // Dos clics a menos de 2,5 s se juntan; los del último segundo se ignoran; el final queda 0,8 s antes.
    expect(rangosZoomPorClics([2, 5, 9.5], 10)).toEqual([[1.7, 7.5]]);
    expect(rangosZoomPorClics([8], 10)).toEqual([[7.7, 9.2]]);
    expect(rangosZoomPorClics([1], 0)).toEqual([]);
  });

  it("fps reales: la moda, no la media", () => {
    const t = [0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 1.5, 1.5 + 1 / 30];
    expect(fpsDominante(t)).toBe(30);
    expect(fpsDominante([0])).toBeNull();
  });

  it("corta en la acción, quita la carga y no pasa del máximo", () => {
    const m = planDemo(registro(), "3d", 12);
    expect(m.cortes[0]).toEqual([0.25, 3.3]);
    expect(m.cortes[1]![0]).toBeCloseTo(5.5, 5);
    expect(m.total).toBeLessThanOrEqual(12);
    expect(m.tomas).toHaveLength(3);
    // Las tomas cubren todo el video sin huecos.
    expect(m.tomas[0]!.inicio).toBe(0);
    expect(m.tomas[2]!.fin).toBeCloseTo(m.total, 6);
    expect(m.tomas[1]!.fin).toBe(m.tomas[2]!.inicio);
    // Lo quitado (la carga) no existe en la salida.
    expect(aSalida(m.cortes, 4.5)).toBeNull();
    expect(aSalida(m.cortes, 6)).toBeCloseTo(3.05 + 0.5, 5);
    const corto = planDemo(registro(), "3d", 6);
    expect(corto.total).toBeCloseTo(6, 5);
    // Clic tardío: el primer tramo solo pasaría del máximo; se recorta su principio y se conserva el clic.
    const lento = registro({
      duracion: 30,
      eventos: [{ nombre: "clic", t: 20 }, { nombre: "listo", t: 22 }, { nombre: "fin", t: 29.9 }],
    });
    const ml = planDemo(lento, "3d", 12);
    expect(ml.total).toBeCloseTo(12, 5);
    expect(ml.cortes[0]![1]).toBeCloseTo(20.4, 5);
    for (const t of ml.tomas) expect(t.fin).toBeGreaterThan(t.inicio);
  });

  it("estilo plano: sin perspectiva y con zoom en el clic", () => {
    const m = planDemo(registro(), "plano");
    expect(m.tomas).toHaveLength(1);
    expect(m.zooms).toHaveLength(1);
    expect(m.zooms[0]!.mira).toEqual([0.45, 0.55]);
  });

  it("compone un Hyperframes válido: video temporizado dentro de un contenedor sin tiempo", () => {
    const r = registro();
    const html = componerDemo({ registro: r, montaje: planDemo(r), video: "assets/toma.mp4", fondo: gradienteMarca(r.acento, r.fondoPagina), gsap: "assets/gsap/dist/gsap.min.js" });
    expect(html).toContain('data-composition-id="main"');
    expect(html.match(/<video /g)).toHaveLength(2);
    expect(html).toMatch(/<div id="tarjeta">/);
    expect(html).not.toMatch(/id="tarjeta" class="clip"/);
    expect(html).toContain('window.__timelines["main"] = tl');
    expect(medidas({ formato: "9:16", ancho: 1030, alto: 2230 })).toMatchObject({ W: 1080, H: 1920 });
  });
});
