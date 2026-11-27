import { describe, expect, it } from "vitest";
import { analizar } from "@/lib/anuncios/marca";
import { contrastePeor, hacerLegible } from "@/lib/colores-marca";
import { ESTILOS_PLANTILLA } from "@/lib/estilos-plantilla";
import { aPerfilMarca, ctaDe, desdePerfil, fuenteGoogle, leerMarcaWeb, normalizarUrl, resumirMarca, type CapturaCruda } from "@/lib/marca-web";

describe("link de la página", () => {
  it("completa el link como lo escribe la persona", () => {
    expect(normalizarUrl("mitienda.com")).toBe("https://mitienda.com/");
    expect(normalizarUrl("  http://mitienda.com/hola ")).toBe("http://mitienda.com/hola");
    expect(normalizarUrl("mitienda.com:8080")).toBe("https://mitienda.com:8080/");
  });
  it("rechaza lo que no es una página web", () => {
    expect(() => normalizarUrl("")).toThrow(/Escribe/);
    expect(() => normalizarUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => normalizarUrl("javascript:alert(1)")).toThrow(/http/);
    expect(() => normalizarUrl("hola")).toThrow(/no parece/);
    expect(() => normalizarUrl("localhost:3300")).toThrow(/internet/);
  });
});

describe("letra de Google Fonts más parecida", () => {
  it("reconoce la misma letra aunque venga con otro nombre", () => {
    expect(fuenteGoogle('"Inter", system-ui, sans-serif', "texto")).toEqual({ fuente: "Inter", exacta: true, original: "Inter" });
    expect(fuenteGoogle("__Inter_a1b2c3, __Inter_Fallback_a1b2c3", "texto")).toMatchObject({ fuente: "Inter", exacta: true });
    expect(fuenteGoogle('"Inter Variable", sans-serif', "texto")).toMatchObject({ fuente: "Inter", exacta: true });
    expect(fuenteGoogle("playfair display, serif", "titulos")).toMatchObject({ fuente: "Playfair Display", exacta: true });
  });
  it("si la primera no es de Google usa la siguiente de la pila, como parecida", () => {
    expect(fuenteGoogle('"Söhne", "Inter", sans-serif', "texto")).toEqual({ fuente: "Inter", exacta: false, original: "Söhne" });
  });
  it("reconoce nombres de archivo y nombres viejos", () => {
    expect(fuenteGoogle("SourceSansProBold, sans-serif", "titulos")).toMatchObject({ fuente: "Source Sans 3", exacta: true });
    expect(fuenteGoogle('"Source Serif Pro", serif', "texto")).toMatchObject({ fuente: "Source Serif 4", exacta: true });
    expect(fuenteGoogle("Archivo Black, sans-serif", "titulos")).toMatchObject({ fuente: "Archivo Black", exacta: true });
    expect(fuenteGoogle("MontserratBold", "titulos")).toMatchObject({ fuente: "Montserrat", exacta: true });
  });
  it("si ninguna es de Google, elige por tipo", () => {
    expect(fuenteGoogle("Georgia, 'Times New Roman', serif", "titulos").fuente).toBe("Playfair Display");
    expect(fuenteGoogle("Georgia, serif", "texto").fuente).toBe("Merriweather");
    expect(fuenteGoogle("Helvetica Neue, Arial, sans-serif", "texto")).toMatchObject({ fuente: "Inter", exacta: false });
    expect(fuenteGoogle("Impact, sans-serif", "titulos").fuente).toBe("Archivo Black");
    expect(fuenteGoogle("SFMono-Regular, Menlo, monospace", "texto").fuente).toBe("IBM Plex Mono");
    expect(fuenteGoogle("-apple-system, BlinkMacSystemFont, sans-serif", "titulos").fuente).toBe("Inter");
  });
});

