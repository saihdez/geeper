import { describe, expect, it } from "vitest";
import { banderasRender } from "@/lib/render-gpu";

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
