/** Modo inmersivo: cada tema tiene su escenario, su camino y sus interacciones (escenario.ts). */
import { describe, expect, it } from "vitest";
import { compilar } from "@/lib/invitaciones/compilar";
import { capasEscenario, escenarioDe, htmlEscenario, semillaDe } from "@/lib/invitaciones/escenario";
import { Entrada, Invitacion } from "@/lib/invitaciones/esquema";
import { estiloDe } from "@/lib/invitaciones/estilo";
import { ADORNOS } from "@/lib/invitaciones/tema";

const base = { tipo: "xv" as const, nombres: "Sofía", fecha: "2030-03-02", hora: "18:00", zona: "America/Mexico_City", lugar: { nombre: "Salón Luna" }, whatsapp: "525511112222" };
function inv(x: Record<string, unknown> = {}) {
  const { musicaEnlace: _m, plantilla: _p, ...resto } = Entrada.parse(base);
  return Invitacion.parse({ ...resto, version: 1, slug: "xv-sofia-abc123", creada: "x", actualizada: "x", plantilla: "jardin", musica: { tipo: "ninguna" }, ...x });
}

describe("escenario del tema", () => {
  it("cada adorno lleva a un escenario", () => {
    expect(escenarioDe("hojas")).toBe("bosque");
    expect(escenarioDe("hongos")).toBe("bosque");
    expect(escenarioDe("estrellas")).toBe("noche");
    expect(escenarioDe("ondas")).toBe("mar");
    expect(escenarioDe("copos")).toBe("invierno");
    expect(escenarioDe("globos")).toBe("fiesta");
    expect(escenarioDe("clasico")).toBe("elegante");
    for (const a of ADORNOS) expect(htmlEscenario({ ...estiloDe(inv()), adorno: a }, 1).fondo).toContain('class="escena esc-');
  });

  it("la misma invitación da siempre el mismo escenario; otra, otro", () => {
    expect(capasEscenario("bosque", semillaDe("a"))).toEqual(capasEscenario("bosque", semillaDe("a")));
    expect(capasEscenario("bosque", semillaDe("a")).medio).not.toBe(capasEscenario("bosque", semillaDe("b")).medio);
  });

  it("la página lleva el escenario detrás, el camino entre las tarjetas y las ramas delante, sin tapar la lectura", () => {
    const { html } = compilar(inv(), { fuentesCss: "" }, 0);
    expect(html).toMatch(/<body class="cerrado"><div class="escena esc-jardin"/);
    expect(html).toMatch(/<div class="resto"><svg class="camino"/);
    expect(html).toContain('<div class="primer-plano esc-jardin"');
    // Orden de capas: escenario 0, partículas 1, página 2, partículas de adelante 3, ramas 4 (sin recibir toques).
    expect(html).toContain(".pagina{position:relative;z-index:2;");
    expect(html).toContain(".primer-plano{position:fixed;inset:0;z-index:4;pointer-events:none}");
    expect(html).toContain(".escena{position:fixed;inset:0;z-index:0;pointer-events:none;");
    // Con «reducir movimiento» sólo se quedan quietos el fondo y las ramas; el sobre, las tarjetas y el camino se animan igual.
    expect(html).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.escena \.capa,\.escena \.lado,\.primer-plano \.rama\{transform:none!important\}/);
    expect(html).toContain("hecho=Math.max(");
    expect(html).not.toContain("animation:none!important");
    expect(html).toContain("function bajarA(el)");
  });
});
