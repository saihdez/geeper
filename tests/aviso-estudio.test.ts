/** ESC-10: en un equipo nuevo la portada lleva a «Preparar el estudio». */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { faltanEnEstudio } from "@/components/aviso-estudio";

describe("aviso de la portada (ESC-10)", () => {
  it("cuenta lo que falta o falló sólo en la app de escritorio", () => {
    const pasos = [{ estado: "listo" }, { estado: "falta" }, { estado: "error" }, { estado: "aviso" }];
    expect(faltanEnEstudio({ disponible: true, corriendo: false, pasos })).toBe(2);
    expect(faltanEnEstudio({ disponible: false, corriendo: false, pasos })).toBe(0);
    expect(faltanEnEstudio(null)).toBe(0);
  });

  it("la portada muestra la tarjeta y lleva a la sección de Sistema", () => {
    const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");
    expect(leer("lista-proyectos.tsx")).toContain("<AvisoEstudio />");
    expect(leer("aviso-estudio.tsx")).toContain('href="/sistema#preparar-estudio"');
    expect(leer("preparar-estudio.tsx")).toContain('id="preparar-estudio"');
  });
});
