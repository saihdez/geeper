import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { argsAtencionComfyui, argsAtencionWan2gp, atencionInstalada, elegirAtencion, elegirRueda } from "@/lib/atencion";

async function venvFalso(paquetes: string[], windows = false) {
  const venv = await fs.mkdtemp(path.join(os.tmpdir(), "venv-"));
  const sp = windows ? path.join(venv, "Lib", "site-packages") : path.join(venv, "lib", "python3.12", "site-packages");
  await fs.mkdir(sp, { recursive: true });
  for (const p of paquetes) {
    if (p.includes(".")) await fs.writeFile(path.join(sp, p), "");
    else await fs.mkdir(path.join(sp, p));
  }
  return windows ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

describe("atencionInstalada", () => {
  it("ve flash sólo con el módulo compilado", async () => {
    expect(atencionInstalada(await venvFalso(["flash_attn"]))).toEqual({ sage: false, flash: false });
    expect(atencionInstalada(await venvFalso(["flash_attn", "flash_attn_2_cuda.cpython-312-x86_64-linux-gnu.so"]))).toEqual({ sage: false, flash: true });
  });
  it("lee el venv de Windows y sage", async () => {
    expect(atencionInstalada(await venvFalso(["sageattention", "flash_attn_2_cuda.cp312-win_amd64.pyd"], true))).toEqual({ sage: true, flash: true });
  });
  it("sin venv no hay nada", () => {
    expect(atencionInstalada("/no/existe/bin/python")).toEqual({ sage: false, flash: false });
  });
});

describe("elegirAtencion", () => {
  it("sage > flash > sdpa en auto", () => {
    expect(elegirAtencion({ sage: true, flash: true }, undefined)).toBe("sage");
    expect(elegirAtencion({ sage: false, flash: true }, "auto")).toBe("flash");
    expect(elegirAtencion({ sage: false, flash: false }, undefined)).toBe("sdpa");
  });
  it("GEEPER_ATENCION manda", () => {
    expect(elegirAtencion({ sage: true, flash: true }, "SDPA")).toBe("sdpa");
    expect(elegirAtencion({ sage: false, flash: false }, "flash")).toBe("flash");
    expect(elegirAtencion({ sage: false, flash: true }, "cualquiera")).toBe("flash");
  });
});

describe("argumentos", () => {
  it("Wan2GP", () => {
    expect(argsAtencionWan2gp("flash", undefined)).toEqual(["--attention", "flash"]);
    expect(argsAtencionWan2gp("sage", undefined)).toEqual([]);
    expect(argsAtencionWan2gp("sdpa", undefined)).toEqual([]);
    expect(argsAtencionWan2gp("sdpa", "sdpa")).toEqual(["--attention", "sdpa"]);
  });
  it("ComfyUI", () => {
    expect(argsAtencionComfyui("flash")).toEqual(["--use-flash-attention"]);
    expect(argsAtencionComfyui("sage")).toEqual(["--use-sage-attention"]);
    expect(argsAtencionComfyui("sdpa")).toEqual([]);
  });
});

describe("elegirRueda", () => {
  const archivos = [
    "flash_attn-2.8.3.post2-cp311-cp311-linux_x86_64.whl",
    "flash_attn-2.8.3.post2-cp312-cp312-linux_x86_64.whl",
    "flash_attn-2.8.3.post2-cp312-cp312-win_amd64.whl",
    "otra-1.0-cp312-cp312-linux_x86_64.whl",
  ];
  it("elige por Python y plataforma", () => {
    expect(elegirRueda(archivos, "cp312", "linux_x86_64")).toBe("flash_attn-2.8.3.post2-cp312-cp312-linux_x86_64.whl");
    expect(elegirRueda(archivos, "cp312", "win_amd64")).toBe("flash_attn-2.8.3.post2-cp312-cp312-win_amd64.whl");
    expect(elegirRueda(archivos, "cp313", "linux_x86_64")).toBeNull();
  });
});
