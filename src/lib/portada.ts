/**
 * Portada diseñada (BRECHAS.md D1, docs/PHOTOCRAFT.md §2): la imagen limpia de una escena (el clip de
 * origen, sin subtítulos) + título + marca sobre un diseño, compuesta con PhotoCraft sin ventana y sin GPU.
 * El diseño es un PSD propio del canal (`portada.plantillas[formato]`) o uno de los estilos base, que Geeper
 * arma con los colores y fuentes del canal. Se crean hasta 3 opciones (una por título) y la persona elige.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { escribirAtomico, existe, sha256Texto } from "./archivos";
import { textoSobre } from "./colores-marca";
import { db } from "./db";
import type { Asset, Formato, Proyecto } from "./esquema";
import { escenasEnLinea } from "./linea";
import { ffmpeg } from "./media";
import { cli, componer, leerCapas, variablesDe, type Capa, type Paso, type Resultado } from "./photocraft";
import { obtenerPlantilla, type DatosPlantilla } from "./plantillas";
import { versionDeProyecto } from "./render";
import { filtroRecorte, medirContrasteTitulo, revisarPortada, ZONA_RELOJ, type Caja, type RevisionPortada } from "./revisar-portada";
import { dirDatos, dirProyecto, PHOTOCRAFT_VERSION } from "./rutas";
import type { Propuesta } from "./titulos";

/** Medidas de la portada: 1280×720 es lo que pide YouTube; vertical y cuadrada al tamaño del video. */
export function medidasPortada(f: Formato): { ancho: number; alto: number } {
  if (f === "16:9") return { ancho: 1280, alto: 720 };
  if (f === "9:16") return { ancho: 1080, alto: 1920 };
  return { ancho: 1080, alto: 1080 };
}

export const ESTILOS_PORTADA = {
  abajo: { nombre: "Título abajo", descripcion: "La imagen entera y el título grande abajo, sobre una sombra" },
  centro: { nombre: "Título al centro", descripcion: "Imagen oscurecida y el título centrado, muy legible" },
  banda: { nombre: "Banda de color", descripcion: "Una franja con el color de tu marca y el título encima" },
} as const;
export type EstiloPortada = keyof typeof ESTILOS_PORTADA;

/** Versión del diseño de las plantillas base: cambiarla regenera las bases guardadas. */
const DISENO_BASE = 4;

/** Negro o blanco, lo que se lea mejor sobre un color `#rrggbb` (luminancia WCAG). */
export function tintaSobre(hex: string): "#ffffff" | "#111111" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) ?? /^#?([0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? "#ffffff" : "#111111";
}

/**
 * Pasos que arman una plantilla base (función pura). `hueco` es un PNG llamado `@imagen.png`: al colocarlo,
 * la capa toma ese nombre, y se rasteriza para que la imagen se reemplace cubriendo y recortando al centro.
 */
