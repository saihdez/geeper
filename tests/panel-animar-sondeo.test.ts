import { describe, expect, it } from "vitest";
import { intervaloAnimar } from "@/components/panel-animar";

describe("«Animar» no sondea /plano con el panel cerrado y quieto (WEB-10)", () => {
  it("abierto: 3 s", () => expect(intervaloAnimar(true, false)).toBe(3000));
  it("cerrado con la escena animándose: 10 s, para mostrar el avance en el título", () => expect(intervaloAnimar(false, true)).toBe(10_000));
  it("cerrado y sin animación: nunca (antes, cada 10 s por escena)", () => expect(intervaloAnimar(false, false)).toBe(Infinity));
});
