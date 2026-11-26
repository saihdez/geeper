import { describe, expect, it } from "vitest";
import { planearCamara3d } from "@/lib/camara3d";
import { INTENSIDADES_CAMARA3D, MOVIMIENTOS_CAMARA3D, movimientoAuto } from "@/lib/camara3d-catalogo";
import { DEPTH_ANYTHING } from "@/lib/profundidad";
import { escenasParaAnimar } from "@/lib/animar-escenas";
import { tiempoEstimado } from "@/lib/estilos-generacion";
import { proyectoDePrueba } from "./fixtures";

describe("movimiento automático", () => {
  it("va cambiando de escena a escena y con una cara se acerca o la rodea", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => movimientoAuto(i, false))).toEqual(["acercar", "lateral", "orbitar", "alejar", "subir", "acercar"]);
    expect([0, 1, 2].map((i) => movimientoAuto(i, true))).toEqual(["acercar", "orbitar", "acercar"]);
  });
  it("cada movimiento del catálogo tiene nombre y explicación", () => {
    for (const m of MOVIMIENTOS_CAMARA3D) expect(m.titulo && m.texto).toBeTruthy();
    expect(INTENSIDADES_CAMARA3D.map((x) => x.valor)).toEqual([0.7, 1, 1.35]);
  });
});

describe("plan de la cámara 3D", () => {
  it("dura lo que la escena; la primera cubre también la entrada en silencio", () => {
    const p = proyectoDePrueba();
    const plan = planearCamara3d(p, "e02");
    expect(plan).toMatchObject({ escena: "e02", numero: 2, movimiento: "lateral", intensidad: 1, conCara: false });
    expect(planearCamara3d(p, "1").largo).toBeGreaterThan(planearCamara3d(p, "2").largo);
  });
  it("respeta lo que elige la persona y sigue la cara si la hay", () => {
    const p = proyectoDePrueba();
    expect(planearCamara3d(p, "e01", { movimiento: "subir", intensidad: "marcada" })).toMatchObject({ movimiento: "subir", intensidad: 1.35 });
    p.assets["clip-02"]!.foco = { x: 0.5, y: 0.4, ancho: 0.2, confianza: 0.9, cobertura: 1, dispersion: 0, muestras: 10, modelo: "yunet-2023mar" };
    expect(planearCamara3d(p, "e02")).toMatchObject({ conCara: true, movimiento: "orbitar" });
  });
  it("no congela un video de verdad ni un dibujo", () => {
    const p = proyectoDePrueba();
    p.assets["clip-02"]!.source = "archivo";
    expect(() => planearCamara3d(p, "e02")).toThrow(/ya es un video/);
    p.assets["clip-03"] = { ...p.assets["clip-03"]!, tipo: "imagen", ruta: "assets/logo.svg", source: "archivo" };
    expect(() => planearCamara3d(p, "e03")).toThrow(/SVG/);
    expect(() => planearCamara3d(p, "e09")).toThrow(/No hay escena e09/);
  });
  it("después de la cámara 3D la escena ya no cuenta como foto de MPT por animar", () => {
    const p = proyectoDePrueba();
    expect(escenasParaAnimar(p).map((x) => x.numero)).toEqual([1, 2, 3]);
    p.assets["clip-02"]!.source = "archivo";
    expect(escenasParaAnimar(p).map((x) => x.numero)).toEqual([1, 3]);
  });
});

describe("modelo de profundidad y estilo Rápido", () => {
  it("el modelo está fijado a una revisión, con tamaño, SHA-256 y licencia libre", () => {
    expect(DEPTH_ANYTHING.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    expect(DEPTH_ANYTHING.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(DEPTH_ANYTHING.licencia).toMatch(/^Apache-2\.0/);
  });
  it("«Rápido» avisa que la cámara 3D suma medio minuto por escena", () => {
    expect(tiempoEstimado("rapido")).toMatch(/medio minuto por escena/);
  });
});