export function pasosPlantillaBase(
  f: Formato,
  d: Pick<DatosPlantilla, "colores" | "tipografia" | "marca">,
  hueco: string,
  estilo: EstiloPortada = "abajo",
): { nuevo: Record<string, unknown>; pasos: Paso[] } {
  const { ancho, alto } = medidasPortada(f);
  const vertical = f === "9:16";
  const m = Math.round(ancho * (vertical ? 0.074 : 0.047)); // margen
  const titulo = f === "16:9" ? 84 : vertical ? 112 : 92;
  const marca = Math.round(titulo * 0.4);
  const pie = vertical ? Math.round(alto * 0.14) : 0; // en 9:16, por encima de los botones de la app
  // En 16:9, YouTube pone la duración abajo a la derecha: el título no llega a esa esquina.
  const reloj = f === "16:9" ? { y: Math.round(alto * ZONA_RELOJ.y) - 8, x: Math.round(ancho * ZONA_RELOJ.x) - 8 } : null;
  const fuente = { font: d.tipografia.titulos, weight: 800, size: titulo };
  const imagen: Paso[] = [
    { cmd: "file.placeEmbedded", params: { path: hueco } },
    { cmd: "layer.rasterize.layer", params: {} },
  ];
  const marcaTexto = (color: string, align: "left" | "center"): Paso => ({
    cmd: "type.create",
    params: align === "center"
      ? { box: [m, m, ancho - 2 * m, marca * 2], text: d.marca.texto || "MARCA", name: "@marca", font: d.tipografia.texto, weight: 700, size: marca, color, align: "center" }
      : { x: m, y: m + marca, text: d.marca.texto || "MARCA", name: "@marca", font: d.tipografia.texto, weight: 700, size: marca, color },
  });
  // La marca va sobre la sombra oscura (sobre la foto): si el acento no se lee ahí, casi blanco o negro.
  const marcaLegible = textoSobre(["#333333"], d.colores.acento1);
  const nuevo = { width: ancho, height: alto, background: "#0b0b12", name: `portada-${estilo}` };
  // Sombra suave arriba para que la marca se lea sobre cielos claros.
  const sombraArriba: Paso = { cmd: "layer.newFillLayer.gradient", params: { from: "#000000", to: "#000000", angle: 90, transparency: [[vertical ? 0.86 : 0.78, 0], [1, 60]] } };

  if (estilo === "centro") {
    const cajaAlto = Math.round(alto * (vertical ? 0.32 : 0.5));
    return {
      nuevo,
      pasos: [
        ...imagen,
        // Oscurece toda la imagen por igual.
        { cmd: "layer.newFillLayer.gradient", params: { from: "#000000", to: "#000000", angle: 90, transparency: [[0, 55], [1, 55]] } },
        { cmd: "type.create", params: { box: [m, Math.round((alto - cajaAlto) / 2 - alto * 0.03), ancho - 2 * m, cajaAlto], text: "TÍTULO", name: "@titulo", ...fuente, color: d.colores.tinta, align: "center" } },
        marcaTexto(marcaLegible, "center"),
      ],
    };
  }
  if (estilo === "banda") {
    const banda = vertical ? 0.36 : 0.4; // fracción de alto, desde abajo
    const bandaAlto = Math.round(alto * banda);
    const top = alto - bandaAlto;
    const cajaAlto = bandaAlto - pie - Math.round(m * 1.2);
    return {
      nuevo,
      pasos: [
        ...imagen,
        // Franja sólida del color de la marca: degradado con un corte duro.
        { cmd: "layer.newFillLayer.gradient", params: { from: d.colores.acento1, to: d.colores.acento1, angle: 90, transparency: [[0, 100], [banda, 100], [banda + 0.002, 0]] } },
        sombraArriba,
        { cmd: "type.create", params: { box: [m, top + Math.round(m * 0.6), (reloj ? reloj.x : ancho - m) - m, cajaAlto], text: "TÍTULO", name: "@titulo", ...fuente, color: tintaSobre(d.colores.acento1), align: "left" } },
        marcaTexto(d.colores.tinta, "left"),
      ],
    };
  }
  const altoBase = Math.round(alto * (vertical ? 0.27 : 0.39));
  const fondo = alto - (vertical ? pie : Math.round(m * 0.8));
  const cajaY = fondo - altoBase;
  // Misma altura de arranque; en 16:9 la caja termina antes de la esquina de la duración (2 líneas).
  const cajaAlto = (reloj ? Math.min(fondo, reloj.y) : fondo) - cajaY;
  return {
    nuevo,
    pasos: [
      ...imagen,
      // Oscurece la parte de abajo para que el título se lea sobre cualquier imagen.
      { cmd: "layer.newFillLayer.gradient", params: { from: "#000000", to: "#000000", angle: 90, transparency: [[0, 92], [vertical ? 0.5 : 0.4, 70], [vertical ? 0.78 : 0.7, 0]] } },
      sombraArriba,
      { cmd: "type.create", params: { box: [m, cajaY, ancho - 2 * m, cajaAlto], text: "TÍTULO", name: "@titulo", ...fuente, color: d.colores.tinta, align: "left" } },
      marcaTexto(marcaLegible, "left"),
    ],
  };
}

