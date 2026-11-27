/** Revisión medida de portadas: veredicto, contraste alrededor del título, esquina de la duración y recorte con cara. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg } from "@/lib/media";
import { ESTILOS_PORTADA, focoEstable, medidasPortada, pasosPlantillaBase } from "@/lib/portada";
import { contrasteAlrededor, filtroRecorte, medirContrasteTitulo, revisarPortada, ZONA_RELOJ, type Caja, type DatosRevision } from "@/lib/revisar-portada";

const plantilla = {
  colores: { tinta: "#ffffff", activa: "#fff", acento1: "#ffd400", acento2: "#00f", fondoPastilla: "#000", fondoCierre: "#000" },
  tipografia: { titulos: "Inter", texto: "Inter", pesoTexto: 800 },
  marca: { texto: "Canal", logo: null },
};

const base: DatosRevision = { formato: "16:9", ancho: 1280, alto: 720, titulo: "Probé 5 laptops baratas", caja: [60, 391, 1100, 200], tamano: 84, contraste: 8, desborda: false };

/** Imagen RGB de w×h con fondo `f` y un rectángulo «letra» de color `t` en el medio. */
function imagen(w: number, h: number, f: number[], t: number[], caja: [number, number, number, number]): Uint8Array {
  const pix = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dentro = x >= caja[0] && x < caja[0] + caja[2] && y >= caja[1] && y < caja[1] + caja[3];
      pix.set(dentro ? t : f, (y * w + x) * 3);
    }
  }
  return pix;
}

describe("revisarPortada", () => {
  it("una portada sin problemas queda lista y dice qué funciona", () => {
    const r = revisarPortada(base);
    expect(r.veredicto).toBe("lista");
    expect(r.avisos).toEqual([]);
    expect(r.bien.length).toBeGreaterThan(0);
    expect(r.medidas.letraChica).toBeCloseTo(11, 0); // 84 px a 168 de 1280
  });

  it("la letra achicada que no se lee en chico pide cambiarla, y eso va primero", () => {
    const r = revisarPortada({ ...base, titulo: "uno dos tres cuatro cinco seis siete ocho", tamano: 42 });
    expect(r.veredicto).toBe("cambiar");
    expect(r.avisos[0]!.id).toBe("letra-chica");
    expect(r.avisos[0]!.nivel).toBe("mal");
    expect(r.avisos.some((a) => a.id === "muchas-palabras")).toBe(true);
  });

  it("contraste: < 3 es malo, de 3 a 4,5 mejorable", () => {
    expect(revisarPortada({ ...base, contraste: 2.1 }).veredicto).toBe("cambiar");
    expect(revisarPortada({ ...base, contraste: 3.6 }).veredicto).toBe("mejorable");
    expect(revisarPortada({ ...base, contraste: null }).avisos).toEqual([]);
  });

  it("avisa si el título llega a la esquina de la duración (sólo 16:9) o pega al borde", () => {
    const esquina: Caja = [60, 500, 1200, 200];
    expect(revisarPortada({ ...base, caja: esquina }).avisos.map((a) => a.id)).toContain("reloj");
    expect(revisarPortada({ ...base, formato: "9:16", ancho: 1080, alto: 1920, caja: [80, 1500, 900, 300] }).avisos.map((a) => a.id)).not.toContain("reloj");
    expect(revisarPortada({ ...base, caja: [5, 391, 1100, 200] }).avisos.map((a) => a.id)).toContain("margen");
  });

  it("el título que no entra es un problema aunque lo demás esté bien", () => {
    const r = revisarPortada({ ...base, desborda: true });
    expect(r.veredicto).toBe("cambiar");
    expect(r.avisos[0]!.id).toBe("no-entra");
  });
});

