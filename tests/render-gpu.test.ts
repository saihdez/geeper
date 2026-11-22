import { describe, expect, it } from "vitest";
import { banderasRender, hayNvidia, olvidarNvidia, renderConRespaldo } from "@/lib/render-gpu";

describe("render: banderas de captura (REN-01, apagado por defecto)", () => {
  it("por defecto sigue igual: NVENC con --gpu y CPU con --no-browser-gpu", () => {
    expect(banderasRender(true, "linux", {})).toEqual({ args: ["--gpu"], env: {} });
    expect(banderasRender(false, "linux", {})).toEqual({ args: ["--no-browser-gpu"], env: {} });
    expect(banderasRender(false, "windows", {})).toEqual({ args: ["--no-browser-gpu"], env: {} });
  });

  it("con GEEPER_RENDER_CAPTURA_AUTO=1, en Linux sin NVENC deja elegir la captura y usa GL por software", () => {
    const env = { GEEPER_RENDER_CAPTURA_AUTO: "1" };
    expect(banderasRender(false, "linux", env)).toEqual({ args: [], env: { LIBGL_ALWAYS_SOFTWARE: "1" } });
    expect(banderasRender(false, "mac", env)).toEqual({ args: ["--no-browser-gpu"], env: {} });
    expect(banderasRender(true, "linux", env)).toEqual({ args: ["--gpu"], env: {} });
  });
});

describe("render: equipo sin NVIDIA (REN-03, apagado por defecto)", () => {
  it("sin la variable no pregunta a nvidia-smi y deja decidir al candado", async () => {
    olvidarNvidia();
    let consultas = 0;
    expect(await hayNvidia("linux", {}, async () => (consultas++, false))).toBe(true);
    expect(await hayNvidia("mac", {}, async () => true)).toBe(false);
    expect(consultas).toBe(0);
  });

  it("con GEEPER_RENDER_DETECTAR_NVIDIA=1 pregunta una sola vez y sin NVIDIA va por CPU", async () => {
    olvidarNvidia();
    const env = { GEEPER_RENDER_DETECTAR_NVIDIA: "1" };
    let consultas = 0;
    const consultar = async () => (consultas++, false);
    expect(await hayNvidia("windows", env, consultar)).toBe(false);
    expect(await hayNvidia("windows", env, consultar)).toBe(false);
    expect(consultas).toBe(1);
    olvidarNvidia();
    expect(await hayNvidia("linux", env, async () => { throw new Error("no está"); })).toBe(false);
    olvidarNvidia();
  });

  it("si el render con --gpu falla y la detección está activa, lo repite una vez por CPU", async () => {
    const env = { GEEPER_RENDER_DETECTAR_NVIDIA: "1" };
    const intentos: boolean[] = [];
    const log: string[] = [];
    const usoGpu = await renderConRespaldo(true, async (g) => {
      intentos.push(g);
      if (g) throw new Error("h264_nvenc: no device");
    }, (s) => log.push(s), env);
    expect(usoGpu).toBe(false);
    expect(intentos).toEqual([true, false]);
    expect(log[0]).toContain("se repite una vez por CPU");
  });

  it("sin la variable, o si falla por CPU, el error sube igual", async () => {
    await expect(renderConRespaldo(true, async () => { throw new Error("x"); }, () => {}, {})).rejects.toThrow("x");
    await expect(renderConRespaldo(false, async () => { throw new Error("y"); }, () => {}, { GEEPER_RENDER_DETECTAR_NVIDIA: "1" })).rejects.toThrow("y");
  });
});
