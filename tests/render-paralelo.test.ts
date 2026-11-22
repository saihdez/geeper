import { describe, expect, it } from "vitest";
import { checkALaVez, checkYRender } from "@/lib/render-paralelo";

/** Promesa que se resuelve a mano o se rechaza al cortar la señal. */
function pendiente<T>(signal: AbortSignal) {
  let resolver!: (v: T) => void;
  const p = new Promise<T>((res, rej) => {
    resolver = res;
    signal.addEventListener("abort", () => rej(new Error("cortado")), { once: true });
  });
  return { p, resolver };
}

describe("REN-12: check y render a la vez", () => {
  it("el render arranca sin esperar a que termine el check", async () => {
    const orden: string[] = [];
    let soltarCheck!: (v: string) => void;
    const r = checkYRender(
      (s) => {
        orden.push("check");
        const x = pendiente<string>(s);
        soltarCheck = x.resolver;
        return x.p;
      },
      async () => {
        orden.push("render");
        return true;
      },
      { aLaVez: true },
    );
    await Promise.resolve();
    expect(orden).toEqual(["check", "render"]);
    soltarCheck("ok");
    await expect(r).resolves.toEqual({ check: "ok", render: true });
  });

  it("si el check trae errores, corta el render y lanza el error del check", async () => {
    let renderCortado = false;
    const r = checkYRender(
      async () => {
        await new Promise((res) => setTimeout(res, 5));
        throw new Error("hyperframes check encontró 2 errores");
      },
      (s) => {
        s.addEventListener("abort", () => (renderCortado = true));
        return pendiente<boolean>(s).p;
      },
      { aLaVez: true },
    );
    await expect(r).rejects.toThrow("encontró 2 errores");
    expect(renderCortado).toBe(true);
  });

  it("si el render falla, corta el check", async () => {
    let checkCortado = false;
    const r = checkYRender(
      (s) => {
        s.addEventListener("abort", () => (checkCortado = true));
        return pendiente<string>(s).p;
      },
      async () => {
        throw new Error("ffmpeg murió");
      },
      { aLaVez: true },
    );
    await expect(r).rejects.toThrow("ffmpeg murió");
    expect(checkCortado).toBe(true);
  });

  it("cancelar el trabajo corta a los dos", async () => {
    const ac = new AbortController();
    const cortados: string[] = [];
    const r = checkYRender(
      (s) => {
        s.addEventListener("abort", () => cortados.push("check"));
        return pendiente<string>(s).p;
      },
      (s) => {
        s.addEventListener("abort", () => cortados.push("render"));
        return pendiente<boolean>(s).p;
      },
      { aLaVez: true, signal: ac.signal },
    );
    ac.abort();
    await expect(r).rejects.toThrow();
    expect(cortados.sort()).toEqual(["check", "render"]);
  });

  it("en serie (GEEPER_RENDER_CHECK_A_LA_VEZ=0) el render no arranca si el check falla", async () => {
    let renderLanzado = false;
    await expect(
      checkYRender(
        async () => {
          throw new Error("errores");
        },
        async () => {
          renderLanzado = true;
          return true;
        },
        { aLaVez: false },
      ),
    ).rejects.toThrow("errores");
    expect(renderLanzado).toBe(false);
    expect(checkALaVez({ GEEPER_RENDER_CHECK_A_LA_VEZ: "0" })).toBe(false);
    expect(checkALaVez({})).toBe(true);
  });
});
