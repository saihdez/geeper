import { describe, expect, it } from "vitest";
import { correr, enTrabajo } from "@/lib/proceso";

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
});
