import { describe, expect, it } from "vitest";
import { faltaDemo } from "@/components/form-demo";
import {
  enlaceCambiarLink,
  enlaceDeTrabajoDemo,
  ERROR_BLOQUEO,
  ERROR_EN_BLANCO,
  fondoDePlantilla,
  leerBorradorDemo,
  ofreceGrabacion,
  planDemo,
  registroDeGrabacion,
  revisarPagina,
} from "@/lib/demo-web";
import { recomendar } from "@/lib/recomendaciones";
import { proyectoDePrueba } from "./fixtures";

describe("demo con una grabación de pantalla propia", () => {
  it("se ofrece cuando la página bloquea al grabador o sale en blanco, no cuando no existe", () => {
    expect(ofreceGrabacion(revisarPagina({ estado: 403, texto: 900, medios: 3, rotas: 0 }).error)).toBe(true);
    expect(ofreceGrabacion(revisarPagina({ estado: 200, texto: 0, medios: 0, rotas: 0 }).error)).toBe(true);
    expect(ofreceGrabacion(revisarPagina({ estado: 404, texto: 900, medios: 3, rotas: 0 }).error)).toBe(false);
    expect(ofreceGrabacion(`Falló el paso: ${ERROR_BLOQUEO}`)).toBe(true);
    expect(ofreceGrabacion(ERROR_EN_BLANCO)).toBe(true);
    expect(ofreceGrabacion(null)).toBe(false);
  });

  it("el montaje sigue la grabación desde el principio, en orden, y dura lo que hace falta", () => {
    const objetivo = 11;
    const r = registroDeGrabacion({ duracion: 60, ancho: 1920, alto: 1080 }, { formato: "16:9", objetivo });
    const m = planDemo(r, "3d", objetivo);
    expect(m.cortes[0]![0]).toBeLessThan(0.5);
    expect(m.cortes[1]![0]).toBeGreaterThanOrEqual(m.cortes[0]![1]);
    expect(m.cortes[1]![0] - m.cortes[0]![1]).toBeLessThan(0.5);
    expect(m.total).toBeCloseTo(objetivo, 1);
    expect(r.cursor).toEqual([]);
  });

  it("una grabación corta se usa entera", () => {
    const r = registroDeGrabacion({ duracion: 8, ancho: 1080, alto: 1920 }, { formato: "9:16", objetivo: 12 });
    const m = planDemo(r, "plano", 12);
    expect(m.total).toBeGreaterThan(7);
    expect(m.total).toBeLessThanOrEqual(8);
  });

  it("el fondo sale del acento de la plantilla", () => {
    expect(fondoDePlantilla({ colores: { acento1: "#ff3d81" } })).not.toEqual(fondoDePlantilla({ colores: { acento1: "no es un color" } }));
  });

  it("«Usar una grabación mía» vuelve al formulario con lo escrito y la grabación elegida", () => {
    const enlace = enlaceDeTrabajoDemo({ url: "https://x.com", texto: "Hola, esto es mi tienda", estilo: "plano" }, { formato: "9:16", plantilla: "basica" }, "grabacion");
    const b = leerBorradorDemo(new URL(enlace, "http://geeper").searchParams);
    expect(b).toMatchObject({ url: "https://x.com", texto: "Hola, esto es mi tienda", estilo: "plano", fuente: "grabacion" });
    expect(leerBorradorDemo(new URL(enlaceCambiarLink({ url: "https://x.com" }), "http://geeper").searchParams).fuente).toBeUndefined();
    // Un trabajo que ya era con grabación vuelve en ese modo aunque sea con «Cambiar el link».
    expect(enlaceDeTrabajoDemo({ grabacion: "/datos/_subidos/a.mp4", texto: "hola" }, null)).toContain("fuente=grabacion");
  });

  it("con grabación falta el video, y el link es opcional", () => {
    expect(faltaDemo({ url: "", linkOk: false, largo: 10, plantilla: "a", fuente: "grabacion", archivo: false })).toEqual(["la grabación de tu pantalla"]);
    expect(faltaDemo({ url: "", linkOk: false, largo: 10, plantilla: "a", fuente: "grabacion", archivo: true })).toEqual([]);
    expect(faltaDemo({ url: "hola", linkOk: false, largo: 10, plantilla: "a", fuente: "grabacion", archivo: true })).toEqual(["un link completo"]);
  });
});

describe("aviso de imágenes rotas en «Lo siguiente»", () => {
  it("aparece cuando la demo de la página tuvo imágenes que no cargaron", () => {
    const p = structuredClone(proyectoDePrueba());
    const primero = Object.values(p.assets).find((a) => a.tipo === "video")!;
    primero.regenerar = { origen: "demo-web", url: "https://x.com", imagenesRotas: 2 };
    const rec = recomendar({ p, versionActual: 1, tarjeta: 2.8 }).find((r) => r.id === "demo-imagenes-rotas");
    expect(rec?.titulo).toBe("2 imágenes de tu página no cargaron");
    expect(rec?.porque).not.toMatch(/asset|http|\d{3}/i);
    expect(recomendar({ p: proyectoDePrueba(), versionActual: 1, tarjeta: 2.8 }).some((r) => r.id === "demo-imagenes-rotas")).toBe(false);
  });
});
