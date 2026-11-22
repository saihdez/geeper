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

describe("render: equipo sin NVIDIA (REN-03)", () => {
  it("fuera de Windows y sin la variable no pregunta a nvidia-smi y deja decidir al candado", async () => {
    olvidarNvidia();
    let consultas = 0;
    expect(await hayNvidia("linux", {}, async () => (consultas++, false))).toBe(true);
    expect(await hayNvidia("mac", {}, async () => true)).toBe(false);
    expect(await hayNvidia("windows", { GEEPER_RENDER_DETECTAR_NVIDIA: "0" }, async () => (consultas++, false))).toBe(true);
    expect(consultas).toBe(0);
  });

  it("en Windows detecta por defecto: pregunta una sola vez y sin NVIDIA va por CPU", async () => {
    olvidarNvidia();
    let consultas = 0;
    const consultar = async () => (consultas++, false);
    expect(await hayNvidia("windows", {}, consultar)).toBe(false);
    expect(await hayNvidia("windows", {}, consultar)).toBe(false);
    expect(consultas).toBe(1);
    olvidarNvidia();
    expect(await hayNvidia("linux", { GEEPER_RENDER_DETECTAR_NVIDIA: "1" }, async () => { throw new Error("no está"); })).toBe(false);
    olvidarNvidia();
  });

  it("una respuesta positiva queda guardada", async () => {
    olvidarNvidia();
    let consultas = 0;
    const consultar = async () => (consultas++, true);
    expect(await hayNvidia("windows", {}, consultar)).toBe(true);
    expect(await hayNvidia("windows", {}, consultar)).toBe(true);
    expect(consultas).toBe(1);
    olvidarNvidia();
  });

  it("si nvidia-smi no contestó a tiempo, no guarda nada y deja probar con la tarjeta", async () => {
    olvidarNvidia();
    const respuestas: (boolean | null)[] = [null, true];
    let consultas = 0;
    const consultar = async () => (consultas < respuestas.length ? respuestas[consultas++]! : false);
    expect(await hayNvidia("windows", {}, consultar)).toBe(true);
    expect(await hayNvidia("windows", {}, consultar)).toBe(true);
    expect(consultas).toBe(2);
    olvidarNvidia();
  });

  it("dos renders a la vez comparten la misma consulta", async () => {
    olvidarNvidia();
    let consultas = 0;
    const consultar = () => new Promise<boolean>((ok) => setTimeout(() => (consultas++, ok(false)), 5));
    const [a, b] = await Promise.all([hayNvidia("windows", {}, consultar), hayNvidia("windows", {}, consultar)]);
    expect([a, b]).toEqual([false, false]);
    expect(consultas).toBe(1);
    olvidarNvidia();
  });

  it("si el render con --gpu falla, por defecto lo repite una vez por CPU tras soltar la tarjeta", async () => {
    const pasos: string[] = [];
    const log: string[] = [];
    const usoGpu = await renderConRespaldo(true, async (g) => {
      pasos.push(g ? "gpu" : "cpu");
      if (g) throw new Error("h264_nvenc: no device");
    }, (s) => log.push(s), {}, undefined, () => pasos.push("soltar"));
    expect(usoGpu).toBe(false);
    expect(pasos).toEqual(["gpu", "soltar", "cpu"]);
    expect(log[0]).toContain("se repite una vez por CPU");
  });

  it("con GEEPER_RENDER_REINTENTO_CPU=0, si falla por CPU o si se canceló, el error sube igual", async () => {
    let soltado = false;
    const soltar = () => { soltado = true; };
    await expect(renderConRespaldo(true, async () => { throw new Error("x"); }, () => {}, { GEEPER_RENDER_REINTENTO_CPU: "0" }, undefined, soltar)).rejects.toThrow("x");
    await expect(renderConRespaldo(false, async () => { throw new Error("y"); }, () => {}, {}, undefined, soltar)).rejects.toThrow("y");
    const ac = new AbortController();
    ac.abort();
    await expect(renderConRespaldo(true, async () => { throw new Error("z"); }, () => {}, {}, ac.signal, soltar)).rejects.toThrow("z");
    expect(soltado).toBe(false);
  });
});
