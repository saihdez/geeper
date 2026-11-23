/** REN-10 (parte 2): las letras de las plantillas vienen dentro de Geeper; el render no va a Google Fonts. */
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilar, escribirProyectoHf } from "@/lib/compilador";
import { dirFuentes, esFamiliaLocal, FAMILIAS_LOCALES, FUENTES_EN_PROYECTO, fuentesParaProyecto } from "@/lib/fuentes-letra";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { enlacesFuentes } from "@/lib/vista-previa";
import { proyectoDePrueba } from "./fixtures";

const GOOGLE = /fonts\.(googleapis|gstatic)\.com/;

describe("letras locales (REN-10)", () => {
  it("trae todas las familias que ofrece el editor de plantillas, cada una con su licencia OFL", () => {
    const fuente = readFileSync(path.join(process.cwd(), "src/components/editor-plantilla.tsx"), "utf8");
    const lista = /const FUENTES = \[([\s\S]*?)\];/.exec(fuente)?.[1] ?? "";
    const delEditor = [...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(delEditor.length).toBeGreaterThan(10);
    expect([...FAMILIAS_LOCALES].sort()).toEqual([...delEditor].sort());
    for (const f of FAMILIAS_LOCALES) {
      expect(esFamiliaLocal(f), f).toBe(true);
      const { archivos } = fuentesParaProyecto([f]);
      const carpeta = path.dirname(Object.values(archivos)[0]!);
      expect(readFileSync(path.join(carpeta, "OFL.txt"), "utf8"), f).toContain("SIL Open Font License, Version 1.1");
      for (const abs of Object.values(archivos)) expect(readFileSync(abs).subarray(0, 4).toString(), abs).toBe("wOF2");
    }
  });

  it.each(PLANTILLAS_INICIALES.map((p) => [p.slug, p.datos] as const))("el HTML de «%s» declara sus letras locales y no nombra a Google", (_slug, datos) => {
    const comp = compilar(proyectoDePrueba(), datos, "/tmp/m.wav", "/tmp/p");
    expect(comp.html).not.toMatch(GOOGLE);
    for (const f of [datos.tipografia.titulos, datos.tipografia.texto]) {
      expect(comp.html).toContain(`@font-face { font-family: "${f}"`);
    }
    const fuentes = Object.keys(comp.archivos).filter((k) => k.startsWith(`${FUENTES_EN_PROYECTO}/`));
    expect(fuentes.length).toBeGreaterThan(0);
    for (const k of fuentes) {
      expect(comp.html).toContain(`url("${k}")`);
      expect(comp.archivos[k]!.startsWith(dirFuentes())).toBe(true);
    }
    // «En vivo» agrega los enlaces de las familias que no son locales: con éstas, ninguno.
    expect(enlacesFuentes(datos.tipografia)).toBe("");
  });

  it("escribirProyectoHf deja los woff2 dentro del proyecto, junto al index.html", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-letras-"));
    const mezcla = path.join(dir, "m.wav");
    await fs.writeFile(mezcla, "");
    const comp = compilar(proyectoDePrueba(), PLANTILLAS_INICIALES[0]!.datos, mezcla, dir);
    const soloLetras = Object.fromEntries(Object.entries(comp.archivos).filter(([k]) => k.startsWith(FUENTES_EN_PROYECTO) || k === "assets/mezcla.wav"));
    await escribirProyectoHf(path.join(dir, "build"), { ...comp, archivos: soloLetras });
    const index = readFileSync(path.join(dir, "build", "index.html"), "utf8");
    const urls = [...index.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(existsSync(path.join(dir, "build", u)), u).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("una familia que Geeper no trae queda como antes: sin @font-face y, en «En vivo», enlazada a Google", () => {
    const datos = { ...PLANTILLAS_INICIALES[0]!.datos, tipografia: { titulos: "Comic Neue", texto: "Montserrat", pesoTexto: 800 } };
    const comp = compilar(proyectoDePrueba(), datos, "/tmp/m.wav", "/tmp/p");
    expect(comp.html).not.toContain('font-family: "Comic Neue"; font-style');
    expect(comp.html).toContain('@font-face { font-family: "Montserrat"');
    const enlaces = enlacesFuentes(datos.tipografia);
    expect(enlaces).toContain("family=Comic+Neue&amp;");
    expect(enlaces).not.toContain("Montserrat");
    expect(fuentesParaProyecto(["comic neue"]).locales).toEqual([]);
  });

  it("sin los archivos en el disco no declara nada (Hyperframes las busca como siempre)", () => {
    expect(fuentesParaProyecto(["Inter"], "/no/existe")).toEqual({ css: "", archivos: {}, locales: [] });
  });
});
