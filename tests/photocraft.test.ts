import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg, probar } from "@/lib/media";
import { avisosDe, capasDe, componer, leerCapas, planDatos, textoDesborda, type Capa } from "@/lib/photocraft";
import { escenasEnLinea } from "@/lib/linea";
import { medidasPortada, origenDeFotograma, pasosPlantillaBase } from "@/lib/portada";
import { proyectoDePrueba } from "./fixtures";
import { cli } from "@/lib/photocraft";
import { FFMPEG, PHOTOCRAFT_CLI } from "@/lib/rutas";
import { pruebasReales } from "./ayudas/reales";

// Recorte de `photocraft-cli info --compact` real (0.23.1), con un grupo.
const INFO = {
  width: 1280,
  height: 720,
  layers: [
    { id: 7, kind: "Group", name: "grupo", bounds: [10, 60, 200, 50], children: [{ id: 6, kind: "Type", name: "@marca", bounds: [10, 60, 200, 50], text: { sizePt: 32 } }] },
    { id: 5, kind: "Type", name: "@titulo", bounds: [63, 529, 904, 94], text: { sizePt: 96 } },
    { id: 4, kind: "Smart Object", name: "@foto", bounds: [0, 0, 640, 720] },
    { id: 3, kind: "Pixel", name: "@imagen", bounds: [0, 0, 1280, 720] },
    { id: 8, kind: "Fill", name: "@degradado", bounds: [0, 0, 1280, 720] },
    { id: 2, kind: "Pixel", name: "Background", bounds: [0, 0, 1280, 720] },
  ],
};

describe("plantillas de PhotoCraft", () => {
  it("aplana los grupos y lee tamaño y límites", () => {
    const c = capasDe(INFO);
    expect(c.map((x) => x.nombre)).toEqual(["grupo", "@marca", "@titulo", "@foto", "@imagen", "@degradado", "Background"]);
    expect(c.find((x) => x.id === 5)).toMatchObject({ clase: "Type", tamano: 96, limites: [63, 529, 904, 94] });
  });

  it("arma un plan según la clase de capa", () => {
    const plan = planDatos(capasDe(INFO), { titulo: "Hola", imagen: "/a/b.jpg", foto: "/a/c.jpg", degradado: false, sobra: "x" });
    expect(plan.pasos[0]).toEqual({ cmd: "layer.smartObjects.replaceContents", params: { layer: 4, path: "/a/c.jpg" } });
    const def = plan.pasos.find((p) => p.cmd === "image.variables.define")!.params.defs as Record<string, unknown>[];
    expect(def).toEqual([
      { name: "titulo", layer: 5, type: "textReplacement" },
      { name: "imagen", layer: 3, type: "pixelReplacement", method: "fill", align: "center", clip: true },
      { name: "degradado", layer: 8, type: "visibility" },
    ]);
    expect(plan.pasos.at(-1)).toEqual({ cmd: "image.applyDataSet", params: { index: 0 } });
    expect(plan.textos.map((t) => t.variable)).toEqual(["titulo"]);
    expect(plan.objetos.map((t) => t.variable)).toEqual(["foto"]);
    expect(plan.sinValor).toEqual(["marca"]);
    expect(plan.sinCapa).toEqual(["sobra"]);
  });

  it("rechaza lo que fallaría en silencio o en otro lado", () => {
    const capas = capasDe(INFO);
    expect(() => planDatos(capas, { imagen: "relativa.jpg" })).toThrow(/absoluta/);
    expect(() => planDatos(capas, { degradado: "texto" })).toThrow(/clase Fill/);
    const dup: Capa[] = [...capas, { id: 9, nombre: "@titulo", clase: "Type", limites: null }];
    expect(() => planDatos(dup, {})).toThrow(/dos capas/);
  });

  it("detecta el texto de párrafo que perdió líneas (offsets en caracteres)", () => {
    const caja = { Box: { width: 100, height: 50 } };
    expect(textoDesborda({ text: "ñandú volador", shape: caja, lines: [{ end: 6 }, { end: 13 }] })).toBe(false);
    expect(textoDesborda({ text: "ñandú volador", shape: caja, lines: [{ end: 6 }] })).toBe(true);
    expect(textoDesborda({ text: "ñandú", shape: "Point", lines: [] })).toBe(false);
    // Emojis fuera del BMP: 0.23.1 cuenta puntos de código (verificado: 57, no 68 unidades UTF-16).
    expect(textoDesborda({ text: "🔥 faro 🚢", shape: caja, lines: [{ end: 8 }] })).toBe(false); // así lo da 0.23.1
  });

  it("la imagen sale del clip limpio de la escena, no del render", () => {
    const p = proyectoDePrueba();
    const [e0, e1] = escenasEnLinea(p);
    const o = origenDeFotograma(p, e1!.inicio + 0.5);
    expect(o.ruta).toBe(p.assets[e1!.visual.asset]!.ruta);
    expect(o.segundo).toBeCloseTo(e1!.visual.rango.inicio + 0.5, 2);
    expect(origenDeFotograma(p, 0).ruta).toBe(p.assets[e0!.visual.asset]!.ruta); // la entrada en silencio cae en la primera
  });

  it("filtra los avisos esperables", () => {
    expect(avisosDe("warning: 5 layer(s) flattened; x\nwarning: lossy compression\nwarning: font family `Archivo Black` is not installed\n")).toEqual(["font family `Archivo Black` is not installed"]);
  });

  it("la plantilla base mide lo de cada formato y deja el título dentro del lienzo", () => {
    const d = { colores: { tinta: "#fff", activa: "#fff", acento1: "#f00", acento2: "#00f", fondoPastilla: "#000", fondoCierre: "#000" }, tipografia: { titulos: "Inter", texto: "Inter", pesoTexto: 800 }, marca: { texto: "M", logo: null } };
    for (const f of ["16:9", "9:16", "1:1"] as const) {
      const { nuevo, pasos } = pasosPlantillaBase(f, d, "/x/@imagen.png");
      expect([nuevo.width, nuevo.height]).toEqual([medidasPortada(f).ancho, medidasPortada(f).alto]);
      const [x, y, w, h] = pasos.find((p) => p.params.name === "@titulo")!.params.box as number[];
      expect(x! >= 0 && y! >= 0 && x! + w! <= medidasPortada(f).ancho && y! + h! <= medidasPortada(f).alto).toBe(true);
    }
  });
});

