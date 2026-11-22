/** UX-10: el avance y el resultado del render se ven junto al botón, en palabras simples. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pasoRender, renderEnCurso } from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("avance del render junto al botón (UX-10)", () => {
  it("encuentra el render en curso y no otro trabajo", () => {
    const t = [
      { id: "v", tipo: "voz.regenerar", estado: "corriendo" },
      { id: "r2", tipo: "render.entregar", estado: "pendiente" },
      { id: "r1", tipo: "render.entregar", estado: "hecho" },
    ];
    expect(renderEnCurso(t)?.id).toBe("r2");
    expect(renderEnCurso(t.filter((x) => x.id !== "r2"))).toBeNull();
  });

  it("dice el paso sin jerga", () => {
    expect(pasoRender({ estado: "pendiente", etapa: "" })).toBe("esperando su turno");
    expect(pasoRender({ estado: "corriendo", etapa: "Renderizando" })).toMatch(/cuadro por cuadro/);
    expect(pasoRender({ estado: "corriendo", etapa: "hyperframes check" })).toBe("revisando las escenas");
    expect(pasoRender({ estado: "corriendo", etapa: "Control de calidad" })).toBe("revisando que esté listo para publicar");
    expect(pasoRender({ estado: "corriendo", etapa: "Esperando la GPU (la tiene: x)" })).toBe("esperando su turno");
  });

  it("la franja tiene barra, «Cancelar» con pregunta y el resultado al terminar", () => {
    expect(editor).toContain("Creando tu video: {pasoRender(enCurso)}");
    expect(editor).toContain('<Barra valor={enCurso.progreso ?? 0}');
    expect(editor).toMatch(/confirm\("¿Dejar de crear el video\?/);
    expect(editor).toContain("Tu video está listo.");
    expect(editor).toContain('href="#listo">Ver qué falta');
  });
});
