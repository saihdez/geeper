import path from "node:path";
import { describe, expect, it } from "vitest";
import { archivoBlender } from "@/lib/blender";
import {
  adivinarEscena, archivosCorrida3d, argsVideo3d, cifrasDe, faltaEnPedido, leerCuadro, normalizarSugerencia, Pedido3d, pedidoParaBlender, promptEscena, textoCitado, tituloDe,
  type Corrida3d,
} from "@/lib/escenas3d";
import { INFO_PLANTILLAS, minutosEstimados, PALETAS_3D, PLANTILLAS_3D } from "@/lib/escenas3d-catalogo";
import { sumaEsperada } from "@/lib/instalar-craft";
import { archivoRhubarb } from "@/lib/rhubarb";

const colores = { fondo: "#101010", fondo2: null, principal: "#ff0000", acento: "#ffffff" };
const pedido = (x: Partial<Pedido3d> = {}) => Pedido3d.parse({ plantilla: "texto", colores, ...x });

describe("Pedido3d", () => {
  it("pone valores por defecto razonables", () => {
    const p = pedido({ texto: "Hola" });
    expect(p).toMatchObject({ estilo: "brillante", movimiento: "entra", formato: "9:16", duracion: 5, calidad: "normal", archivo: null });
  });
  it("rechaza colores que no son #RRGGBB y duraciones fuera de rango", () => {
    expect(() => pedido({ colores: { ...colores, fondo: "red" } })).toThrow();
    expect(() => pedido({ duracion: 90 })).toThrow();
    expect(() => pedido({ archivo: "../../etc/passwd" })).toThrow();
  });
});

describe("faltaEnPedido", () => {
  it("pide lo obligatorio de cada plantilla", () => {
    expect(faltaEnPedido(pedido({ texto: "  " }))).toMatch(/texto/);
    expect(faltaEnPedido(pedido({ plantilla: "producto" }))).toMatch(/foto/);
    expect(faltaEnPedido(pedido({ plantilla: "logo" }))).toMatch(/logo/);
    expect(faltaEnPedido(pedido({ plantilla: "fondo" }))).toBeNull();
    expect(faltaEnPedido(pedido({ plantilla: "caja" }))).toBeNull();
  });
  it("revisa el tipo de archivo según la plantilla", () => {
    expect(faltaEnPedido(pedido({ plantilla: "logo", archivo: "entrada.svg" }))).toBeNull();
    expect(faltaEnPedido(pedido({ plantilla: "logo", archivo: "entrada.jpg" }))).toMatch(/SVG o PNG/);
    expect(faltaEnPedido(pedido({ plantilla: "producto", archivo: "entrada.svg" }))).toMatch(/PNG, JPG/);
    expect(faltaEnPedido(pedido({ plantilla: "producto", archivo: "entrada.webp" }))).toBeNull();
  });
});

describe("tituloDe", () => {
  it("usa el nombre de la plantilla y el texto, recortado", () => {
    expect(tituloDe(pedido({ texto: "Gran  apertura" }))).toBe("Título en 3D: «Gran apertura»");
    expect(tituloDe(pedido({ plantilla: "fondo" }))).toBe("Fondo en movimiento");
    expect(tituloDe(pedido({ texto: "x".repeat(60) }))).toMatch(/…»$/);
  });
});

describe("pedidoParaBlender", () => {
  const op = { dir: "/datos/escenas-3d/a", cuadros: "/tmp/c", hdri: null, dispositivo: "gpu" as const };
  it("el archivo va como logo en la plantilla de logo y como imagen en las demás", () => {
    const l = pedidoParaBlender(pedido({ plantilla: "logo", archivo: "entrada.svg" }), op);
    expect(l.logo).toBe(path.join("/datos/escenas-3d/a", "entradas", "entrada.svg"));
    expect(l.imagen).toBeNull();
    const p = pedidoParaBlender(pedido({ plantilla: "producto", archivo: "entrada.png" }), op);
    expect(p.imagen).toBe(path.join("/datos/escenas-3d/a", "entradas", "entrada.png"));
    expect(p.logo).toBeNull();
  });
  it("sin archivo no manda rutas", () => {
    const t = pedidoParaBlender(pedido({ texto: "Hola" }), op);
    expect(t).toMatchObject({ imagen: null, logo: null, dispositivo: "gpu", cuadros: "/tmp/c", texto: "Hola" });
  });
});

describe("leerCuadro", () => {
  it("lee el avance que imprime escena3d.py", () => {
    expect(leerCuadro("GEEPER_CUADRO 12 150")).toEqual({ n: 12, total: 150 });
    expect(leerCuadro("Fra:12 Mem:1.2M")).toBeNull();
  });
});

