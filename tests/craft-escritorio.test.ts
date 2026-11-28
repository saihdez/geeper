import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appEscritorio, prepararDatos, programa } from "@/lib/craft-escritorio";
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

  describe("datos fijos de Craft Anything (para no perder Ghidra, Java ni la configuración al actualizar)", () => {
    const armar = () => {
      const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-datos-"));
      const dirApp = path.join(raiz, "craft-anything-escritorio");
      const dirPrograma = path.join(dirApp, "0.6.1", "craft-anything-0.6.1-windows-x64-portable");
      return { raiz, dirApp, dirPrograma };
    };

    it("en Windows pasa los datos portables a la carpeta fija y da la variable", () => {
      const { raiz, dirApp, dirPrograma } = armar();
      try {
        fs.mkdirSync(path.join(dirPrograma, "CraftAnythingData", "engines"), { recursive: true });
        fs.writeFileSync(path.join(dirPrograma, "CraftAnythingData", "config.toml"), "deep_mode = true\n");
        const env = prepararDatos("craft-anything", { dirApp, dirPrograma, sistema: "windows" });
        const fija = path.join(dirApp, "datos");
        expect(env).toEqual({ CRAFT_ANYTHING_CONFIG_DIR: fija });
        expect(fs.readFileSync(path.join(fija, "config.toml"), "utf8")).toBe("deep_mode = true\n");
        expect(fs.existsSync(path.join(dirPrograma, "CraftAnythingData"))).toBe(false);
        // La segunda vez (u otra versión con su propia carpeta vacía) no pisa lo que ya está.
        fs.mkdirSync(path.join(dirPrograma, "CraftAnythingData"));
        prepararDatos("craft-anything", { dirApp, dirPrograma, sistema: "windows" });
        expect(fs.readFileSync(path.join(fija, "config.toml"), "utf8")).toBe("deep_mode = true\n");
      } finally {
        fs.rmSync(raiz, { recursive: true, force: true });
      }
    });

    it("si ya se actualizó, toma los datos de la versión anterior", () => {
      const { raiz, dirApp, dirPrograma } = armar();
      try {
        const vieja = path.join(dirApp, "0.5.0", "craft-anything-0.5.0-windows-x64-portable", "CraftAnythingData");
        fs.mkdirSync(vieja, { recursive: true });
        fs.writeFileSync(path.join(vieja, "config.toml"), "vieja\n");
        fs.mkdirSync(dirPrograma, { recursive: true });
        prepararDatos("craft-anything", { dirApp, dirPrograma, sistema: "windows" });
        expect(fs.readFileSync(path.join(dirApp, "datos", "config.toml"), "utf8")).toBe("vieja\n");
      } finally {
        fs.rmSync(raiz, { recursive: true, force: true });
      }
    });

    it("sin datos previos crea la carpeta vacía; fuera de Windows y en otras apps no hace nada", () => {
      const { raiz, dirApp, dirPrograma } = armar();
      try {
        expect(prepararDatos("craft-anything", { dirApp, dirPrograma, sistema: "windows" })).toEqual({ CRAFT_ANYTHING_CONFIG_DIR: path.join(dirApp, "datos") });
        expect(fs.existsSync(path.join(dirApp, "datos"))).toBe(true);
        expect(prepararDatos("craft-anything", { dirApp, dirPrograma, sistema: "linux" })).toEqual({});
        expect(prepararDatos("anicraft", { dirApp, dirPrograma, sistema: "windows" })).toEqual({});
      } finally {
        fs.rmSync(raiz, { recursive: true, force: true });
      }
    });
  });
});
