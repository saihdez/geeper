import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// gpu-solo falso: hace fila 800 ms (como si la tarjeta estuviera ocupada), avisa «pausados» y corre el comando.
const tmp = mkdtempSync(path.join(os.tmpdir(), "geeper-comfy-"));
mkdirSync(path.join(tmp, "bin"));
writeFileSync(path.join(tmp, "bin", "gpu-solo"), `#!/usr/bin/env bash\nsleep 0.8\necho "gpu-solo: pausados: ninguno" >&2\nexec "$@"\n`, { mode: 0o755 });
process.env.GEEPER_HERRAMIENTAS = tmp;
process.env.GEEPER_DATA = path.join(tmp, "datos");
const { arrancarComfyui } = await import("@/lib/comfyui");

// main.py falso (lo corre Node): responde /system_stats a los 200 ms de arrancar.
const dir = path.join(tmp, "ComfyUI");
mkdirSync(dir);
writeFileSync(
  path.join(dir, "main.py"),
  `const p = Number(process.argv[process.argv.indexOf("--port") + 1]);
setTimeout(() => require("node:http").createServer((q, r) => r.end("{}")).listen(p, "127.0.0.1"), 200);`,
);

describe.skipIf(process.platform === "win32")("arranque de ComfyUI (GPU-08)", () => {
  it("el plazo cuenta desde que gpu-solo tiene la tarjeta, no desde que hace fila", async () => {
    const puerto = 20_000 + Math.floor(Math.random() * 20_000);
    const srv = await arrancarComfyui({ puerto, gpuSolo: true, dir, python: process.execPath, arranqueMs: 1500 });
    try {
      expect(srv.url).toContain(String(puerto));
    } finally {
      await srv.detener();
    }
  }, 20_000);
});
