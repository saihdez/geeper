import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { correr, enTrabajo } from "@/lib/proceso";

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarA = async (cond: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 50));
  return cond();
};

describe.skipIf(process.platform === "win32")("correr", () => {
  it("un comando que no lee su entrada no tumba el proceso con EPIPE (WRK-08)", async () => {
    const r = await correr("sh", ["-c", "exit 0"], { entrada: "x".repeat(8_000_000) });
    expect(r.codigo).toBe(0);
  });

  it("dentro de un trabajo, cancelar corta un comando que no recibió la señal (WRK-05)", async () => {
    const ctrl = new AbortController();
    const t0 = Date.now();
    const p = enTrabajo(ctrl.signal, () => correr("sleep", ["20"]));
    setTimeout(() => ctrl.abort(), 200);
    await expect(p).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("también lo que se lanza más tarde en el mismo trabajo (tras un await)", async () => {
    const ctrl = new AbortController();
    const p = enTrabajo(ctrl.signal, async () => {
      await new Promise((r) => setTimeout(r, 50));
      return correr("sleep", ["20"]);
    });
    setTimeout(() => ctrl.abort(), 300);
    await expect(p).rejects.toThrow();
  });

  it("signal: null no se corta (limpiezas) y fuera de un trabajo nada cambia", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await enTrabajo(ctrl.signal, () => correr("sh", ["-c", "echo hola"], { signal: null }));
    expect(r.stdout.trim()).toBe("hola");
    expect((await correr("sh", ["-c", "echo fuera"])).stdout.trim()).toBe("fuera");
  });

  it("cancelar corta también a los nietos (lo que lanza npx o gpu-solo), no sólo al hijo directo (WRK-03)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "geeper-arbol-"));
    const ctrl = new AbortController();
    const t0 = Date.now();
    const p = correr("sh", ["-c", `sleep 30 & echo $! > ${dir}/nieto; wait`], { signal: ctrl.signal });
    expect(await esperarA(() => existsSync(`${dir}/nieto`) && readFileSync(`${dir}/nieto`, "utf8").trim() !== "")).toBe(true);
    const nieto = Number(readFileSync(`${dir}/nieto`, "utf8"));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await esperarA(() => !vivo(nieto))).toBe(true);
  });

  it("el límite de tiempo también corta el árbol entero", async () => {
    const t0 = Date.now();
    const r = await correr("sh", ["-c", "sleep 30 & wait"], { timeout: 300, permitirFallo: true });
    expect(r.codigo).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("con gpu-solo, el SIGKILL va sólo al de dentro: gpu-solo alcanza a restaurar", { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "geeper-gpusolo-"));
    const bin = path.join(dir, "gpu-solo");
    writeFileSync(bin, `#!/usr/bin/env bash\ntrap 'echo ok > "${dir}/restaurado"' EXIT\ntrap 'exit 130' INT TERM\n"$@"\n`, { mode: 0o755 });
    const ctrl = new AbortController();
    // El de dentro ignora SIGTERM: sólo el SIGKILL de los 5 s lo para.
    const p = correr(bin, [process.execPath, "-e", "process.on('SIGTERM',()=>{});console.log('listo');setInterval(()=>{},1000)"], { signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 500));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(await esperarA(() => existsSync(path.join(dir, "restaurado")))).toBe(true);
  });

  it("una señal ya cancelada no lanza nada", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(correr("sh", ["-c", "echo no"], { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
