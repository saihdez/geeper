import path from "node:path";
import { describe, expect, it } from "vitest";
import { pythonVoz } from "@/lib/rutas";
import { pythonDeVenv } from "@/lib/plataforma";

describe("Python de la voz Kokoro (TER-04)", () => {
  const estudio = path.join(path.sep, "herramientas");
  const propio = pythonDeVenv(path.join(estudio, "venvs", "voz"));
  const openMontage = path.join(estudio, "OpenMontage", ".venv", "bin", "python");

  it("la app de escritorio usa siempre el venv propio", () => {
    expect(pythonVoz(estudio, true, () => false)).toBe(propio);
  });

  it("en desarrollo usa el venv propio si existe", () => {
    expect(pythonVoz(estudio, false, (r) => r === propio)).toBe(propio);
  });

  it("en desarrollo, sin venv propio, sigue con el de OpenMontage", () => {
    expect(pythonVoz(estudio, false, () => false)).toBe(openMontage);
  });
});