describe.skipIf(!pruebasReales || !existsSync(PHOTOCRAFT_CLI) || !existsSync(FFMPEG))("PhotoCraft real", () => {
  it("compone una portada: reemplaza imagen y texto y achica un título largo", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-pc-"));
    try {
      const hueco = path.join(dir, "@imagen.png");
      await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "color=c=0x333333:s=1280x720", "-frames:v", "1", hueco]);
      const foto = path.join(dir, "foto.png");
      await ffmpeg(["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920", "-frames:v", "1", foto]);
      const d = { colores: { tinta: "#ffffff", activa: "#fff", acento1: "#ffd400", acento2: "#00f", fondoPastilla: "#000", fondoCierre: "#000" }, tipografia: { titulos: "Inter", texto: "Inter", pesoTexto: 800 }, marca: { texto: "Dimerso", logo: null } };
      const { nuevo, pasos } = pasosPlantillaBase("16:9", d, hueco);
      const plantilla = path.join(dir, "base.psd");
      await cli(["run", "--new", JSON.stringify(nuevo), "--no-gpu", ...pasos.flatMap((p) => ["--cmd", p.cmd, "--params", JSON.stringify(p.params)]), "--out", plantilla]);
      const { capas } = await leerCapas(plantilla);
      expect(capas.filter((c) => c.nombre.startsWith("@")).map((c) => `${c.nombre}:${c.clase}`).sort()).toEqual(["@imagen:Pixel", "@marca:Type", "@titulo:Type"]);

      const salida = path.join(dir, "portada.jpg");
      const titulo = "Cinco trucos para que tu short no se caiga a los tres segundos y la gente se quede hasta el final";
      const r = await componer({ plantilla, valores: { titulo, imagen: foto, marca: "Dimerso" }, salida });
      expect(r.desbordan).toEqual([]);
      expect(r.achicados.titulo).toBeLessThan(84);
      const info = await probar(salida);
      expect([info.ancho, info.alto]).toEqual([1280, 720]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
