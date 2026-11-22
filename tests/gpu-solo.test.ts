import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comandoGpuSolo } from "@/lib/gpu-solo";

/** gpu-solo falso como el viejo: sin `trap '' PIPE`; tras el comando escribe en stderr y después restaura. */
async function gpuSoloFalso(dir: string) {
  const bin = path.join(dir, "gpu-solo");
  const marca = path.join(dir, "restaurado");
  await fs.writeFile(bin, `#!/usr/bin/env bash\n"$@"\nfor i in 1 2 3 4 5 6 7 8; do echo "gpu-solo: contenedor $i de vuelta" >&2; done\necho ok > "${marca}"\n`, { mode: 0o755 });
  return { bin, marca };
}

/** Lanza y cierra en seguida la lectura de stderr, como un worker que murió. */
async function lanzarYSoltar(cmd: string, args: string[]): Promise<void> {
  const hijo = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  hijo.stderr!.destroy();
  await new Promise((ok) => hijo.on("close", ok));
}

describe.skipIf(process.platform === "win32")("comandoGpuSolo (WRK-01)", () => {
  it("si nadie lee la salida, gpu-solo igual termina de restaurar", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-gpusolo-"));
    const { bin, marca } = await gpuSoloFalso(dir);
    const c = comandoGpuSolo("sleep", ["0.3"], bin);
    await lanzarYSoltar(c.cmd, c.args);
    expect(existsSync(marca)).toBe(true);
  });

  it("sin el envoltorio, el mismo caso lo mata SIGPIPE antes de restaurar (lo que se corrige)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-gpusolo-"));
    const { bin, marca } = await gpuSoloFalso(dir);
    await lanzarYSoltar(bin, ["sleep", "0.3"]);
    expect(existsSync(marca)).toBe(false);
  });

  it("pasa el comando y sus argumentos sin tocarlos", () => {
    const c = comandoGpuSolo("/py/python", ["wgp.py", "--process", "a b.json"], "/bin/gpu-solo");
    expect(c.cmd).toBe("sh");
    expect(c.args.slice(3)).toEqual(["/bin/gpu-solo", "/py/python", "wgp.py", "--process", "a b.json"]);
  });
});
