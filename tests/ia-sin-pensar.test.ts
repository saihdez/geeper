import { describe, expect, it } from "vitest";
import { datosEjemplo } from "@/lib/anuncios/ejemplo";
import { cuerpoIdeas } from "@/lib/anuncios/ideas";
import { argsOllamaTitulos } from "@/lib/titulos";

describe("WEB-02: la IA local no piensa en voz alta ni se queda en la tarjeta", () => {
  it("títulos: --think=false, --hidethinking y --keepalive 0s", () => {
    const a = argsOllamaTitulos();
    expect(a).toContain("--think=false");
    expect(a).toContain("--hidethinking");
    expect(a.slice(a.indexOf("--keepalive"), a.indexOf("--keepalive") + 2)).toEqual(["--keepalive", "0s"]);
  });

  it("ideas de anuncios: think false y keep_alive 0", () => {
    const c = cuerpoIdeas(datosEjemplo(), "modelo");
    expect(c.think).toBe(false);
    expect(c.keep_alive).toBe(0);
    expect(c.model).toBe("modelo");
    expect(c.messages).toHaveLength(2);
  });
});
