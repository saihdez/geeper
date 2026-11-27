/** REN-10: el render, el check y «En vivo» no bajan GSAP de internet: usan la copia de node_modules. */
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilar, escribirProyectoHf } from "@/lib/compilador";
import { componerDemo, gradienteMarca, planDemo, type RegistroDemo } from "@/lib/demo-web";
import { GSAP_CDN, GSAP_EN_PROYECTO, gsapParaProyecto, rutaGsap, VERSION_GSAP } from "@/lib/gsap-local";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { proyectoDePrueba } from "./fixtures";

const plantilla = PLANTILLAS_INICIALES[0]!.datos;

describe("GSAP local", () => {
  it("la dependencia está fijada en la misma versión que pedía el CDN", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.gsap).toBe(VERSION_GSAP);
    const local = rutaGsap();
    expect(local).toBeDefined();
    expect(readFileSync(local!, "utf8").slice(0, 200)).toContain(`GSAP ${VERSION_GSAP}`);
  });

  it("el HTML del render enlaza la copia local y la lleva entre sus archivos", () => {
    const comp = compilar(proyectoDePrueba(), plantilla, "/tmp/m.wav", "/tmp/p");
    expect(comp.html).toContain(`<script src="${GSAP_EN_PROYECTO}"></script>`);
    expect(comp.html).not.toMatch(/<script[^>]+src="https?:/);
    expect(comp.archivos[GSAP_EN_PROYECTO]).toBe(rutaGsap());
  });

  it("escribirProyectoHf deja gsap.min.js dentro del proyecto (también sirve a «En vivo»)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-gsap-"));
    const mezcla = path.join(dir, "m.wav");
    await fs.writeFile(mezcla, "");
    const comp = compilar(proyectoDePrueba(), plantilla, mezcla, dir);
    const soloGsap = { ...comp, archivos: { "assets/mezcla.wav": mezcla, [GSAP_EN_PROYECTO]: comp.archivos[GSAP_EN_PROYECTO]! } };
    await escribirProyectoHf(path.join(dir, "build"), soloGsap);
    const copiado = path.join(dir, "build", GSAP_EN_PROYECTO);
    expect(existsSync(copiado)).toBe(true);
    expect(readFileSync(copiado, "utf8").slice(0, 200)).toContain(`GSAP ${VERSION_GSAP}`);
  });

  it("la demo de una página también usa la ruta local", () => {
    const r: RegistroDemo = {
      url: "https://ejemplo.com", titulo: "Ejemplo", historia: "scroll", formato: "16:9", cta: null, acento: null, fondoPagina: null,
      eventos: [{ nombre: "heroe", t: 0.5, x: 0.5, y: 0.3 }, { nombre: "fin", t: 9 }], cursor: [{ t: 0, x: 0.5, y: 0.5 }], clics: [], duracion: 10, ancho: 1920, alto: 1200,
    };
    const html = componerDemo({ registro: r, montaje: planDemo(r), video: "assets/toma.mp4", fondo: gradienteMarca(null, null), gsap: GSAP_EN_PROYECTO });
    expect(html).toContain(`<script src="${GSAP_EN_PROYECTO}"></script>`);
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  it("sin la copia local (instalación vieja) cae al CDN de siempre y no copia nada", () => {
    expect(gsapParaProyecto(path.join(os.tmpdir(), "no-hay-repo"))).toEqual({ src: GSAP_CDN, archivo: null });
  });

  it("ningún HTML generado vuelve a pedir GSAP al CDN a mano", () => {
    for (const f of ["compilador.ts", "demo-web.ts"]) {
      expect(readFileSync(path.join(process.cwd(), "src", "lib", f), "utf8")).not.toContain("cdn.jsdelivr.net");
    }
  });
});
