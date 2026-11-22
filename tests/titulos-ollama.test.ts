import { describe, expect, it } from "vitest";
import { argsOllamaTitulos } from "@/lib/titulos";

describe("títulos con la IA local (WEB-02)", () => {
  it("el modelo no se queda cargado en la tarjeta al responder", () => {
    const a = argsOllamaTitulos();
    expect(a.slice(a.indexOf("--keepalive"), a.indexOf("--keepalive") + 2)).toEqual(["--keepalive", "0s"]);
    expect(a).toContain("--format");
  });
});