describe("«Descríbelo y lo armo» por palabras", () => {
  it("elige la plantilla por lo que se pide", () => {
    expect(adivinarEscena("mi logo girando en metal").plantilla).toBe("logo");
    expect(adivinarEscena("una caja de regalo que revele el premio").plantilla).toBe("caja");
    expect(adivinarEscena("mi perfume en un pedestal con el precio").plantilla).toBe("producto");
    expect(adivinarEscena("fondo de partículas brillantes").plantilla).toBe("fondo");
    expect(adivinarEscena("un título que diga Hola").plantilla).toBe("texto");
  });
  it("saca el texto entre comillas o después de «que diga»", () => {
    expect(textoCitado("un título que diga «Gran apertura»")).toBe("Gran apertura");
    expect(textoCitado('título "Promo 2x1" rojo')).toBe("Promo 2x1");
    expect(textoCitado("un título dorado que diga Hasta mañana.")).toBe("Hasta mañana");
    expect(textoCitado("algo bonito")).toBe("");
  });
  it("entiende colores, material y movimiento", () => {
    const s = adivinarEscena("un título rojo de metal que caiga rebotando, fondo negro, que diga «Ya»");
    expect(s.colores.principal).toBe("#e63946");
    expect(s.colores.fondo).toBe("#0a0a0a");
    expect(s.colores.fondo2).toBeNull();
    expect(s).toMatchObject({ estilo: "metal", movimiento: "rebota", texto: "Ya", origen: "palabras" });
  });
  it("las tildes no cambian nada", () => {
    expect(adivinarEscena("fondo de PARTÍCULAS").estilo_fondo).toBe("particulas");
  });
  it("sin pistas usa una paleta lista", () => {
    expect(adivinarEscena("algo bonito").colores).toEqual(PALETAS_3D[0]!.colores);
  });
});

describe("normalizarSugerencia", () => {
  const base = adivinarEscena("un título que diga «Hola»");
  it("si el modelo no devuelve JSON, se queda con lo de las palabras", () => {
    expect(normalizarSugerencia("no sé", base)).toEqual(base);
  });
  it("toma lo válido del modelo y descarta lo inválido", () => {
    const r = normalizarSugerencia(
      'Aquí va: {"plantilla":"caja","texto":"Otro","estilo":"plastilina","movimiento":"rebota","colores":{"fondo":"#000000","principal":"azul","acento":"#FFD166","fondo2":null},"explicacion":"Entendí: una caja."}',
      base,
    );
    expect(r.plantilla).toBe("caja");
    expect(r.estilo).toBe(base.estilo);
    expect(r.movimiento).toBe("rebota");
    expect(r.colores).toEqual({ fondo: "#000000", fondo2: null, principal: base.colores.principal, acento: "#ffd166" });
    expect(r.origen).toBe("ia");
    expect(r.explicacion).toBe("Entendí: una caja.");
  });
  it("el texto entre comillas de la persona manda sobre el del modelo", () => {
    expect(normalizarSugerencia('{"texto":"Inventado"}', base).texto).toBe("Hola");
    const sinTexto = adivinarEscena("un título bonito");
    expect(normalizarSugerencia('{"texto":"Bienvenidos"}', sinTexto).texto).toBe("Bienvenidos");
  });
  it("una plantilla que no existe no pasa", () => {
    expect(normalizarSugerencia('{"plantilla":"nave-espacial"}', base).plantilla).toBe("texto");
  });
});

describe("promptEscena", () => {
  it("nombra todas las plantillas y pide no escribir código", () => {
    const p = promptEscena("algo");
    for (const id of PLANTILLAS_3D) expect(p).toContain(`- ${id}:`);
    expect(p).toMatch(/No escribas código/);
  });
});

describe("catálogo", () => {
  it("cada plantilla tiene su información y lo obligatorio está entre sus campos", () => {
    for (const id of PLANTILLAS_3D) {
      const i = INFO_PLANTILLAS[id];
      expect(i.id).toBe(id);
      for (const o of i.obligatorios) expect(i.campos).toContain(o);
    }
  });
  it("estima minutos según calidad, duración y si hay tarjeta", () => {
    expect(minutosEstimados("rapida", 5)).toBe(1);
    expect(minutosEstimados("normal", 10)).toBe(6);
    expect(minutosEstimados("normal", 5, false)).toBe(30);
  });
});

