import { describe, expect, it } from "vitest";
import { leerCheck, NO_SE_PUDO_REVISAR } from "@/lib/render-check";
import { leerPulsos } from "@/lib/pulsos";

describe("WRK-12: salida de hyperframes check", () => {
  it("cuenta errores y avisos de un JSON válido", () => {
    const r = leerCheck(JSON.stringify({ ok: false, hallazgos: [{ severity: "error", code: "X1", message: "falta" }, { severity: "warning" }] }));
    expect(r).toEqual({ ok: false, errores: 1, avisos: 1, resumen: "X1: falta" });
    expect(leerCheck('{"ok":true}').ok).toBe(true);
  });

  it("lanza si la salida no es JSON, está vacía o cortada", () => {
    expect(() => leerCheck("")).toThrow(NO_SE_PUDO_REVISAR);
    expect(() => leerCheck("npm ERR! network")).toThrow(NO_SE_PUDO_REVISAR);
    expect(() => leerCheck('{"ok":true,"hallaz')).toThrow(NO_SE_PUDO_REVISAR);
  });

  it("lanza si falta `ok` o no es booleano", () => {
    expect(() => leerCheck("{}")).toThrow(NO_SE_PUDO_REVISAR);
    expect(() => leerCheck('{"ok":"true"}')).toThrow(NO_SE_PUDO_REVISAR);
    expect(() => leerCheck("[]")).toThrow(NO_SE_PUDO_REVISAR);
  });
});

describe("WRK-12: salida de hyperframes beats", () => {
  it("lee bpm y tiempos", () => {
    expect(leerPulsos('{"bpm":120,"beatTimes":[0.5,1,"x",null]}')).toEqual({ bpm: 120, tiempos: [0.5, 1] });
    expect(leerPulsos("{}")).toEqual({ bpm: null, tiempos: [] });
  });

  it("devuelve null (no se guarda) si no es JSON", () => {
    expect(leerPulsos("")).toBeNull();
    expect(leerPulsos("Error: sin red")).toBeNull();
  });
});