/** Plantilla base de este canal, formato y estilo (se arma una vez y se reutiliza mientras no cambie). */
export async function plantillaBase(slug: string, f: Formato, d: DatosPlantilla, estilo: EstiloPortada = d.portada.estilo): Promise<string> {
  const clave = sha256Texto(JSON.stringify({ DISENO_BASE, PHOTOCRAFT_VERSION, f, estilo, c: d.colores, t: d.tipografia, m: d.marca.texto })).slice(0, 12);
  const dir = path.join(dirDatos(), "portadas", "plantillas");
  const destino = path.join(dir, `${slug}-${f.replace(":", "x")}-${estilo}-${clave}.psd`);
  if (await existe(destino)) return destino;
  // Carpeta temporal propia de esta llamada: dos portadas a la vez no se pisan; el rename final es atómico.
  await fs.mkdir(dir, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(dir, ".tmp-"));
  try {
    const hueco = path.join(tmpDir, "@imagen.png");
    const { ancho, alto } = medidasPortada(f);
    await ffmpeg(["-v", "error", "-f", "lavfi", "-i", `color=c=0x2a2a33:s=${ancho}x${alto}`, "-frames:v", "1", hueco]);
    const { nuevo, pasos } = pasosPlantillaBase(f, d, hueco, estilo);
    const tmp = path.join(tmpDir, "base.psd");
    await cli(["run", "--new", JSON.stringify(nuevo), "--no-gpu", ...pasos.flatMap((p) => ["--cmd", p.cmd, "--params", JSON.stringify(p.params)]), "--out", tmp]);
    await fs.rename(tmp, destino);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
  return destino;
}

/**
 * Recorta la imagen a la proporción de un objeto inteligente, que si no la deformaría: al centro, o en
 * torno a la cara si el clip tiene una estable (así no queda cortada).
 */
async function recortarA(ruta: string, capa: Capa, dir: string, foco?: { x: number; y: number } | null): Promise<string> {
  if (!capa.limites) return ruta;
  const [, , w, h] = capa.limites;
  if (w <= 0 || h <= 0) return ruta;
  const salida = path.join(dir, `recorte-${capa.id}.png`);
  await ffmpeg(["-v", "error", "-i", ruta, "-vf", filtroRecorte(w, h, foco), "-frames:v", "1", salida]);
  return salida;
}

/**
 * De dónde sacar la imagen del segundo `t` del video (función pura): el asset del clip visual de esa
 * escena, no el render, que trae subtítulos y el chip de marca quemados. Si el clip es más corto que la
 * escena vuelve a empezar, como en el render.
 */
export function origenDeFotograma(p: Proyecto, t: number): { ruta: string; tipo: "video" | "imagen"; segundo: number; escena: number; foco: { x: number; y: number } | null } {
  const escenas = escenasEnLinea(p);
  if (!escenas.length) throw new Error("El proyecto no tiene escenas");
  const e = escenas.find((x) => t >= x.inicio && t < x.inicio + x.duracion) ?? (t < escenas[0]!.inicio ? escenas[0]! : escenas.at(-1)!);
  const a = p.assets[e.visual.asset];
  if (!a || a.tipo === "audio") throw new Error(`La escena ${e.indice + 1} no tiene un asset visual`);
  const foco = focoEstable(a.foco);
  if (a.tipo === "imagen") return { ruta: a.ruta, tipo: "imagen", segundo: 0, escena: e.indice, foco };
  const dentro = Math.max(0, Math.min(t - e.inicio, e.duracion)) * (e.visual.velocidad ?? 1);
  const largo = Math.min(e.visual.rango.duracion, a.duracion ?? Infinity);
  const segundo = e.visual.rango.inicio + (largo > 0 && Number.isFinite(largo) ? dentro % largo : dentro);
  return { ruta: a.ruta, tipo: "video", segundo: +segundo.toFixed(3), escena: e.indice, foco };
}

/**
 * La cara sirve de foco del recorte si aparece en la mitad de las muestras o más y casi no se mueve
 * (el foco es la mediana del clip: con una cara que va y viene, el fotograma elegido podría no tenerla).
 */
export function focoEstable(f: Asset["foco"]): { x: number; y: number } | null {
  return f && f.cobertura >= 0.5 && f.dispersion <= 0.12 ? { x: f.x, y: f.y } : null;
}

/** Una imagen candidata por escena (la mitad de cada escena), para la galería (función pura). */
export function imagenesPorEscena(p: Proyecto): { escena: number; t: number; ruta: string; tipo: "video" | "imagen"; segundo: number; foco: { x: number; y: number } | null }[] {
  return escenasEnLinea(p).map((e) => {
    const t = +(e.inicio + e.duracion / 2).toFixed(3);
    return { ...origenDeFotograma(p, t), t };
  });
}

export interface MetaPortada extends Resultado {
  archivo: string;
  titulo: string;
  /** Escena (índice desde 0) y segundo del video de los que salió la imagen. */
  escena: number;
  segundo: number;
  /** Asset del que salió la imagen (procedencia). */
  origen: string;
  plantilla: string;
  estilo: EstiloPortada | "propio";
  version: number;
  motor: string;
  creada: string;
  /** Revisión medida (letra en chico, contraste, esquina de la duración); falta en portadas viejas. */
  revision?: RevisionPortada;
}

export interface EstadoPortada {
  elegida: MetaPortada | null;
  opciones: MetaPortada[];
  /** Últimos títulos propuestos (para no volver a pedirlos a la IA cada vez que se abre el panel). */
  titulos: Propuesta | null;
}

const RUTA_ESTADO = (slug: string) => path.join(dirProyecto(slug), "portada", "portada.json");

export async function leerPortada(slug: string): Promise<EstadoPortada> {
  try {
    const d = JSON.parse(await fs.readFile(RUTA_ESTADO(slug), "utf8")) as Partial<EstadoPortada> & { archivo?: string };
    // Formato del 2026-11-19 (una sola portada): es la elegida.
    if (typeof d.archivo === "string") {
      const vieja = d as unknown as Partial<MetaPortada>;
      return { elegida: { ...(vieja as MetaPortada), escena: vieja.escena ?? 0, estilo: vieja.estilo ?? "abajo" }, opciones: [], titulos: null };
    }
    return { elegida: d.elegida ?? null, opciones: d.opciones ?? [], titulos: d.titulos ?? null };
  } catch {
    return { elegida: null, opciones: [], titulos: null };
  }
}

async function guardarEstado(slug: string, e: EstadoPortada): Promise<void> {
  await escribirAtomico(RUTA_ESTADO(slug), JSON.stringify(e, null, 2));
}

export async function guardarTitulos(slug: string, t: Propuesta): Promise<void> {
  await guardarEstado(slug, { ...(await leerPortada(slug)), titulos: t });
}

/**
 * Lo que hace falta para componer: el proyecto en su versión actual (la misma que muestra la galería, así
 * el número de escena coincide), la plantilla y el diseño. No hace falta haber renderizado.
 */
async function contexto(proyectoId: string) {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const numero = fila.versionActual;
  if (numero < 1) throw new Error("El video todavía se está preparando: la portada se crea cuando tenga escenas.");
  const { p } = await versionDeProyecto(proyectoId, numero);
  const { datos } = await obtenerPlantilla(fila.plantilla);
  return { fila, p, numero, datos, dir: dirProyecto(fila.slug), formato: fila.formato as Formato };
}

/**
 * Crea una opción de portada por título (hasta 3) con la imagen de la escena elegida. Reemplaza las
 * opciones anteriores; la elegida no cambia hasta que la persona elija otra.
 */
export async function crearOpciones(proyectoId: string, op: { titulos: string[]; escena?: number; estilo?: EstiloPortada }): Promise<EstadoPortada> {
  const titulos = [...new Set(op.titulos.map((t) => t.trim()).filter(Boolean))].slice(0, 3);
  if (!titulos.length) throw new Error("Escribe al menos un título");
  const { fila, p, numero, datos, dir, formato } = await contexto(proyectoId);
  const propia = datos.portada.plantillas[formato];
  const estilo = op.estilo ?? datos.portada.estilo;
  const plantilla = propia ?? (await plantillaBase(fila.plantilla, formato, datos, estilo));
  if (!(await existe(plantilla))) throw new Error("No se encuentra el diseño de portada propio del canal. Revísalo en Plantillas.");

  const candidatas = imagenesPorEscena(p);
  const elegida = candidatas[Math.min(Math.max(0, op.escena ?? Math.floor(candidatas.length * 0.3)), candidatas.length - 1)]!;
  const carpeta = path.join(dir, "portada");
  await fs.mkdir(path.join(carpeta, "opciones"), { recursive: true });
  // Carpeta temporal propia de esta llamada (dos clics o dos pestañas no se pisan).
  const trabajo = await fs.mkdtemp(path.join(carpeta, ".tmp-"));
  try {
    const rutaOrigen = path.join(dir, elegida.ruta);
    const imagen = elegida.tipo === "imagen" ? rutaOrigen : path.join(trabajo, "fotograma.png");
    if (elegida.tipo === "video") await ffmpeg(["-v", "error", "-ss", elegida.segundo.toFixed(3), "-i", rutaOrigen, "-frames:v", "1", imagen]);

    const guia = await guiaRevision(plantilla, propia ? null : pasosPlantillaBase(formato, datos, "@imagen.png", estilo).pasos);
    const sello = Date.now().toString(36);
    const opciones: MetaPortada[] = [];
    for (const [i, titulo] of titulos.entries()) {
      const tmp = path.join(trabajo, `opcion-${i}.jpg`);
      const r = await componer({ plantilla, valores: { titulo, imagen, marca: datos.marca.texto }, salida: tmp, prepararImagen: (ruta, capa) => recortarA(ruta, capa, trabajo, elegida.foco) });
      const revision = await revisar(tmp, titulo, r, guia, formato);
      const salida = path.join(carpeta, "opciones", `opcion-${sello}-${i + 1}.jpg`);
      await fs.rename(tmp, salida);
      opciones.push({
        ...r,
        archivo: path.relative(dirDatos(), salida),
        titulo,
        escena: elegida.escena,
        segundo: elegida.t,
        origen: `${elegida.ruta}${elegida.tipo === "video" ? ` @ ${elegida.segundo} s` : ""}`,
        plantilla,
        estilo: propia ? "propio" : estilo,
        version: numero,
        motor: `photocraft-cli ${PHOTOCRAFT_VERSION}`,
        creada: new Date().toISOString(),
        revision,
      });
    }
    const antes = await leerPortada(fila.slug);
    await guardarEstado(fila.slug, { ...antes, opciones });
    // Borra los archivos de las opciones anteriores (la elegida es una copia aparte).
    const vigentes = new Set(opciones.map((o) => path.basename(o.archivo)));
    for (const f of await fs.readdir(path.join(carpeta, "opciones"))) if (!vigentes.has(f)) await fs.rm(path.join(carpeta, "opciones", f), { force: true });
    return { ...antes, opciones };
  } finally {
    await fs.rm(trabajo, { recursive: true, force: true });
  }
}

interface GuiaRevision {
  caja: Caja | null;
  tamano: number | null;
  /** Color del título (sólo en los diseños base; el de un PSD propio no se conoce). */
  color: string | null;
}

/**
 * Dónde está el título y de qué color, para revisar las opciones. En los diseños base sale de los pasos
 * que los arman (la caja entera, no el contorno del texto de muestra); en un PSD propio, de su capa.
 */
async function guiaRevision(plantilla: string, pasosBase: Paso[] | null): Promise<GuiaRevision> {
  const base = pasosBase?.find((p) => p.params.name === "@titulo")?.params;
  if (base && Array.isArray(base.box) && base.box.length === 4) {
    return { caja: base.box as Caja, tamano: typeof base.size === "number" ? base.size : null, color: typeof base.color === "string" ? base.color : null };
  }
  try {
    const capa = variablesDe((await leerCapas(plantilla)).capas).get("titulo");
    return { caja: capa?.limites ?? null, tamano: capa?.tamano ?? null, color: null };
  } catch {
    return { caja: null, tamano: null, color: null }; // sin medidas: la revisión sólo mira el texto
  }
}

async function revisar(imagen: string, titulo: string, r: Resultado, g: GuiaRevision, f: Formato): Promise<RevisionPortada> {
  const { ancho, alto } = medidasPortada(f);
  const contraste = g.caja && g.color ? await medirContrasteTitulo(imagen, g.caja, g.color, ancho, alto) : null;
  return revisarPortada({
    formato: f,
    ancho,
    alto,
    titulo,
    caja: g.caja,
    tamano: r.achicados.titulo ?? g.tamano,
    contraste,
    desborda: r.desbordan.includes("titulo"),
  });
}

/** La opción `indice` pasa a ser la portada del proyecto (`portada/portada.jpg`). */
export async function elegirOpcion(proyectoId: string, indice: number): Promise<EstadoPortada> {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const e = await leerPortada(fila.slug);
  const o = e.opciones[indice];
  if (!o) throw new Error("Esa opción ya no existe: crea las portadas otra vez");
  const dir = dirProyecto(fila.slug);
  const destino = path.join(dir, "portada", "portada.jpg");
  const tmp = `${destino}.tmp-${process.pid}-${Date.now()}`;
  await fs.copyFile(path.join(dirDatos(), o.archivo), tmp);
  await fs.rename(tmp, destino);
  const nuevo: EstadoPortada = { ...e, elegida: { ...o, archivo: path.relative(dirDatos(), destino), creada: new Date().toISOString() } };
  await guardarEstado(fila.slug, nuevo);
  return nuevo;
}

/** Ruta absoluta de la portada elegida de un proyecto, si hay. */
export async function rutaPortadaElegida(slug: string): Promise<string | null> {
  const e = await leerPortada(slug);
  if (!e.elegida) return null;
  const abs = path.join(dirDatos(), e.elegida.archivo);
  return (await existe(abs)) ? abs : null;
}

/** Guion completo de un proyecto (para proponer títulos). */
export function guionDe(p: Proyecto): string {
  return escenasEnLinea(p).map((e) => e.escena.texto).join(" ");
}

export async function datosParaTitulos(proyectoId: string): Promise<{ slug: string; nombre: string; tema: string; guion: string; formato: string }> {
  const { fila, p } = await contexto(proyectoId);
  return { slug: fila.slug, nombre: fila.nombre, tema: fila.tema, guion: guionDe(p), formato: fila.formato };
}
