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
    expect(flujo).toMatch(/concurrency:\s*\n\s+group: escritorio-\$\{\{ github\.ref \}\}\s*\n\s+cancel-in-progress: true/);
    expect(flujo).toMatch(/retention-days: 5/);
  });
  it("sólo el paso de la release puede escribir en el repo", () => {
    expect(flujo.match(/contents: write/g)).toHaveLength(1);
    expect(flujo).toMatch(/permissions:\s*\n\s+contents: read/);
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