describe("marca de la página", () => {
  const cruda: CapturaCruda = {
    nombre: "Mi Tienda",
    colores: [
      { color: "rgb(255, 255, 255)", puntaje: 400 }, // fondo
      { color: "rgb(17, 17, 17)", puntaje: 200 }, // texto
      { color: "rgb(230, 57, 70)", puntaje: 120 }, // botones
      { color: "rgb(232, 60, 72)", puntaje: 30 }, // casi el mismo rojo
      { color: "#2a9d8f", puntaje: 60 }, // variable CSS
      { color: "rgba(0, 0, 0, 0.1)", puntaje: 500 }, // sombra transparente: no cuenta
      { color: "oklch(70% 0.1 200)", puntaje: 50 }, // formato que no se lee: no cuenta
    ],
    fuentes: { titulos: '"Poppins", sans-serif', texto: "Inter, sans-serif" },
    logos: [],
  };

  it("junta los colores casi iguales y descarta los transparentes", () => {
    const m = resumirMarca(cruda);
    expect(m.colores.map((c) => c.hex)).toEqual(["#ffffff", "#111111", "#e63946", "#2a9d8f"]);
    expect(m.colores.reduce((s, c) => s + c.parte, 0)).toBeCloseTo(1, 6);
    expect(m.colores[2]!.parte).toBeCloseTo(150 / 810, 6);
  });

  it("propone el color de los botones como principal y lee las letras", () => {
    const m = resumirMarca(cruda);
    expect(m.roles.acento1).toBe("#e63946");
    expect(m.roles.acento2).toBe("#2a9d8f");
    expect(m.tipografia.titulos).toMatchObject({ fuente: "Poppins", exacta: true });
    expect(m.tipografia.texto.fuente).toBe("Inter");
    expect(m.nombre).toBe("Mi Tienda");
  });

  it("no toma el azul de los enlaces sin estilo como color de marca", () => {
    const m = resumirMarca({ ...cruda, colores: [{ color: "#ffffff", puntaje: 10 }, { color: "rgb(0, 0, 238)", puntaje: 50 }] });
    expect(m.colores.map((c) => c.hex)).toEqual(["#ffffff"]);
    expect(m.roles).toEqual({});
  });

  it("una página sin colores de marca no propone roles", () => {
    const m = resumirMarca({ ...cruda, colores: [{ color: "#ffffff", puntaje: 10 }, { color: "#000000", puntaje: 5 }] });
    expect(m.roles).toEqual({});
  });
});

describe("un solo lector para Plantillas y Anuncios", () => {
  it("no abre direcciones de la casa ni de la red local", async () => {
    for (const u of ["http://127.0.0.1:3300", "http://192.168.1.1", "http://169.254.169.254/latest/meta-data"]) {
      await expect(leerMarcaWeb(u)).rejects.toThrow(/internet/);
    }
  });

  const perfil = analizar(
    "https://cafesol.example",
    `<html><head><title>Café Sol | Tienda</title><meta name="theme-color" content="#E4572E">
     <style>body{color:#222;background:#fff} .b{background:#e4572e} .c{color:#17BEBB}</style></head>
     <body><h1>Café</h1><button>Comprar ahora</button></body></html>`,
    [],
    "2026-11-27",
  );

  it("sin navegador, usa el lector simple y lo dice", () => {
    const l = desdePerfil(perfil);
    expect(l.motor).toBe("simple");
    expect(l.marca.nombre).toBe("Café Sol");
    expect(l.marca.roles.acento1).toBe("#e4572e");
    expect(l.cta).toBe("Comprar ahora");
    expect(l.avisos[0]).toMatch(/modo simple/);
  });

  it("Anuncios recibe lo observado y lo inferido, con la letra ya de Google Fonts", () => {
    const p = aPerfilMarca(desdePerfil(perfil));
    expect(p.inferido.marca).toBe("Café Sol");
    expect(p.inferido.acento1).toBe("#e4572e");
    expect(p.inferido.cta).toBe("Comprar ahora");
    expect(p.inferido.fuente).toBe("Inter");
    expect(p.observado.colores.map((c) => c.valor)).toContain("#e4572e");
  });
});

describe("colores de una página, listos para leerse en video", () => {
  it("arregla la caja, la palabra que suena y el cierre", () => {
    const c = hacerLegible({ tinta: "#ffffff", activa: "#3a3a8a", acento1: "#2b2b2b", acento2: "#444444", fondoPastilla: "rgba(0, 0, 0, 0.2)", fondoCierre: "rgba(0, 0, 0, 0.3)" });
    expect(contrastePeor(c.tinta, c.fondoPastilla)!).toBeGreaterThanOrEqual(4.5);
    expect(contrastePeor(c.activa, c.fondoPastilla)!).toBeGreaterThanOrEqual(4.5);
  });
  it("no toca lo que ya se lee", () => {
    for (const e of ESTILOS_PLANTILLA) expect(hacerLegible(e.colores), e.id).toEqual(e.colores);
  });
});

describe("botón del cierre", () => {
  it("sólo toma botones que piden algo", () => {
    expect(ctaDe(["Python", "SearchK", "Download"])).toBe("Download");
    expect(ctaDe(["Menú", "Comprar ahora"])).toBe("Comprar ahora");
    expect(ctaDe(["Inicio", "Buscar"])).toBeNull();
  });
});