describe("archivoBlender", () => {
  it("elige el archivo oficial de cada sistema", () => {
    expect(archivoBlender("windows", "x64", "5.2.5")).toMatchObject({ archivo: "blender-5.2.5-windows-x64.zip", raiz: "blender-5.2.5-windows-x64", ejecutable: "blender.exe" });
    expect(archivoBlender("linux", "x64", "5.2.5")).toMatchObject({ archivo: "blender-5.2.5-linux-x64.tar.xz", extraer: "tar-auto" });
    expect(archivoBlender("mac", "arm64", "5.2.5")).toMatchObject({ archivo: "blender-5.2.5-macos-arm64.dmg", extraer: "dmg" });
    expect(archivoBlender("mac", "x64", "5.2.5")).toBeNull();
    expect(archivoBlender("linux", "arm64", "5.2.5")).toBeNull();
  });
  it("la suma se lee del archivo .sha256 de blender.org", () => {
    const sumas = [
      "1fad54a676c3bb08fdcb5a2ae1eaaf02f8c492af02bd5ca292bcdbb28b6bb29a  blender-5.2.5-windows-x64.zip",
      "6a93f1316ea794dec3027129fbc05f48b368184be25a8f993dd0301a6020a204  blender-5.2.5-linux-x64.tar.xz",
    ].join("\n");
    expect(sumaEsperada(sumas, "blender-5.2.5-linux-x64.tar.xz")).toBe("6a93f1316ea794dec3027129fbc05f48b368184be25a8f993dd0301a6020a204");
  });
});

describe("gráficos con datos", () => {
  it("pide números y revisa lo que necesita cada tipo", () => {
    expect(faltaEnPedido(pedido({ plantilla: "datos" }))).toMatch(/número/);
    expect(faltaEnPedido(pedido({ plantilla: "datos", tipo_datos: "pastel", datos: [{ etiqueta: "A", valor: 3 }] }))).toMatch(/dos partes/);
    expect(faltaEnPedido(pedido({ plantilla: "datos", tipo_datos: "pastel", datos: [{ etiqueta: "A", valor: 3 }, { etiqueta: "B", valor: -1 }] }))).toMatch(/negativos/);
    expect(faltaEnPedido(pedido({ plantilla: "datos", datos: [{ etiqueta: "A", valor: 0 }] }))).toMatch(/mayor que cero/);
    expect(faltaEnPedido(pedido({ plantilla: "datos", tipo_datos: "numero", datos: [{ etiqueta: "", valor: 87 }], unidad: "%" }))).toBeNull();
  });
  it("no acepta más de 6 filas", () => {
    expect(() => pedido({ plantilla: "datos", datos: Array.from({ length: 7 }, (_, i) => ({ etiqueta: `${i}`, valor: i })) })).toThrow();
  });
  it("saca las cifras escritas con su nombre y unidad", () => {
    expect(cifrasDe("enero 120, febrero 340 y marzo 1,200")).toEqual({ datos: [{ etiqueta: "enero", valor: 120 }, { etiqueta: "febrero", valor: 340 }, { etiqueta: "marzo", valor: 1200 }], unidad: "" });
    expect(cifrasDe("el 87% de los clientes")).toEqual({ datos: [{ etiqueta: "", valor: 87 }], unidad: "%" });
    expect(cifrasDe("crecimos 3,5 por ciento").unidad).toBe("%");
    expect(cifrasDe("sin números")).toEqual({ datos: [], unidad: "" });
  });
  it("una descripción con cifras arma un gráfico", () => {
    const s = adivinarEscena("un gráfico de barras: enero 120, febrero 340, marzo 510");
    expect(s.plantilla).toBe("datos");
    expect(s.tipo_datos).toBe("barras");
    expect(s.datos.map((d) => d.valor)).toEqual([120, 340, 510]);
    expect(adivinarEscena("anillo: ahorro 30, gastos 70").tipo_datos).toBe("pastel");
    // Un precio no es un gráfico.
    expect(adivinarEscena("mi perfume en un pedestal con el precio 19.99").plantilla).toBe("producto");
  });
  it("el modelo no puede inventar cifras", () => {
    const base = adivinarEscena("gráfico: enero 120, febrero 340");
    const inventadas = normalizarSugerencia('{"plantilla":"datos","datos":[{"etiqueta":"Enero","valor":999}]}', base);
    expect(inventadas.datos).toEqual(base.datos);
    const mismas = normalizarSugerencia('{"plantilla":"datos","datos":[{"etiqueta":"Ene","valor":120},{"etiqueta":"Feb","valor":340}]}', base);
    expect(mismas.datos.map((d) => d.etiqueta)).toEqual(["Ene", "Feb"]);
  });
  it("manda los datos y el fondo a Blender", () => {
    const op = { dir: "/d", cuadros: "/c", hdri: null, dispositivo: "cpu" as const };
    const b = pedidoParaBlender(pedido({ plantilla: "datos", datos: [{ etiqueta: "A", valor: 1 }], unidad: "%", fondo_salida: "foto", archivo_fondo: "fondo.jpg", salida: "imagen" }), op);
    expect(b).toMatchObject({ tipo_datos: "barras", datos: [{ etiqueta: "A", valor: 1 }], unidad: "%", salida: "imagen", transparente: false, fondo_imagen: path.join("/d", "entradas", "fondo.jpg") });
    expect(pedidoParaBlender(pedido({ fondo_salida: "transparente" }), op)).toMatchObject({ transparente: true, fondo_imagen: null });
  });
});

