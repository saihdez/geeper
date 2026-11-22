/** COD-08: ComfyUI y Wan2GP comparten el instalador (crearInstaladorPython) sin cambiar lo que hacen. */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comandosComfyui } from "@/lib/instalar-comfyui";
import { crearInstaladorPython, rutaRestricciones, type ConfigInstaladorPython, type EstadoPython } from "@/lib/instalar-python";
import { comandosWan2gp, FECHA_CORTE, TORCH } from "@/lib/instalar-wan2gp";

const PASOS = ["codigo", "python", "pytorch", "dependencias", "prueba"].map((id) => ({ id, nombre: id }));

async function preparar(extra: Partial<ConfigInstaladorPython> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-inst-py-"));
  const hecho = path.join(dir, "deps-hechas");
  const config: ConfigInstaladorPython = {
    clave: `__prueba_${Math.random().toString(36).slice(2)}`,
    pasos: PASOS,
    sinMac: "no en mac",
    falta: () => (existsSync(hecho) ? null : "falta"),
    ubicacion: () => ({ dir, python: "/no/importa" }),
    bajarCodigo: async (d, log) => {
      await fs.mkdir(path.join(d, "venv"), { recursive: true });
      log("código\nlisto");
    },
    // «uv» es node: cada paso escribe su marca.
    comandos: () => [
      { paso: "python", args: ["-e", "process.exit(1)"] },
      { paso: "pytorch", args: ["-e", `require("fs").writeFileSync(${JSON.stringify(path.join(dir, "torch"))}, "")`] },
      { paso: "dependencias", args: ["-e", `require("fs").writeFileSync(${JSON.stringify(hecho)}, "")`] },
    ],
    comprobar: () => ({
      python: async () => true,
      pytorch: async () => existsSync(path.join(dir, "torch")),
      dependencias: async () => existsSync(hecho),
    }),
    restricciones: TORCH,
    probar: async (_d, _p, log) => log("probado"),
    listo: "Listo.",
    uv: process.execPath,
    entorno: () => ({}),
    ...extra,
  };
  return { dir, config, inst: crearInstaladorPython<EstadoPython & { lineas?: number }>(config) };
}

describe("crearInstaladorPython", () => {
  it("salta lo que ya está, fija PyTorch antes de las dependencias y termina listo", async () => {
    const { dir, inst } = await preparar({ contarLineas: true });
    expect(inst.revisar().falta).toBe("falta");
    const e = inst.instalar();
    expect(e.corriendo).toBe(true);
    expect(inst.instalar()).toBe(e); // una a la vez
    const fin = await inst.esperar();
    expect(fin.error).toBeNull();
    expect(fin.corriendo).toBe(false);
    expect(fin.falta).toBeNull();
    expect(fin.pasos.map((p) => p.estado)).toEqual(["listo", "listo", "listo", "listo", "listo"]);
    expect(fin.registro).toContain("python: ya estaba.");
    expect(fin.registro.at(-1)).toBe("Listo.");
    expect(fin.lineas).toBe(fin.registro.length);
    expect(await fs.readFile(rutaRestricciones(dir), "utf8")).toBe(`${TORCH.join("\n")}\n`);
  });

  it("sin contar líneas, el estado no trae `lineas` (ComfyUI)", async () => {
    const { inst } = await preparar();
    expect("lineas" in (await inst.esperar())).toBe(false);
    inst.instalar();
    expect("lineas" in (await inst.esperar())).toBe(false);
  });

  it("si un paso instala pero no responde, ese paso queda en error con su mensaje", async () => {
    const { inst } = await preparar({ comprobar: () => ({ python: async () => true, pytorch: async () => false, dependencias: async () => true }) });
    inst.instalar();
    const fin = await inst.esperar();
    expect(fin.pasos.find((p) => p.id === "pytorch")!.estado).toBe("error");
    expect(fin.pasos.find((p) => p.id === "dependencias")!.estado).toBe("pendiente");
    expect(fin.error).toBe("Se instaló pero no responde; mira el registro.");
  });

  it("un error de la prueba final se guarda con su última línea", async () => {
    const { inst } = await preparar({ probar: async () => { throw new Error("Traceback\nPyTorch no ve la GPU."); } });
    inst.instalar();
    const fin = await inst.esperar();
    expect(fin.pasos.at(-1)!.estado).toBe("error");
    expect(fin.error).toBe("PyTorch no ve la GPU.");
    expect(fin.registro).toContain("Error: Traceback");
  });
});

describe("comandos de cada instalador (sin cambios)", () => {
  it("ComfyUI: Python 3.12 y dependencias sin fecha de corte", () => {
    const c = comandosComfyui("/h/C", "/h/C/venv/bin/python");
    expect(c[2]!.args).toEqual(["pip", "install", "--python", "/h/C/venv/bin/python", "-r", "/h/C/requirements.txt", "-c", "/h/C/venv/geeper-restricciones.txt"]);
  });
  it("Wan2GP: Python 3.11 y dependencias con fecha de corte", () => {
    const c = comandosWan2gp("/h/W", "/h/W/venv/bin/python");
    expect(c[0]!.args).toEqual(["venv", "--python", "3.11", "/h/W/venv"]);
    expect(c[2]!.args.slice(-2)).toEqual(["--exclude-newer", FECHA_CORTE]);
  });
});
