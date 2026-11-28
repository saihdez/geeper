import path from "node:path";
import { describe, expect, it } from "vitest";
import { appEscritorio, programa } from "@/lib/craft-escritorio";
import { SISTEMA } from "@/lib/plataforma";
import { ESTUDIO } from "@/lib/rutas";

describe("apps Craft de escritorio", () => {
  it("sólo las que no tienen versión web se instalan como programa", () => {
    expect(appEscritorio("anicraft")?.nombre).toBe("AniCraft");
    expect(appEscritorio("photocraft")).toBeNull();
    // Craft Anything publica una versión web, pero sólo identifica archivos: en Media va el programa completo.
    expect(appEscritorio("craft-anything")?.nombre).toBe("Craft Anything");
  });

  it("Craft Anything: el programa y su CLI donde los trae la release (bin/ en Linux, raíz de la carpeta en Windows)", () => {
    const dir = path.join(ESTUDIO, "craft-anything-escritorio", "actual");
    expect(programa("craft-anything")).toBe(
      SISTEMA === "windows" ? path.join(dir, "craft-anything.exe") : SISTEMA === "linux" ? path.join(dir, "bin", "craft-anything") : path.join(dir, "craft-anything"),
    );
  });

  it("el programa con ventana está al lado de su CLI", () => {
    const dir = path.join(ESTUDIO, "anicraft-escritorio", "actual");
    expect(programa("anicraft")).toBe(SISTEMA === "windows" ? path.join(dir, "anicraft.exe") : SISTEMA === "linux" ? path.join(dir, "bin", "anicraft") : path.join(dir, "anicraft"));
  });
});
