import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { logoPermitido, portadaPermitida, revisarRutasPlantilla } from "@/lib/plantillas-rutas";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";

const datos = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-plantillas-"));

describe("rutas de la plantilla (SEG-02)", () => {
  it("el logo sólo vale dentro de <datos>/plantillas y como imagen", () => {
    expect(logoPermitido(path.join(datos, "plantillas", "canal", "logo-abc.png"), datos)).toBe(true);
    expect(logoPermitido(path.join(datos, "plantillas", "canal", "logo-abc.SVG"), datos)).toBe(true);
    expect(logoPermitido("/home/alguien/.ssh/id_rsa", datos)).toBe(false);
    expect(logoPermitido(path.join(datos, "claves", "redes.key"), datos)).toBe(false);
    expect(logoPermitido(path.join(datos, "plantillas", "..", "geeper.db"), datos)).toBe(false);
    expect(logoPermitido(path.join(datos, "plantillas", "canal", "redes.json"), datos)).toBe(false);
    expect(logoPermitido("plantillas/canal/logo.png", datos)).toBe(false);
  });

  it("el diseño de portada sólo vale dentro de <datos>/portadas/propias y como PSD", () => {
    expect(portadaPermitida(path.join(datos, "portadas", "propias", "canal-9x16-abc.psd"), datos)).toBe(true);
    expect(portadaPermitida(path.join(datos, "portadas", "propias", "x.png"), datos)).toBe(false);
    expect(portadaPermitida("/etc/passwd.psd", datos)).toBe(false);
  });

  it("revisarRutasPlantilla rechaza un logo de fuera y deja pasar uno subido", () => {
    const base = structuredClone(PLANTILLAS_INICIALES[0]!.datos);
    expect(() => revisarRutasPlantilla(base, datos)).not.toThrow();
    expect(() => revisarRutasPlantilla({ ...base, marca: { ...base.marca, logo: "/home/alguien/.ssh/id_rsa" } }, datos)).toThrow(/editor de la plantilla/);
    expect(() => revisarRutasPlantilla({ ...base, marca: { ...base.marca, logo: path.join(datos, "plantillas", "c", "logo.png") } }, datos)).not.toThrow();
    expect(() => revisarRutasPlantilla({ ...base, portada: { ...base.portada, plantillas: { "9:16": "/home/alguien/secreto.psd" } } }, datos)).toThrow(/portada/);
  });
});
