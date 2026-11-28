import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanteUTC, partesCuentaAtras, semanasDelMes, textosFecha, utcCompacto } from "@/lib/invitaciones/calendario";
import { compilar, iniciales, urlOg } from "@/lib/invitaciones/compilar";
import { bloquesLatinos, guardarInvitacion, leerInvitacion, listarInvitaciones, ponerUrlPublica, vistaPrevia } from "@/lib/invitaciones/construir";
import { ics, leerEnlaceMusica, mensajeConfirmacion, plegarIcs, urlGoogleCalendar, urlMaps, urlWhatsApp } from "@/lib/invitaciones/enlaces";
import { Entrada, fechaPasada, Invitacion, PLANTILLAS, TIPOS } from "@/lib/invitaciones/esquema";
import { leerMensajes } from "@/lib/invitaciones/mensaje";
import { estiloDe } from "@/lib/invitaciones/estilo";
import { ADORNOS, asegurarContraste, contraste, normalizarTema, PARTICULAS, promptTema, TemaIa, temaPorPalabras } from "@/lib/invitaciones/tema";
import { esquemaParaOllama } from "@/lib/llm-local";
import { ajustesFoto, arteDe, grafoQrArte, lecturasQr, leerPropuestas, NOMBRE_PROPUESTA, pngQrBase, repararHastaQueSeLea, rondasQr } from "@/lib/invitaciones/imagenes";
import { normalizarUrlPublica } from "@/lib/invitaciones/esquema";
import { usarPropuesta } from "@/lib/invitaciones/construir";
import { FFMPEG } from "@/lib/rutas";
import { execFileSync } from "node:child_process";

const correrFfmpeg = (args: string[]) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);
import { existsSync } from "node:fs";

const base = {
  tipo: "boda" as const, nombres: "Adeline & Marcos", fecha: "2030-12-15", hora: "15:30", zona: "America/Caracas",
  lugar: { nombre: "Hacienda Las Mercedes", direccion: "Cabudare, Lara" }, whatsapp: "+58 412-123.45.67",
};

function inv(x: Partial<Invitacion> = {}): Invitacion {
  const e = Entrada.parse(base);
  const { musicaEnlace: _m, plantilla: _p, ...resto } = e;
  return Invitacion.parse({ ...resto, version: 1, slug: "boda-prueba-abc123", creada: "x", actualizada: "x", plantilla: "vino-oro", musica: { tipo: "ninguna" }, ...x });
}

describe("Entrada", () => {
  it("limpia el WhatsApp y pone valores por defecto", () => {
    const e = Entrada.parse(base);
    expect(e.whatsapp).toBe("584121234567");
    expect(e.duracionHoras).toBe(5);
    expect(e.dressCode.colores).toEqual([]);
  });
  it("rechaza WhatsApp con letras, mapas que no son https y zonas inventadas", () => {
    expect(() => Entrada.parse({ ...base, whatsapp: "llámame" })).toThrow();
    expect(() => Entrada.parse({ ...base, lugar: { nombre: "x", mapa: "javascript:alert(1)" } })).toThrow();
    expect(() => Entrada.parse({ ...base, zona: "Marte/Olympus" })).toThrow();
  });
  it("sabe si la fecha ya pasó en la zona del evento", () => {
    const ahora = new Date("2026-11-27T03:00:00Z"); // 26 de nov. por la noche en México
    expect(fechaPasada("2026-11-26", "America/Mexico_City", ahora)).toBe(false);
    expect(fechaPasada("2026-11-25", "America/Mexico_City", ahora)).toBe(true);
  });
});

