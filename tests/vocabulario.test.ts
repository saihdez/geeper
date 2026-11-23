/** A11-06: una palabra por cosa en pantalla (glosario en src/lib/glosario.ts). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FORMAS, jergaEn, nombreForma, palabrasAEvitar, VOCABULARIO } from "@/lib/glosario";
import { textosDePantalla } from "./ayudas/textos-pantalla";

/**
 * Pantallas que todavía usan la jerga vieja porque son de otro grupo de trabajo (el cambio exacto está en
 * el informe de la auditoría, 7.8). Al pasarlas al vocabulario se quitan de aquí.
 */
const PENDIENTES = new Set(["src/components/editor-proyecto.tsx", "src/components/edicion-avanzada.tsx", "src/components/paleta.tsx"]);

function pantallas(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? pantallas(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("glosario de pantalla", () => {
  it("cada palabra a evitar tiene una sola palabra en su lugar", () => {
    const vistas = new Map<string, string>();
    for (const { palabra, usar } of palabrasAEvitar()) {
      const k = palabra.toLocaleLowerCase("es");
      expect(vistas.get(k) ?? usar, `«${palabra}» aparece en dos conceptos`).toBe(usar);
      vistas.set(k, usar);
      expect(jergaEn(usar), `«${usar}» no puede estar entre las que se evitan`).toEqual([]);
    }
    expect(Object.keys(VOCABULARIO).length).toBeGreaterThanOrEqual(20);
  });

  it("encuentra la jerga como palabra entera, sin mayúsculas", () => {
    expect(jergaEn("El QC marcó un aviso en este render").map((j) => j.palabra)).toEqual(["QC", "render"]);
    expect(jergaEn("Usa la tarjeta gráfica")).toEqual([{ palabra: "tarjeta gráfica", usar: "tarjeta de video" }]);
    expect(jergaEn("Estilos del canal · Plantillas · renderizando")).toEqual([]);
    expect(jergaEn("shorts-9x16").map((j) => j.palabra)).toEqual(["shorts-9x16"]);
  });

  it("nombra la forma del video igual desde el formato o desde el perfil del render", () => {
    expect(nombreForma("9:16")).toBe("vertical (9:16)");
    expect(nombreForma("shorts-9x16")).toBe("vertical (9:16)");
    expect(nombreForma("youtube-16x9")).toBe("horizontal (16:9)");
    expect(nombreForma("cuadrado-1x1")).toBe("cuadrado (1:1)");
    expect(nombreForma("4:5")).toBe("4:5");
    expect(Object.keys(FORMAS)).toEqual(["9:16", "16:9", "1:1"]);
  });
});

describe("las pantallas usan el vocabulario", () => {
  const raiz = process.cwd();
  const archivos = [...pantallas(path.join(raiz, "src/components")), ...pantallas(path.join(raiz, "src/app"))]
    .map((a) => path.relative(raiz, a).split(path.sep).join("/"))
    .filter((a) => !PENDIENTES.has(a));

  it("revisa de verdad las pantallas (Nuevo, demo web, publicar, cuentas…)", () => {
    for (const a of ["src/components/form-nuevo.tsx", "src/components/form-demo.tsx", "src/components/panel-publicar.tsx", "src/components/cuentas.tsx"]) expect(archivos).toContain(a);
    const nuevo = textosDePantalla(fs.readFileSync(path.join(raiz, "src/components/form-nuevo.tsx"), "utf8"));
    expect(nuevo).toEqual(expect.arrayContaining(["Forma del video", "Estilo del canal"]));
  });

  it.each(archivos)("%s no usa jerga en pantalla", (a) => {
    const jerga = textosDePantalla(fs.readFileSync(path.join(raiz, a), "utf8")).flatMap((t) => jergaEn(t).map((j) => `«${j.palabra}» → «${j.usar}» en: ${t.slice(0, 90)}`));
    expect(jerga).toEqual([]);
  });
});
