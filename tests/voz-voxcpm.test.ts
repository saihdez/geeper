import path from "node:path";
import { describe, expect, it } from "vitest";
import { correr } from "@/lib/proceso";

/**
 * py/voz_voxcpm.py fija la revisión de VoxCPM2 y la busca primero sin red (TER-07). Se prueba con un
 * huggingface_hub falso: no hace falta torch ni el modelo.
 */
const PY = process.platform === "win32" ? "python" : "python3";
const SCRIPT_DIR = path.join(process.cwd(), "py");

async function probar(codigoHub: string, llamada: string, antes = ""): Promise<string> {
  const codigo = [
    "import os, sys, types, json",
    "os.environ.pop('GEEPER_VOXCPM', None)",
    "llamadas = []",
    "hub = types.ModuleType('huggingface_hub')",
    codigoHub,
    "hub.snapshot_download = snapshot_download",
    "sys.modules['huggingface_hub'] = hub",
    `sys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)})`,
    "import voz_voxcpm",
    antes,
    `r = ${llamada}`,
    "print(json.dumps({'ruta': r, 'llamadas': llamadas}))",
  ].join("\n");
  const r = await correr(PY, ["-I", "-B", "-c", codigo]);
  return r.stdout.trim();
}

describe("VoxCPM2 con la revisión fijada (TER-07)", () => {
  it("usa la revisión fijada desde la caché, sin ir a internet", async () => {
    const out = JSON.parse(await probar(
      "def snapshot_download(**k):\n    llamadas.append(k)\n    return '/cache/' + k['revision']",
      "voz_voxcpm.ruta_modelo()",
    )) as { ruta: string; llamadas: { revision: string; local_files_only?: boolean; repo_id: string }[] };
    expect(out.ruta).toBe("/cache/7936080b41163874f38610f46f438e2c0757f9fd");
    expect(out.llamadas).toHaveLength(1);
    expect(out.llamadas[0]).toMatchObject({ repo_id: "openbmb/VoxCPM2", local_files_only: true });
  });

  it("si no está en la caché, baja esa misma revisión", async () => {
    const out = JSON.parse(await probar(
      "def snapshot_download(**k):\n    llamadas.append(k)\n    if k.get('local_files_only'):\n        raise OSError('no está')\n    return '/bajado/' + k['revision']",
      "voz_voxcpm.ruta_modelo()",
    )) as { ruta: string; llamadas: { revision: string; local_files_only?: boolean }[] };
    expect(out.ruta).toBe("/bajado/7936080b41163874f38610f46f438e2c0757f9fd");
    expect(out.llamadas).toHaveLength(2);
    expect(out.llamadas[1]!.local_files_only).toBeUndefined();
  });

  it("una carpeta local se usa tal cual", async () => {
    const out = JSON.parse(await probar(
      "def snapshot_download(**k):\n    llamadas.append(k)\n    return 'no'",
      `voz_voxcpm.ruta_modelo(${JSON.stringify(SCRIPT_DIR)})`,
    )) as { ruta: string; llamadas: unknown[] };
    expect(out.ruta).toBe(SCRIPT_DIR);
    expect(out.llamadas).toHaveLength(0);
  });

  it("con GEEPER_VOXCPM (ruta que pasa la app) la usa tal cual, sin revisión ni red", async () => {
    const out = JSON.parse(await probar(
      "def snapshot_download(**k):\n    llamadas.append(k)\n    return 'no'",
      "voz_voxcpm.ruta_modelo()",
      "os.environ['GEEPER_VOXCPM'] = '/herramientas/modelos/VoxCPM2'",
    )) as { ruta: string; llamadas: unknown[] };
    expect(out.ruta).toBe("/herramientas/modelos/VoxCPM2");
    expect(out.llamadas).toHaveLength(0);
  });
});