describe("diseños base", () => {
  it("en 16:9 ningún estilo deja el título en la esquina de la duración", () => {
    const { ancho, alto } = medidasPortada("16:9");
    for (const estilo of Object.keys(ESTILOS_PORTADA) as (keyof typeof ESTILOS_PORTADA)[]) {
      const t = pasosPlantillaBase("16:9", plantilla, "/x/@imagen.png", estilo).pasos.find((p) => p.params.name === "@titulo")!.params;
      const r = revisarPortada({ ...base, ancho, alto, caja: t.box as Caja, tamano: t.size as number, contraste: null });
      expect(r.avisos.map((a) => a.id), estilo).not.toContain("reloj");
    }
  });

  it("el título centrado queda un poco arriba del centro (centro óptico)", () => {
    const { alto } = medidasPortada("16:9");
    const [, y, , h] = pasosPlantillaBase("16:9", plantilla, "/x/@imagen.png", "centro").pasos.find((p) => p.params.name === "@titulo")!.params.box as number[];
    expect(y! + h! / 2).toBeLessThan(alto / 2);
  });
});

describe("contraste alrededor del título", () => {
  it("blanco sobre negro da 21:1; blanco sobre gris claro, poco", () => {
    expect(contrasteAlrededor(imagen(80, 40, [0, 0, 0], [255, 255, 255], [30, 10, 20, 20]), 80, 40, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
    const claro = contrasteAlrededor(imagen(80, 40, [200, 200, 200], [255, 255, 255], [30, 10, 20, 20]), 80, 40, { r: 255, g: 255, b: 255 })!;
    expect(claro).toBeLessThan(3);
  });

  it("un fondo casi del color del título también cuenta como ilegible", () => {
    const c = contrasteAlrededor(imagen(80, 40, [235, 235, 235], [255, 255, 255], [30, 10, 20, 20]), 80, 40, { r: 255, g: 255, b: 255 })!;
    expect(c).toBeLessThan(1.3);
  });

  it("cuenta el peor pedazo: una mancha clara junto a la letra baja la medida", () => {
    const pix = imagen(80, 40, [0, 0, 0], [255, 255, 255], [30, 10, 20, 20]);
    // Mancha clara pegada a la derecha de la «letra».
    for (let y = 5; y < 35; y++) for (let x = 53; x < 60; x++) pix.set([210, 210, 210], (y * 80 + x) * 3);
    expect(contrasteAlrededor(pix, 80, 40, { r: 255, g: 255, b: 255 })!).toBeLessThan(2);
  });

  it("null si el título no aparece", () => {
    expect(contrasteAlrededor(imagen(20, 20, [0, 0, 0], [0, 0, 0], [0, 0, 1, 1]), 20, 20, { r: 255, g: 255, b: 255 })).toBeNull();
  });

  it("mide sobre una imagen real (ffmpeg, CPU)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-revision-"));
    try {
      const png = path.join(dir, "p.png");
      await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180", "-vf", "drawbox=x=100:y=60:w=80:h=40:color=white:t=fill", "-frames:v", "1", png]);
      const c = await medirContrasteTitulo(png, [80, 40, 140, 80], "#ffffff", 320, 180);
      expect(c!).toBeGreaterThan(15);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("recorte con la cara", () => {
  it("sin foco recorta al centro; con foco, centra la cara sin salirse", () => {
    expect(filtroRecorte(16, 9)).toBe("crop='min(iw,ih*16/9)':'min(ih,iw*9/16)'");
    const f = filtroRecorte(16, 9, { x: 0.8, y: 0.3 });
    expect(f).toContain("iw*0.8000-ow/2");
    expect(f).toContain("max(0,min(ih-oh,ih*0.3000-oh*0.4))");
  });

  it("sólo usa caras estables", () => {
    const foco = { x: 0.6, y: 0.4, ancho: 0.2, confianza: 0.9, cobertura: 0.9, dispersion: 0.05, muestras: 8, modelo: "yunet" };
    expect(focoEstable(foco)).toEqual({ x: 0.6, y: 0.4 });
    expect(focoEstable({ ...foco, cobertura: 0.3 })).toBeNull();
    expect(focoEstable({ ...foco, dispersion: 0.3 })).toBeNull();
    expect(focoEstable(undefined)).toBeNull();
  });

  it("la esquina de la duración es la de abajo a la derecha", () => {
    expect(ZONA_RELOJ.x).toBeGreaterThan(0.5);
    expect(ZONA_RELOJ.y).toBeGreaterThan(0.5);
  });
});
