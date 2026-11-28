import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const flujo = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "escritorio.yml"), "utf8");

describe("CI de los instaladores (ESC-08)", () => {
  it("sigue armando en ramas de integración y etiquetas", () => {
    expect(flujo).toMatch(/branches: \["integracion\/\*\*"\]/);
    expect(flujo).toMatch(/tags: \["v\*"\]/);
  });
  it("cancela la corrida vieja de la misma rama y guarda los instaladores pocos días", () => {
    // Las etiquetas (releases) no se cancelan nunca.
    expect(flujo).toMatch(/concurrency:\s*\n\s+group: escritorio-\$\{\{ github\.ref \}\}\s*\n(\s*#[^\n]*\n)?\s+cancel-in-progress: \$\{\{ !startsWith\(github\.ref, 'refs\/tags\/'\) \}\}/);
    expect(flujo).toMatch(/retention-days: 2/);
  });
  it("sólo los jobs que publican pueden escribir en el repo; el que compila, no", () => {
    expect(flujo.match(/contents: write/g)).toHaveLength(2);
    expect(flujo).toMatch(/permissions:\s*\n\s+contents: read/);
    const compila = flujo.slice(flujo.indexOf("  instalador:"), flujo.indexOf("  integracion:"));
    expect(compila).not.toMatch(/contents: write|permissions:/);
    // El artefacto de paso hacia la release «integracion» se borra al publicar (cuota de 500 MB).
    expect(flujo).toMatch(/gh api -X DELETE "repos\/\$\{\{ github\.repository \}\}\/actions\/artifacts\/\$id"/);
  });
});

describe("instalador (ESC-06)", () => {
  const raiz = path.join(__dirname, "..", "escritorio");
  const config = fs.readFileSync(path.join(raiz, "electron-builder.yml"), "utf8");
  it("Windows instala en un solo paso, por usuario, sin preguntar carpeta", () => {
    expect(config).toMatch(/oneClick: true/);
    expect(config).toMatch(/perMachine: false/);
    expect(config).not.toMatch(/allowToChangeInstallationDirectory/);
  });
  it("lleva icono propio: un PNG de 1024 px en la carpeta de recursos del build", () => {
    expect(config).toMatch(/buildResources: \.\.\/escritorio\/recursos-build/);
    const png = fs.readFileSync(path.join(raiz, "recursos-build", "icon.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024]);
  });
});

describe("CI corre las pruebas de la carcasa y del empaquetado (ESC-12)", () => {
  const flujo = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "escritorio.yml"), "utf8");
  it.each(["escritorio-carcasa", "escritorio-armado", "escritorio-vigia", "escritorio-probar-app"])("%s", (nombre) => {
    expect(flujo).toContain(`tests/${nombre}.test.ts`);
    expect(fs.existsSync(path.join(__dirname, `${nombre}.test.ts`))).toBe(true);
  });
});