describe("fechas", () => {
  it("convierte la hora de pared de la zona a UTC", () => {
    expect(new Date(instanteUTC("2026-12-15", "15:30", "America/Caracas")).toISOString()).toBe("2026-12-15T19:30:00.000Z");
    expect(new Date(instanteUTC("2026-12-15", "18:00", "America/Mexico_City")).toISOString()).toBe("2026-12-16T00:00:00.000Z");
    // Madrid: invierno UTC+1, verano UTC+2
    expect(new Date(instanteUTC("2026-01-10", "12:00", "Europe/Madrid")).toISOString()).toBe("2026-01-10T11:00:00.000Z");
    expect(new Date(instanteUTC("2026-07-10", "12:00", "Europe/Madrid")).toISOString()).toBe("2026-07-10T10:00:00.000Z");
    // Día del cambio de horario en Nueva York (8 de marzo de 2026, 2 a. m. → 3 a. m.)
    expect(new Date(instanteUTC("2026-03-08", "18:00", "America/New_York")).toISOString()).toBe("2026-03-08T22:00:00.000Z");
  });
  it("arma el texto en español en la zona del evento", () => {
    const t = textosFecha(instanteUTC("2026-12-15", "15:30", "America/Caracas"), "America/Caracas");
    expect(t.fecha).toMatch(/martes, 15 de diciembre de 2026/);
    expect(t.mes).toBe("Diciembre");
    expect(t.dia).toBe(15);
  });
  it("arma las semanas del mes con domingo primero", () => {
    const dic = semanasDelMes(2026, 12); // 1 de dic. de 2026 es martes
    expect(dic[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
    expect(dic.flat().filter(Boolean)).toHaveLength(31);
    expect(semanasDelMes(2028, 2).flat().filter(Boolean)).toHaveLength(29);
  });
  it("cuenta lo que falta", () => {
    expect(partesCuentaAtras(90_061_000, 0)).toEqual({ dias: 1, horas: 1, minutos: 1, segundos: 1, listo: false });
    expect(partesCuentaAtras(0, 5).listo).toBe(true);
  });
});

describe("enlaces", () => {
  const ev = { titulo: "Boda de Ana, Luis; y más", descripcion: "Línea 1\nLínea 2", lugar: "Hacienda", inicio: Date.UTC(2026, 11, 15, 19, 30), fin: Date.UTC(2026, 11, 16, 0, 30), uid: "x@y" };
  it("Google Calendar con fechas en UTC", () => {
    const u = new URL(urlGoogleCalendar(ev));
    expect(u.searchParams.get("dates")).toBe("20261215T193000Z/20261216T003000Z");
    expect(u.searchParams.get("text")).toBe(ev.titulo);
  });
  it(".ics válido: CRLF, UTC, texto escapado y líneas de ≤ 75 octetos", () => {
    const c = ics({ ...ev, descripcion: "ñ".repeat(100) }, Date.UTC(2026, 0, 1));
    expect(c.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(c).toContain("DTSTART:20261215T193000Z\r\n");
    expect(c).toContain("SUMMARY:Boda de Ana\\, Luis\\; y más");
    for (const l of c.split("\r\n")) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(plegarIcs("a".repeat(80))).toBe(`${"a".repeat(75)}\r\n ${"a".repeat(5)}`);
    expect(utcCompacto(0)).toBe("19700101T000000Z");
  });
  it("WhatsApp con acentos codificados y mapas por búsqueda", () => {
    const m = mensajeConfirmacion({ evento: "Boda de A", nombre: "José", asiste: true, personas: 2, nota: "¡Felicidades! 🎉" });
    expect(m).toBe("Hola, soy José. Boda de A: Confirmo que SÍ asistiré, somos 2. ¡Gracias por la invitación!\n¡Felicidades! 🎉");
    const u = urlWhatsApp("+58 412", m);
    expect(u.startsWith("https://wa.me/58412?text=")).toBe(true);
    expect(decodeURIComponent(u.split("text=")[1]!)).toBe(m);
    expect(urlMaps({ nombre: "Hacienda", direccion: "Cabudare" })).toBe("https://www.google.com/maps/search/?api=1&query=Hacienda%2C%20Cabudare");
    expect(urlMaps({ nombre: "x", mapa: "https://maps.app.goo.gl/abc" })).toBe("https://maps.app.goo.gl/abc");
  });
  it("reconoce enlaces de Spotify y YouTube", () => {
    expect(leerEnlaceMusica("https://open.spotify.com/intl-es/track/2LlOeW5rVcvl3QcPNPcDus?si=abc")).toEqual({ tipo: "spotify", clase: "track", id: "2LlOeW5rVcvl3QcPNPcDus" });
    expect(leerEnlaceMusica("https://youtu.be/dQw4w9WgXcQ?t=3")).toEqual({ tipo: "youtube", id: "dQw4w9WgXcQ" });
    expect(leerEnlaceMusica("https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ")).toEqual({ tipo: "youtube", id: "dQw4w9WgXcQ" });
    expect(leerEnlaceMusica("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ tipo: "youtube", id: "dQw4w9WgXcQ" });
    expect(leerEnlaceMusica("https://evil.com/open.spotify.com/track/2LlOeW5rVcvl3QcPNPcDus")).toBeNull();
    expect(leerEnlaceMusica("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });
});

describe("compilar", () => {
  it("escapa todo el texto de la persona", () => {
    const { html } = compilar(inv({ nombres: '<script>alert(1)</script> & "Ana"', mensaje: "<img src=x onerror=alert(1)>", lugar: { nombre: "</style><script>x</script>", direccion: undefined } }), { fuentesCss: "" });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("</style><script>x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // Sólo dos <script>: los datos y el de la página.
    expect(html.match(/<script/g)).toHaveLength(2);
  });
  it("no carga nada de afuera salvo el reproductor elegido", () => {
    const sin = compilar(inv(), { fuentesCss: "" }).html;
    expect(sin).not.toMatch(/<(iframe|link|img)[^>]+(src|href)="https?:/);
    expect(sin).not.toMatch(/url\(https?:/);
    const con = compilar(inv({ musica: { tipo: "spotify", clase: "track", id: "2LlOeW5rVcvl3QcPNPcDus" } }), { fuentesCss: "" }).html;
    expect(con).toContain('src="https://open.spotify.com/embed/track/2LlOeW5rVcvl3QcPNPcDus');
  });
  it("lleva los bloques: sello, calendario, cuenta atrás, mapas, confirmación y noindex", () => {
    const { html } = compilar(inv({ dressCode: { colores: ["#4a0d1a"], estilo: "Formal", evitar: "Evitar el blanco" }, pases: 2, confirmarAntes: "2030-11-30" }), { fuentesCss: "" });
    for (const s of ['id="sello"', 'class="mes"', 'aria-current="date"', 'id="c-dias"', "google.com/maps/search", "waze.com/ul", 'id="rsvp"', 'href="invitacion.ics"', "noindex", "Dress code", "Pases para 2 personas", "calendar.google.com"]) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain("og:image");
  });
  it("el script de la página es JavaScript válido y trae las funciones copiadas", () => {
    const { html } = compilar(inv(), { fuentesCss: "" });
    const js = /<script>([\s\S]*)<\/script><\/body>/.exec(html)![1]!;
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain("Confirmo que");
  });
  it("con la URL publicada pone og:image absoluta", () => {
    const i = inv({ urlPublica: "https://ana-luis.netlify.app/index.html" });
    expect(urlOg(i)).toBe("https://ana-luis.netlify.app/portada-og.jpg");
    expect(compilar(i, { fuentesCss: "" }).html).toContain('og:image" content="https://ana-luis.netlify.app/portada-og.jpg"');
  });
  it("compila todas las plantillas con todos los tipos", () => {
    for (const plantilla of PLANTILLAS) for (const tipo of TIPOS) expect(compilar(inv({ plantilla, tipo }), { fuentesCss: "" }).html.length).toBeGreaterThan(5000);
  });
  it("saca iniciales para el sello", () => {
    expect(iniciales("Adeline & Marcos")).toBe("A&M");
    expect(iniciales("ana y luis")).toBe("A&L");
    expect(iniciales("Sofía")).toBe("S");
  });
});

describe("letras y mensajes", () => {
  it("toma sólo el subconjunto latino de Google Fonts", () => {
    const css = `/* cyrillic */\n@font-face { font-family: 'X'; src: url(https://fonts.gstatic.com/a.woff2) format('woff2'); }\n/* latin */\n@font-face { font-family: 'X'; src: url(https://fonts.gstatic.com/b.woff2) format('woff2'); }`;
    expect(bloquesLatinos(css).map((b) => b.url)).toEqual(["https://fonts.gstatic.com/b.woff2"]);
  });
  it("lee los mensajes del modelo y descarta lo que no sirve", () => {
    const crudo = 'ok {"mensajes": ["«Con todo nuestro amor te invitamos a celebrar.»", "corto", "Te esperamos 🎉 con alegría y mucho cariño"]}';
    expect(leerMensajes(crudo)).toEqual(["Con todo nuestro amor te invitamos a celebrar."]);
    expect(leerMensajes("sin json")).toEqual([]);
  });
});

describe("guardar en disco", () => {
  let dir: string;
  const antes = process.env.GEEPER_DATA;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-inv-"));
    process.env.GEEPER_DATA = dir;
  });
  afterAll(async () => {
    if (antes === undefined) delete process.env.GEEPER_DATA;
    else process.env.GEEPER_DATA = antes;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("crea, lista, publica y arma el zip sin el json", async () => {
    const { inv: i } = await guardarInvitacion({ ...base, musicaEnlace: "https://youtu.be/dQw4w9WgXcQ" }, {});
    expect(i.plantilla).toBe("vino-oro");
    expect(i.musica).toEqual({ tipo: "youtube", id: "dQw4w9WgXcQ" });
    expect((await listarInvitaciones()).map((x) => x.slug)).toEqual([i.slug]);
    const pub = path.join(dir, "invitaciones", i.slug, "publicar");
    expect(await fs.readFile(path.join(pub, "invitacion.ics"), "utf8")).toContain("DTSTART:20301215T193000Z");

    await ponerUrlPublica(i.slug, "https://ana.netlify.app/");
    expect((await leerInvitacion(i.slug)).urlPublica).toBe("https://ana.netlify.app/");
    expect(await fs.readFile(path.join(pub, "qr.svg"), "utf8")).toMatch(/^<svg/);
    const zip = unzipSync(new Uint8Array(await fs.readFile(path.join(pub, "invitacion.zip"))));
    expect(Object.keys(zip).sort()).toEqual(["index.html", "invitacion.ics", "qr.png"]);
    expect(Buffer.from(zip["index.html"]!).toString()).toContain("https://ana.netlify.app/portada-og.jpg");

    await ponerUrlPublica(i.slug, null);
    await expect(fs.access(path.join(pub, "qr.svg"))).rejects.toThrow();
  });

  it("no crea con fecha pasada, enlace de música desconocido o audio sin permiso", async () => {
    await expect(guardarInvitacion({ ...base, fecha: "2020-01-01" }, {})).rejects.toThrow(/ya pasó/);
    await expect(guardarInvitacion({ ...base, musicaEnlace: "https://ejemplo.com/cancion" }, {})).rejects.toThrow(/No reconozco/);
    const audio = new File([new Uint8Array(10)], "c.mp3");
    await expect(guardarInvitacion(base, { audio })).rejects.toThrow(/permiso/);
  });

  it("no acepta slugs con rutas", async () => {
    await expect(leerInvitacion("../../etc")).rejects.toThrow(/no encontrada/);
  });
});

describe("tema a medida", () => {
  it("arma un tema sin IA con las palabras de la idea", () => {
    const t = temaPorPalabras("Un bosque encantado con luciérnagas", "boda");
    expect(t).toMatchObject({ nombre: "Bosque encantado", adorno: "hojas", particulas: "luciernagas", fondo: "bruma" });
    expect(t.idea).toBe("Un bosque encantado con luciérnagas");
    expect(temaPorPalabras("bajo el mar con sirenas", "xv").particulas).toBe("burbujas");
    const libre = temaPorPalabras("algo muy mío", "cumpleanos");
    expect(libre.nombre).toBe("Algo muy mío");
    expect(libre.colores.fondo).toBe("#111111");
  });

  it("corrige el contraste del texto y deja los adornos", () => {
    const c = asegurarContraste({ fondo: "#0f2418", fondo2: "#1f4430", tarjeta: "#f4efe2", tinta: "#d8d0c0", claro: "#2a3a2a", acento: "#d8b55b", sobre: "#2f5a3d", sello: "#c9a24a" });
    expect(contraste(c.tinta, c.tarjeta)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(c.claro, "#0f2418")).toBeGreaterThanOrEqual(4.5);
    expect(contraste(c.claro, "#1f4430")).toBeGreaterThanOrEqual(4.5);
    expect(c.acento).toBe("#d8b55b");
  });

  it("recorta y limpia lo que devuelve la IA", () => {
    const base = temaPorPalabras("bosque", "boda");
    const t = normalizarTema({
      nombre: "Un bosque <b>muy</b> encantado y lleno de magia antigua", colores: base.colores, letras: base.letras, adorno: "hongos", particulas: "luciernagas", fondo: "bruma",
      textos: { pista: "Toca el sello", saludo: "Bienvenidos al bosque encantado de los sueños perdidos", cancion: "", faltan: "Faltan", ubicacion: "El claro", dress: "Vestimenta", rsvp: "¿Vienes?", regalos: "Regalos" },
      mensaje: "Te esperamos {entre} los árboles.", dress: ["#112233", "#445566", "#778899", "#aabbcc", "#ddeeff"], dressEstilo: "Verde bosque", imagen: "enchanted forest with glowing fireflies",
    }, "bosque");
    expect(t.nombre.length).toBeLessThanOrEqual(40);
    expect(t.nombre).not.toMatch(/[<>]/);
    expect(t.textos.saludo!.length).toBeLessThanOrEqual(40);
    expect(t.textos.cancion).toBeUndefined();
    expect(t.mensaje).toBe("Te esperamos entre los árboles.");
    expect(t.dress).toHaveLength(4);
  });

  it("el esquema que se manda a la IA entra en la gramática de Ollama", () => {
    expect(() => esquemaParaOllama(TemaIa)).not.toThrow();
    expect(promptTema({ idea: "bosque «encantado»", tipo: "boda", nombres: "Ana" })).toContain("«bosque encantado»");
  });

  it("la página usa los colores, letras, textos, adornos y partículas del tema", () => {
    const t = temaPorPalabras("bosque encantado", "boda");
    const { html } = compilar(inv({ plantilla: "tema", tema: t }), { fuentesCss: "" });
    expect(html).toContain(`--fondo:${t.colores.fondo}`);
    expect(html).toContain("'Cinzel Decorative'");
    expect(html).toContain("Toca el sello y entra al bosque");
    expect(html).toContain("Falta poco para la magia");
    expect(html).toContain('class="esquina e1"');
    expect(html).toContain("canvas");
    expect(html).toContain('"forma":"luz"');
    const js = /<script>([\s\S]*)<\/script><\/body>/.exec(html)![1]!;
    expect(() => new Function(js)).not.toThrow();
  });

  it("los textos del tema también se escapan", () => {
    const t = temaPorPalabras("bosque", "boda");
    const malo = { ...t, nombre: "x", textos: { ...t.textos, saludo: "<img src=x onerror=alert(1)>" } };
    expect(compilar(inv({ plantilla: "tema", tema: malo }), { fuentesCss: "" }).html).not.toContain("<img src=x");
  });

  it("todos los adornos y partículas compilan", () => {
    const t = temaPorPalabras("bosque", "boda");
    for (const adorno of ADORNOS) for (const particulas of PARTICULAS) {
      const { html } = compilar(inv({ plantilla: "tema", tema: { ...t, adorno, particulas } }), { fuentesCss: "" });
      const js = /<script>([\s\S]*)<\/script><\/body>/.exec(html)![1]!;
      expect(() => new Function(js)).not.toThrow();
    }
  });

  it("sin tema guardado cae al estilo recomendado del tipo", () => {
    expect(estiloDe({ plantilla: "tema", tema: undefined, tipo: "boda" }).colores.fondo).toBe("#3b0a14");
  });

  it("guardar pide el tema si se eligió «tema» y lo guarda con contraste corregido", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-tema-"));
    const antes = process.env.GEEPER_DATA;
    process.env.GEEPER_DATA = dir;
    try {
      await expect(guardarInvitacion({ ...base, plantilla: "tema" }, {})).rejects.toThrow(/tema/);
      const t = temaPorPalabras("bosque", "boda");
      const { inv: i } = await guardarInvitacion({ ...base, plantilla: "tema", tema: { ...t, colores: { ...t.colores, tinta: t.colores.tarjeta } } }, {});
      expect(i.tema?.nombre).toBe("Bosque encantado");
      expect(contraste(i.tema!.colores.tinta, i.tema!.colores.tarjeta)).toBeGreaterThanOrEqual(4.5);
      expect((await listarInvitaciones())[0]).toMatchObject({ tema: "Bosque encantado", colores: { fondo: t.colores.fondo } });
      const html = await vistaPrevia({ tipo: "xv", plantilla: "tema", tema: t, nombres: "", lugar: { nombre: "" }, whatsapp: "" });
      expect(html).toContain("Tus nombres");
      expect(html).toContain("entra al bosque");
    } finally {
      if (antes === undefined) delete process.env.GEEPER_DATA;
      else process.env.GEEPER_DATA = antes;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});


describe("imágenes con IA (sin la tarjeta)", () => {
  it("corrige la dirección del panel de Netlify", () => {
    expect(normalizarUrlPublica("https://app.netlify.com/drop/magical-biscotti-f67ab1")).toBe("https://magical-biscotti-f67ab1.netlify.app/");
    expect(normalizarUrlPublica("https://app.netlify.com/sites/ana-luis/deploys")).toBe("https://ana-luis.netlify.app/");
    expect(normalizarUrlPublica(" https://ana.netlify.app/ ")).toBe("https://ana.netlify.app/");
  });

  it("arma el grafo de qr-arte sólo con nodos de fábrica de ComfyUI", () => {
    const g = grafoQrArte({ imagen: "base.png", prompt: "forest", semilla: 7, cantidad: 6, fuerza: 1.35, ruido: 0.9, prefijo: "x" });
    expect(Object.values(g).map((n) => n.class_type).sort()).toEqual(["CLIPTextEncode", "CLIPTextEncode", "CheckpointLoaderSimple", "ControlNetApplyAdvanced", "ControlNetLoader", "KSampler", "LoadImage", "RepeatLatentBatch", "SaveImage", "VAEDecode", "VAEEncode"].sort());
    expect(g["9"].inputs).toMatchObject({ sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 0.9, latent_image: ["8", 0] });
    expect(g["6"].inputs.strength).toBe(1.35);
  });

  it("elige qué dibujar según el estilo", () => {
    expect(arteDe(inv({ plantilla: "tema", tema: temaPorPalabras("bosque encantado", "boda") }))).toMatch(/enchanted forest/);
    expect(arteDe(inv({ plantilla: "tema", tema: { ...temaPorPalabras("bosque", "boda"), imagen: "a castle in the clouds" } }))).toBe("a castle in the clouds");
    expect(arteDe(inv({ plantilla: "jardin" }))).toMatch(/botanical/);
    const a = ajustesFoto("dos anillos de oro", "roses", 5);
    expect(a).toMatchObject({ model_type: "z_image", image_mode: 1, batch_size: 4, seed: 5, resolution: "1216x832" });
    expect(String(a.prompt)).toMatch(/^dos anillos de oro\. Style: roses\..*no text/);
  });

  it("sólo acepta nombres de propuesta conocidos", () => {
    expect(NOMBRE_PROPUESTA.test("qr-123-l3.png")).toBe(true);
    expect(NOMBRE_PROPUESTA.test("foto-1764260000000-2.png")).toBe(true);
    expect(NOMBRE_PROPUESTA.test("../invitacion.json")).toBe(false);
    expect(NOMBRE_PROPUESTA.test("qr-1-l9.png")).toBe(false);
  });

  it.skipIf(!existsSync(FFMPEG))("repara un QR con dibujo al que el dibujo le borró los ojos de las esquinas", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-qr-rep-"));
    try {
      const url = "https://inspiring-malasada-39aaf3.netlify.app";
      await pngQrBase(url, path.join(dir, "qr.png"), 768);
      // Como el dibujo: manchas de color sobre los tres ojos (ahí ya no hay cuadros que la cámara reconozca).
      const manchas = ["0:0", "iw-260:0", "0:ih-260"].map((p) => `drawbox=x=${p.split(":")[0]}+30:y=${p.split(":")[1]}+30:w=200:h=200:color=0x2e7d4f@0.85:t=fill,drawgrid=x=${p.split(":")[0]}+30:y=${p.split(":")[1]}+30:w=25:h=25:t=9:color=0xf0d060@0.9`).join(",");
      correrFfmpeg(["-i", path.join(dir, "qr.png"), "-vf", `format=rgb24,${manchas}`, path.join(dir, "arte.png")]);
      expect(await lecturasQr(path.join(dir, "arte.png"), url)).toBe(0);
      const r = await repararHastaQueSeLea(path.join(dir, "arte.png"), path.join(dir, "reparado.png"), url);
      expect(r?.lecturas).toBeGreaterThanOrEqual(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("si ninguna versión se escanea, hasta dos rondas más con el QR más marcado", () => {
    expect(rondasQr(1.35, 0.9)).toEqual([{ fuerza: 1.35, ruido: 0.9 }, { fuerza: 1.55, ruido: 0.85 }, { fuerza: 1.75, ruido: 0.8 }]);
    expect(rondasQr(1.5, 0.85)).toEqual([{ fuerza: 1.5, ruido: 0.85 }, { fuerza: 1.75, ruido: 0.8 }]);
  });

  it.skipIf(!existsSync(FFMPEG))("un QR oscuro y con poco contraste (como un bosque de noche) se sigue leyendo", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-qr-osc-"));
    try {
      const url = "https://ana-luis.netlify.app/";
      await pngQrBase(url, path.join(dir, "qr.png"), 512);
      // Negro → verde muy oscuro y blanco → verde oscuro (como un bosque de noche).
      await correrFfmpeg(["-i", path.join(dir, "qr.png"), "-vf", "format=rgb24,lutrgb=r=val*0.12+8:g=val*0.18+22:b=val*0.1+10", path.join(dir, "oscuro.png")]);
      expect(await lecturasQr(path.join(dir, "oscuro.png"), url)).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(FFMPEG))("el QR base se lee a todos los tamaños; una imagen sin QR, a ninguno", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-qr-"));
    try {
      const url = "https://magical-biscotti-f67ab1.netlify.app/";
      await pngQrBase(url, path.join(dir, "qr.png"));
      expect(await lecturasQr(path.join(dir, "qr.png"), url)).toBe(4);
      expect(await lecturasQr(path.join(dir, "qr.png"), "https://otra.cosa/")).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(FFMPEG))("usar una propuesta: foto del sobre y QR con dibujo (que se descarta si cambia la dirección)", async () => {
    const datos = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-prop-"));
    const antes = process.env.GEEPER_DATA;
    process.env.GEEPER_DATA = datos;
    try {
      const { inv: i } = await guardarInvitacion(base, {});
      const dir = path.join(datos, "invitaciones", i.slug);
      await fs.mkdir(path.join(dir, "propuestas"), { recursive: true });
      await pngQrBase("https://ana.netlify.app/", path.join(dir, "propuestas", "foto-1764260000000-1.png"), 256);
      await expect(usarPropuesta(i.slug, "qr-5-l4.png")).rejects.toThrow(/dirección/);
      await usarPropuesta(i.slug, "foto-1764260000000-1.png");
      expect((await leerInvitacion(i.slug)).foto).toBe("foto.webp");

      await ponerUrlPublica(i.slug, "https://app.netlify.com/drop/ana-luis");
      expect((await leerInvitacion(i.slug)).urlPublica).toBe("https://ana-luis.netlify.app/");
      await pngQrBase("https://ana-luis.netlify.app/", path.join(dir, "propuestas", "qr-5-l4.png"), 512);
      expect((await leerPropuestas(dir)).qrs).toEqual([{ archivo: "qr-5-l4.png", lecturas: 4 }]);
      await usarPropuesta(i.slug, "qr-5-l4.png");
      expect((await leerInvitacion(i.slug)).qrArte).toEqual({ archivo: "qr-arte.png", url: "https://ana-luis.netlify.app/" });
      const qr = await fs.readFile(path.join(dir, "publicar", "qr.png"));
      expect(qr.equals(await fs.readFile(path.join(dir, "propuestas", "qr-5-l4.png")))).toBe(true);

      const { avisos } = await ponerUrlPublica(i.slug, "https://otra.netlify.app/");
      expect(avisos.join(" ")).toMatch(/QR con dibujo/);
      expect((await leerInvitacion(i.slug)).qrArte).toBeUndefined();
      expect(await lecturasQr(path.join(dir, "publicar", "qr.png"), "https://otra.netlify.app/")).toBe(4);
    } finally {
      if (antes === undefined) delete process.env.GEEPER_DATA;
      else process.env.GEEPER_DATA = antes;
      await fs.rm(datos, { recursive: true, force: true });
    }
  });
});
