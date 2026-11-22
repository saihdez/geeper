import { describe, expect, it } from "vitest";
import { comandosVoxcpm, FECHA_CORTE, INDICE_TORCH, MODELO_REVISION, RESTRICCIONES, scriptModelo } from "@/lib/instalar-voxcpm";

describe("instalador de VoxCPM2", () => {
  const cmds = comandosVoxcpm("/h/venvs/voxcpm", "/h/venvs/voxcpm/bin/python", "/h/r.txt");

  it("crea el venv, instala PyTorch con CUDA y después voxcpm con restricciones y fecha de corte", () => {
    expect(cmds.map((c) => c.paso)).toEqual(["python", "pytorch", "dependencias"]);
    expect(cmds[1]!.args).toContain(INDICE_TORCH);
    const deps = cmds[2]!.args;
    expect(deps).toContain("voxcpm==2.0.3");
    expect(deps.slice(deps.indexOf("-c"), deps.indexOf("-c") + 2)).toEqual(["-c", "/h/r.txt"]);
    expect(deps.slice(deps.indexOf("--exclude-newer"), deps.indexOf("--exclude-newer") + 2)).toEqual(["--exclude-newer", FECHA_CORTE]);
    // Las dependencias no salen del índice de PyTorch (un paquete homónimo ahí podría colarse).
    expect(deps).not.toContain(INDICE_TORCH);
  });

  it("fija kaldifst en una versión con ruedas para Windows y PyTorch tal como quedó", () => {
    expect(RESTRICCIONES).toContain("kaldifst==1.9.0");
    expect(RESTRICCIONES).toContain("torch==2.11.0");
  });

  it("baja el modelo en la revisión fijada a la carpeta dada (con rutas de Windows bien escapadas)", () => {
    const s = scriptModelo("C:\\Users\\x\\modelos\\VoxCPM2");
    expect(s).toContain(`revision="${MODELO_REVISION}"`);
    expect(s).toContain('local_dir="C:\\\\Users\\\\x\\\\modelos\\\\VoxCPM2"');
  });
});
