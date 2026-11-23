/** WEB-10: el panel del presentador cerrado y sin trabajo no pregunta cada 15 s (4 pedidos por minuto en el editor). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const s = fs.readFileSync(path.join(process.cwd(), "src", "components", "panel-presentador.tsx"), "utf8");

describe("presentador: sondeo con el panel cerrado", () => {
  it("cerrado y sin trabajo en curso no vuelve a pedir; al abrir, pide al instante", () => {
    expect(s).not.toContain("abierto ? 4000 : 15_000");
    expect(s).toMatch(/\(x\) =>\s*abierto \? 4000 : x\?\.trabajos\.some\(.*\) \? 10_000 : Infinity/);
    expect(s).toContain("if (abre) void recargar();");
  });
});