describe("salidas", () => {
  const corrida = (x: Partial<Pedido3d>, estado: Corrida3d["estado"] = "hecha"): Corrida3d => ({ id: "a", titulo: "t", creada: "", estado, pedido: pedido(x) });
  it("una foto de fondo hace falta si se eligió", () => {
    expect(faltaEnPedido(pedido({ texto: "Hola", fondo_salida: "foto" }))).toMatch(/foto de fondo/);
  });
  it("dice qué archivos deja cada salida", () => {
    expect(archivosCorrida3d(corrida({ texto: "x" }))).toEqual({ video: "escenas-3d/a/video.mp4", transparente: null, imagen: null, portada: "escenas-3d/a/portada.jpg" });
    expect(archivosCorrida3d(corrida({ texto: "x", fondo_salida: "transparente" })).transparente).toBe("escenas-3d/a/video-transparente.webm");
    expect(archivosCorrida3d(corrida({ texto: "x", salida: "imagen" }))).toMatchObject({ video: null, imagen: "escenas-3d/a/imagen.png" });
    expect(archivosCorrida3d(corrida({ texto: "x" }, "fallida")).video).toBeNull();
  });
  it("una imagen tarda un minuto", () => {
    expect(minutosEstimados("alta", 15, true, "imagen")).toBe(1);
  });
});

describe("personaje que habla", () => {
  it("pide lo que dice o una grabación", () => {
    expect(faltaEnPedido(pedido({ plantilla: "personaje" }))).toMatch(/dice el personaje/);
    expect(faltaEnPedido(pedido({ plantilla: "personaje", dialogo: "Hola" }))).toBeNull();
    expect(faltaEnPedido(pedido({ plantilla: "personaje", archivo_voz: "voz-subida.mp3" }))).toBeNull();
    expect(faltaEnPedido(pedido({ plantilla: "personaje", archivo_voz: "voz-subida.exe" }))).toMatch(/MP3/);
    expect(() => pedido({ plantilla: "personaje", voz: "../x" })).toThrow();
  });
  it("el título dice quién habla y qué dice", () => {
    expect(tituloDe(pedido({ plantilla: "personaje", personaje: "robot", dialogo: "Hola a todos" }))).toBe("Robot que habla: «Hola a todos»");
  });
  it("con voz, Blender recibe la voz, la boca y dura lo que la voz", () => {
    const op = { dir: "/d", cuadros: "/c", hdri: null, dispositivo: "gpu" as const, voz: { wav: "/d/voz.wav", boca: [{ start: 0, end: 0.2, value: "B" as const }], segundos: 4.2 } };
    expect(pedidoParaBlender(pedido({ plantilla: "personaje", dialogo: "Hola" }), op)).toMatchObject({ personaje: "bolita", audio: "/d/voz.wav", boca: [{ value: "B" }], duracion: 4.7 });
    expect(pedidoParaBlender(pedido({ plantilla: "personaje", dialogo: "Hola" }), { ...op, voz: { ...op.voz, segundos: 300 } }).duracion).toBe(60);
  });
  it("el MP4 lleva la voz y, con alfa, se apoya sobre el color", () => {
    const entrada = ["-i", "c_%04d.png"];
    const conVoz = argsVideo3d(entrada, null, "/v.mp3", "/o.mp4");
    expect(conVoz).toEqual(expect.arrayContaining(["-i", "/v.mp3", "-map", "1:a", "-c:a", "aac"]));
    expect(conVoz.join(" ")).toMatch(/-map 0:v -pix_fmt yuv420p/);
    const alfa = argsVideo3d(entrada, "#14213d", null, "/o.mp4").join(" ");
    expect(alfa).toMatch(/color=0x14213d@1/);
    expect(alfa).toMatch(/-map \[v\]/);
    expect(alfa).not.toMatch(/1:a/);
  });
  it("Rhubarb: el zip oficial de cada sistema con su suma", () => {
    expect(archivoRhubarb("windows")).toMatchObject({ archivo: "Rhubarb-Lip-Sync-1.14.0-Windows.zip", ejecutable: "rhubarb.exe" });
    expect(archivoRhubarb("linux")?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(archivoRhubarb("linux", "9.9.9")).toBeNull();
  });
});
