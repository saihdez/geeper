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

  it("con fondo realista: la foto reemplaza siluetas y ramas, con bruma y velo; sin la imagen, vuelven las siluetas", () => {
    const html = compilar(inv({ fondo: "fondo.webp" }), { fuentesCss: "", fondoB64: "QUJD" }).html;
    expect(html).toContain('<div class="escena esc-jardin con-foto"');
    expect(html).toContain('<div class="capa lejos foto" style="--fondo-img:url(data:image/webp;base64,QUJD)"><b></b><i></i></div>');
    expect(html).toContain("@media (min-aspect-ratio:4/5){.escena .foto b{display:block;");
    expect(html).toContain('<div class="capa medio bruma">');
    expect(html).toContain('<div class="primer-plano con-foto" aria-hidden="true"></div>');
    expect(html).not.toContain('<div class="rama izq">');
    expect(html).toContain('class="camino"');
    // El fondo marcado en el json pero sin el archivo: escenario dibujado.
    expect(compilar(inv({ fondo: "fondo.webp" }), { fuentesCss: "" }).html).not.toContain("con-foto\"");
  });

  it("efecto al abrir el sobre: el elegido, el del tema en «auto» y ninguno", async () => {
    const { efectoDe, datosEfecto } = await import("@/lib/invitaciones/efecto-sobre");
    const e = estiloDe(inv());
    expect(efectoDe({ efectoSobre: "mariposas" }, e)).toBe("mariposas");
    expect(efectoDe({}, { adorno: "mariposas" })).toBe("mariposas");
    expect(efectoDe({ efectoSobre: "auto" }, { adorno: "flores" })).toBe("petalos");
    expect(datosEfecto({ efectoSobre: "ninguno" }, e)).toBeNull();
    const html = compilar(inv({ efectoSobre: "mariposas" }), { fuentesCss: "" }).html;
    expect(html).toContain('"tipo":"mariposas"');
    expect(html).toContain("window.efectoSobre=function()");
    expect(html).toContain("if(window.efectoSobre)window.efectoSobre()");
    expect(compilar(inv({ efectoSobre: "ninguno" }), { fuentesCss: "" }).html).toContain('"efecto":null');
  });

  it("efecto propio: movimiento por la descripción, figuras en la página y recorte del fondo de croma", async () => {
    const { movimientoDe, datosEfecto } = await import("@/lib/invitaciones/efecto-sobre");
    const { recortarPixeles, colorCroma } = await import("@/lib/invitaciones/imagenes");
    expect(movimientoDe("mariposas monarca realistas")).toBe("aletea");
    expect(movimientoDe("pétalos de rosa")).toBe("cae");
    expect(movimientoDe("farolitos de papel")).toBe("flota");
    expect(movimientoDe("diamantes")).toBe("estalla");
    expect(colorCroma("hojas de helecho").nombre).toBe("magenta");
    const e = estiloDe(inv());
    const propio = { efectoSobre: "propio" as const, efectoPropio: { descripcion: "mariposas", movimiento: "aletea" as const, figuras: ["efecto-1.webp"] } };
    expect(datosEfecto(propio, e, ["QUJD"])).toMatchObject({ tipo: "propio", aletea: true, imgs: ["data:image/webp;base64,QUJD"] });
    // Sin las figuras en disco: el del tema.
    expect(datosEfecto(propio, e, [])?.tipo).not.toBe("propio");
    expect(compilar(inv(propio), { fuentesCss: "", figurasB64: ["QUJD"] }).html).toContain('"imgs":["data:image/webp;base64,QUJD"]');

    // Un cuadrado rojo sobre verde de croma: queda sólo el cuadrado, con transparencia alrededor.
    const lado = 64, px = new Uint8Array(lado * lado * 4);
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
      const k = (y * lado + x) * 4, dentro = x >= 20 && x < 40 && y >= 24 && y < 44;
      px.set(dentro ? [200, 30, 30, 255] : [10, 250, 20, 255], k);
    }
    const r = recortarPixeles(px, lado)!;
    expect(r.ancho).toBe(26);
    expect(r.alto).toBe(26);
    expect(r.rgba[3]).toBe(0);
    const centro = (13 * r.ancho + 13) * 4;
    expect([...r.rgba.subarray(centro, centro + 4)]).toEqual([200, 30, 30, 255]);
    // Sin fondo plano de color vivo (gris): no se recorta.
    expect(recortarPixeles(new Uint8Array(lado * lado * 4).fill(128), lado)).toBeNull();
  });

  it("nombres para el enlace personalizado de Netlify", async () => {
    const { nombresEnlace } = await import("@/lib/invitaciones/esquema");
    expect(nombresEnlace({ tipo: "xv", nombres: "Mariangel Campos Porras", fecha: "2027-02-20" })).toEqual(["xv-mariangel", "xv-mariangel-campos", "xv-mariangel-2027"]);
    expect(nombresEnlace({ tipo: "boda", nombres: "Ana & José Luis", fecha: "2030-05-01" })).toEqual(["ana-y-jose", "boda-ana-y-jose", "ana-y-jose-2030"]);
    expect(nombresEnlace({ tipo: "cumpleanos", nombres: "Sofía", fecha: "2030-05-01" })[0]).toBe("cumple-sofia");
  });
});
