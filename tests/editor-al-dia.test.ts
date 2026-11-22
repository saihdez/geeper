/** UX-21: un video exportado sigue «al día» si la versión actual tiene el mismo contenido (mismo hash). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mismoContenido } from "@/components/editor-estado";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");

describe("al día por contenido (UX-21)", () => {
  const versiones = [{ numero: 18, hash: "aaa" }, { numero: 17, hash: "bbb" }, { numero: 16, hash: "aaa" }, { numero: 5, hash: null }];
  it("misma versión o mismo hash: al día", () => {
    expect(mismoContenido(versiones, 18, 18)).toBe(true);
    expect(mismoContenido(versiones, 16, 18)).toBe(true);
  });
  it("hash distinto o desconocido: con cambios", () => {
    expect(mismoContenido(versiones, 17, 18)).toBe(false);
    expect(mismoContenido(versiones, 5, 18)).toBe(false);
    expect(mismoContenido(versiones, 3, 18)).toBe(false);
  });
  it("el editor y la portada deciden con el hash, no con el número", () => {
    const ed = leer("editor-proyecto.tsx");
    expect(ed).not.toContain("render.versionNumero !== fila.versionActual");
    expect(ed).toContain("Con cambios sin exportar");
    expect(leer("panel-portada.tsx")).toContain("!alDia(e.elegida.version)");
  });
});
