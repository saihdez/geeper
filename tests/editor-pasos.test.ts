/** UX-08: el editor por pasos (arreglos baratos): índice fijo, siguiente paso y secciones plegadas. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PASOS_EDITOR, siguientePaso } from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");
const base = { creando: false, fallo: false, hayVideo: true, alDia: true, qc: "listo" as const, aprobado: true };

describe("pasos del editor (UX-08)", () => {
  it("las secciones van en el orden de los 4 pasos: ver, corregir, voz y estilo, crear y publicar", () => {
    const pos = PASOS_EDITOR.map((x) => editor.indexOf(`<section id="${x.id}"`));
    expect(pos.every((x) => x > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    // Las escenas (lo que más se usa) quedan antes de publicar, portada y otro editor.
    const escenas = editor.indexOf("<TarjetaEscena key=");
    expect(escenas).toBeGreaterThan(pos[1]!);
    for (const panel of ["<PanelPublicar", "<PanelPortada", "<PanelOtroEditor", "<PanelTraducir"]) expect(editor.indexOf(panel)).toBeGreaterThan(pos[3]!);
    // «¿Está listo?» va con la vista previa, en el paso 1.
    expect(editor.indexOf('id="listo"')).toBeGreaterThan(pos[0]!);
    expect(editor.indexOf('id="listo"')).toBeLessThan(pos[1]!);
  });

  it("hay un índice fijo arriba con los pasos y el siguiente paso", () => {
    expect(editor).toMatch(/<nav aria-label="Pasos del video" className="sticky top-0/);
    expect(editor).toContain("Siguiente paso:");
    expect(editor).toContain("href={paso.ir}");
  });

  it("lo que se usa poco va plegado (y plegado no pide datos)", () => {
    for (const panel of ["PanelAvanzado", "PanelPortada", "PanelTraducir", "PanelOtroEditor"]) {
      expect(editor).toMatch(new RegExp(`<Plegable [^>]*>\\s*<${panel} `));
    }
    expect(editor).toMatch(/<Plegable id="historial"[^>]*\s+abierto=\{historialAbierto\}/);
  });

  it("el siguiente paso depende de cómo está el video", () => {
    expect(siguientePaso({ ...base, creando: true }).ir).toBe("#paso-2");
    expect(siguientePaso({ ...base, fallo: true })).toEqual({ texto: "No se pudo crear el video. Arriba puedes volver a intentarlo.", ir: "#arriba" });
    expect(siguientePaso({ ...base, hayVideo: false, qc: null, aprobado: false }).ir).toBe("#paso-2");
    expect(siguientePaso({ ...base, alDia: false }).texto).toContain("créalo otra vez");
    expect(siguientePaso({ ...base, qc: "falta", aprobado: false })).toEqual({ texto: "Arregla lo que marca «¿Está listo para publicar?».", ir: "#listo" });
    expect(siguientePaso({ ...base, qc: null, aprobado: false }).ir).toBe("#arriba");
    expect(siguientePaso(base)).toEqual({ texto: "Tu video está listo: descárgalo o publícalo.", ir: "#paso-4" });
  });

  it("los saltos a una escena o a «¿Está listo?» no quedan tapados por el índice fijo", () => {
    expect(editor).toMatch(/id=\{`escena-\$\{e\.id\}`\} className="tarjeta flex scroll-mt-28/);
    expect(editor).toContain('id="listo" className="tarjeta scroll-mt-28');
    expect(fs.readFileSync(path.join(process.cwd(), "src", "components", "plegable.tsx"), "utf8")).toContain("scroll-mt-28");
  });
});
