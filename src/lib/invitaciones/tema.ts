/**
 * Tema a medida: la persona escribe una idea («un bosque encantado con luciérnagas») y la IA local elige
 * colores, letras, adornos, animación de fondo y los textos de cada sección. Todo sale de listas cerradas
 * (letras de Google Fonts con licencia OFL, adornos SVG propios, animaciones propias): la IA no escribe
 * CSS ni HTML, sólo elige. Después se corrige el contraste para que todo se lea.
 *
 * Sin IA (tarjeta ocupada, modelo apagado) `temaPorPalabras` arma uno parecido con las palabras de la idea.
 */
import { z } from "zod";
import { PLANTILLAS_INFO, TIPOS_INFO } from "./catalogo";
import type { Tipo } from "./esquema";

export const LETRAS_TITULOS = [
  "Pinyon Script", "Great Vibes", "Parisienne", "Allura", "Dancing Script", "Sacramento", "Satisfy",
  "Playfair Display", "Cinzel", "Cinzel Decorative", "Cormorant Garamond", "Bodoni Moda", "Italiana",
  "Abril Fatface", "Uncial Antiqua", "MedievalSharp", "Fredoka", "Pacifico", "Lobster", "Amatic SC", "Creepster",
] as const;
export const LETRAS_TEXTO = [
  "Cormorant Garamond", "Lora", "EB Garamond", "Libre Baskerville", "Inter", "Nunito", "Quicksand", "Montserrat", "Josefin Sans", "Raleway",
] as const;
/** Familia genérica de respaldo de cada letra (si no hubo internet para bajarla). */
export function genericaDe(letra: string): string {
  if (/Script|Vibes|Parisienne|Allura|Sacramento|Satisfy|Pacifico|Lobster/.test(letra)) return "cursive";
  if (/Inter|Nunito|Quicksand|Montserrat|Josefin|Raleway|Fredoka|Amatic|Creepster/.test(letra)) return "sans-serif";
  return "serif";
}

export const ADORNOS = ["clasico", "hojas", "flores", "estrellas", "corazones", "copos", "mariposas", "hongos", "lunas", "ondas", "coronas", "globos", "geometrico"] as const;
export const PARTICULAS = ["ninguna", "luciernagas", "estrellas", "petalos", "hojas", "copos", "burbujas", "brillos", "confeti"] as const;
export const FONDOS = ["liso", "bruma", "puntos", "rayas"] as const;
/** Cómo se le nombran a la persona. */
export const NOMBRE_ADORNO: Record<(typeof ADORNOS)[number], string> = {
  clasico: "clásicos", hojas: "hojas", flores: "flores", estrellas: "estrellas", corazones: "corazones", copos: "copos de nieve", mariposas: "mariposas",
  hongos: "hongos", lunas: "lunas", ondas: "olas", coronas: "coronas", globos: "globos", geometrico: "rombos",
};
export const NOMBRE_PARTICULAS: Record<(typeof PARTICULAS)[number], string> = {
  ninguna: "sin animación", luciernagas: "luciérnagas", estrellas: "estrellas que brillan", petalos: "pétalos que caen", hojas: "hojas que caen",
  copos: "nieve", burbujas: "burbujas", brillos: "destellos", confeti: "confeti",
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = () => z.string().regex(HEX);
const corto = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const Colores = z.object({ fondo: hex(), fondo2: hex(), tarjeta: hex(), tinta: hex(), claro: hex(), acento: hex(), sobre: hex(), sello: hex() });
export type Colores = z.infer<typeof Colores>;

export const TextosTema = z.object({
  pista: corto(60), saludo: corto(40), cancion: corto(40), faltan: corto(40), ubicacion: corto(40), dress: corto(40), rsvp: corto(40), regalos: corto(40),
});
export type TextosTema = z.infer<typeof TextosTema>;

/** Tema guardado en `invitacion.json`. */
export const Tema = z.object({
  idea: z.string().trim().max(300),
  nombre: z.string().trim().min(1).max(40),
  colores: Colores,
  letras: z.object({ titulos: z.enum(LETRAS_TITULOS), texto: z.enum(LETRAS_TEXTO) }),
  adorno: z.enum(ADORNOS),
  particulas: z.enum(PARTICULAS),
  fondo: z.enum(FONDOS),
  textos: TextosTema.default({} as TextosTema),
  mensaje: corto(400),
  dress: z.array(hex()).max(4).default([]),
  dressEstilo: corto(40),
  /** Ilustración del tema, en inglés: para el QR artístico y la foto del sobre (imagenes.ts). */
  imagen: corto(300),
});
export type Tema = z.infer<typeof Tema>;

/** Lo que se le pide a la IA: las mismas elecciones, sin largos (se recortan después). */
export const TemaIa = z.object({
  nombre: z.string(),
  colores: Colores,
  letras: z.object({ titulos: z.enum(LETRAS_TITULOS), texto: z.enum(LETRAS_TEXTO) }),
  adorno: z.enum(ADORNOS),
  particulas: z.enum(PARTICULAS),
  fondo: z.enum(FONDOS),
  textos: z.object({ pista: z.string(), saludo: z.string(), cancion: z.string(), faltan: z.string(), ubicacion: z.string(), dress: z.string(), rsvp: z.string(), regalos: z.string() }),
  mensaje: z.string(),
  dress: z.array(hex()),
  dressEstilo: z.string(),
  imagen: z.string(),
});
export type TemaIa = z.infer<typeof TemaIa>;

// ── Contraste (WCAG) ─────────────────────────────────────────────────────────────────────────────

function luminancia(h: string): number {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Mezcla `a` hacia `b` en proporción `t` (0 = a, 1 = b). */
function mezclar(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Texto que se lea (≥ 4,5:1) sobre todos los fondos dados: el pedido si alcanza, si no el más cercano que sí. */
function legible(texto: string, fondos: string[]): string {
  const ok = (c: string) => fondos.every((f) => contraste(c, f) >= 4.5);
  if (ok(texto)) return texto;
  const oscuro = fondos.reduce((s, f) => s + luminancia(f), 0) / fondos.length > 0.35;
  const extremo = oscuro ? "#000000" : "#ffffff";
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const c = mezclar(texto, extremo, t);
    if (ok(c)) return c;
  }
  return oscuro ? "#111111" : "#fafafa";
}

/** Corrige los colores para que todo el texto se lea; los adornos (acento) quedan como estén. */
export function asegurarContraste(c: Colores): Colores {
  return { ...c, tinta: legible(c.tinta, [c.tarjeta]), claro: legible(c.claro, [c.fondo, c.fondo2]) };
}

// ── De la IA al tema guardado ────────────────────────────────────────────────────────────────────

const recortar = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").replace(/[<>{}]/g, "").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function normalizarTema(ia: TemaIa, idea: string): Tema {
  const textos = Object.fromEntries(Object.entries(ia.textos).map(([k, v]) => [k, recortar(v, k === "pista" ? 60 : 40)]));
  return Tema.parse({
    idea: recortar(idea, 300),
    nombre: recortar(ia.nombre, 40) || recortar(idea, 40) || "Mi tema",
    colores: asegurarContraste(ia.colores),
    letras: ia.letras,
    adorno: ia.adorno,
    particulas: ia.particulas,
    fondo: ia.fondo,
    textos,
    mensaje: recortar(ia.mensaje, 400),
    dress: ia.dress.slice(0, 4),
    dressEstilo: recortar(ia.dressEstilo, 40),
    imagen: recortar(ia.imagen, 300),
  });
}

export function promptTema(d: { idea: string; tipo: Tipo; nombres: string }): string {
  const t = TIPOS_INFO[d.tipo];
  return [
    `Diseña el tema visual de una invitación digital de ${t.nombre.toLowerCase()} de ${d.nombres}.`,
    `La idea de la persona: «${d.idea.replace(/[«»]/g, "")}».`,
    "",
    "Elige con criterio de diseñador (que se vea bonito y coherente con la idea):",
    "- colores (hex #RRGGBB): fondo y fondo2 (fondo de la página, degradado), tarjeta (fondo de las tarjetas de contenido), tinta (texto sobre tarjeta, con mucho contraste), claro (texto sobre el fondo, con mucho contraste), acento (adornos y detalles), sobre (el sobre que se abre) y sello (el sello de cera).",
    `- letras.titulos, una de: ${LETRAS_TITULOS.join(", ")}.`,
    `- letras.texto (cómoda de leer), una de: ${LETRAS_TEXTO.join(", ")}.`,
    `- adorno (dibujo de los separadores), uno de: ${ADORNOS.join(", ")}.`,
    `- particulas (animación suave del fondo), una de: ${PARTICULAS.join(", ")}.`,
    `- fondo (textura), uno de: ${FONDOS.join(", ")}.`,
    "- textos con el tono del tema, en español, cortos (máximo 5 palabras, la pista hasta 8): pista (invita a tocar el sello), saludo (título del mensaje), cancion, faltan (título de la cuenta atrás), ubicacion, dress (título del código de vestimenta), rsvp (título de confirmar asistencia), regalos.",
    "- mensaje: 1 a 3 frases cálidas en primera persona de quien invita, con el tono del tema, sin fecha ni lugar, sin emojis.",
    "- dress: 4 colores de ropa que combinen con el tema; dressEstilo: 2 a 4 palabras (ej. «Formal en tonos bosque»).",
    "- nombre: el nombre del tema en 2 a 4 palabras.",
    "- imagen: EN INGLÉS, 10 a 25 palabras que describan una ilustración del tema (escena, objetos, luz, colores), sin personas reales, sin texto ni letras.",
    "Responde sólo con el JSON pedido.",
  ].join("\n");
}

// ── Sin IA: tema por palabras ────────────────────────────────────────────────────────────────────

type Base = Omit<z.input<typeof Tema>, "idea" | "mensaje">;

const PALABRAS: { re: RegExp; tema: Base }[] = [
  { re: /bosque|encantad|hada|duende|elf|musgo|luci[eé]rnaga|hongo|seta/i, tema: {
    nombre: "Bosque encantado", colores: { fondo: "#0f2418", fondo2: "#1f4430", tarjeta: "#f4efe2", tinta: "#1f3a29", claro: "#eef3e6", acento: "#d8b55b", sobre: "#2f5a3d", sello: "#c9a24a" },
    letras: { titulos: "Cinzel Decorative", texto: "Cormorant Garamond" }, adorno: "hojas", particulas: "luciernagas", fondo: "bruma",
    textos: { pista: "Toca el sello y entra al bosque", saludo: "Bienvenidos", faltan: "Falta poco para la magia", rsvp: "¿Vienes al bosque?" },
    dress: ["#2f5a3d", "#8a9a5b", "#d8c3a5", "#c9a24a"], dressEstilo: "Tonos de bosque" } },
  { re: /mar\b|playa|sirena|oc[eé]ano|marin|ola|coral|tropical/i, tema: {
    nombre: "Bajo el mar", colores: { fondo: "#06263d", fondo2: "#0d4a6b", tarjeta: "#f2fbff", tinta: "#0b3954", claro: "#e6f6ff", acento: "#5fc9d6", sobre: "#116a8c", sello: "#e8b4a0" },
    letras: { titulos: "Parisienne", texto: "Lora" }, adorno: "ondas", particulas: "burbujas", fondo: "bruma",
    textos: { pista: "Toca el sello y sumérgete", saludo: "¡Hola!", faltan: "Faltan pocas olas", rsvp: "¿Te sumerges con nosotros?" },
    dress: ["#0d4a6b", "#5fc9d6", "#f2e3c9", "#e8b4a0"], dressEstilo: "Tonos de mar" } },
  { re: /estrella|galaxia|espacio|luna|noche|cielo|cosm|astr|planeta/i, tema: {
    nombre: "Noche de estrellas", colores: { fondo: "#0b1026", fondo2: "#1c2452", tarjeta: "#f5f3ff", tinta: "#1c2452", claro: "#eef0ff", acento: "#f3d27a", sobre: "#26306b", sello: "#f3d27a" },
    letras: { titulos: "Cinzel", texto: "Raleway" }, adorno: "lunas", particulas: "estrellas", fondo: "puntos",
    textos: { pista: "Toca el sello y mira las estrellas", saludo: "Bajo las estrellas", faltan: "Cuenta regresiva", rsvp: "¿Brillas con nosotros?" },
    dress: ["#1c2452", "#4b5bb5", "#c9c3e6", "#f3d27a"], dressEstilo: "Azul noche y dorado" } },
  { re: /princes|castillo|reina|rey\b|cuento|corona/i, tema: {
    nombre: "Cuento de princesas", colores: { fondo: "#f9e4ea", fondo2: "#f3c9d6", tarjeta: "#fffafc", tinta: "#6b2341", claro: "#5a1d36", acento: "#d4a24c", sobre: "#e8a5bb", sello: "#d4a24c" },
    letras: { titulos: "Great Vibes", texto: "Lora" }, adorno: "coronas", particulas: "brillos", fondo: "puntos",
    textos: { pista: "Toca el sello real", saludo: "Había una vez…", faltan: "Falta poco", rsvp: "¿Vienes al castillo?" },
    dress: ["#e8a5bb", "#f9e4ea", "#d4a24c", "#ffffff"], dressEstilo: "Rosa y dorado" } },
  { re: /invierno|nieve|navidad|frozen|hielo|copo/i, tema: {
    nombre: "Invierno mágico", colores: { fondo: "#0e2a47", fondo2: "#1f4f7a", tarjeta: "#f7fbff", tinta: "#123a5c", claro: "#eaf4ff", acento: "#bfe3ff", sobre: "#2c6a9c", sello: "#c0c9d6" },
    letras: { titulos: "Cinzel", texto: "Josefin Sans" }, adorno: "copos", particulas: "copos", fondo: "liso",
    textos: { pista: "Toca el sello", saludo: "¡Hola!", faltan: "Faltan pocos copos", rsvp: "¿Nos acompañas?" },
    dress: ["#1f4f7a", "#bfe3ff", "#ffffff", "#c0c9d6"], dressEstilo: "Azul hielo y plata" } },
  { re: /jard[ií]n|flor|primavera|campo|girasol|rosas|botánic|botanic/i, tema: {
    nombre: "Jardín en flor", colores: { fondo: "#eef3e8", fondo2: "#dfe9d6", tarjeta: "#fffdf8", tinta: "#33402f", claro: "#2f3d2b", acento: "#d07a8a", sobre: "#a9bba0", sello: "#d07a8a" },
    letras: { titulos: "Great Vibes", texto: "Lora" }, adorno: "flores", particulas: "petalos", fondo: "puntos",
    textos: { pista: "Toca el sello", saludo: "¡Hola!", faltan: "Ya casi florece", rsvp: "¿Nos acompañas?" },
    dress: ["#a9bba0", "#e8c7c3", "#f4ecdf", "#d07a8a"], dressEstilo: "Colores de jardín" } },
  { re: /oto[ñn]o|hojas secas|cosecha/i, tema: {
    nombre: "Otoño dorado", colores: { fondo: "#3a1f10", fondo2: "#6b3a1a", tarjeta: "#fbf3e6", tinta: "#5a2e12", claro: "#fbeedd", acento: "#e0913a", sobre: "#8c4a1f", sello: "#c96a2b" },
    letras: { titulos: "Playfair Display", texto: "Lora" }, adorno: "hojas", particulas: "hojas", fondo: "bruma",
    textos: { pista: "Toca el sello", saludo: "¡Hola!", faltan: "Faltan pocas hojas", rsvp: "¿Vienes?" },
    dress: ["#8c4a1f", "#e0913a", "#d8c3a5", "#5a2e12"], dressEstilo: "Tonos tierra" } },
  { re: /gala|dorad|elegant|glamour|gatsby|art ?d[eé]co|veinte|20s|lujo/i, tema: {
    nombre: "Gala dorada", colores: { fondo: "#0c0c0c", fondo2: "#1d1a14", tarjeta: "#faf6ec", tinta: "#1a1712", claro: "#f6efdc", acento: "#d4af37", sobre: "#1f1c16", sello: "#d4af37" },
    letras: { titulos: "Italiana", texto: "Montserrat" }, adorno: "geometrico", particulas: "brillos", fondo: "rayas",
    textos: { pista: "Toca el sello", saludo: "Una noche de gala", faltan: "Cuenta regresiva", rsvp: "Confirma tu lugar" },
    dress: ["#0c0c0c", "#d4af37", "#faf6ec", "#7a6a45"], dressEstilo: "Etiqueta: negro y dorado" } },
  { re: /halloween|terror|calabaza|bruj|monstru|vampir/i, tema: {
    nombre: "Noche de brujas", colores: { fondo: "#160b22", fondo2: "#2c1646", tarjeta: "#fbf3e9", tinta: "#2c1646", claro: "#fff1dc", acento: "#f28c28", sobre: "#3a1d5c", sello: "#f28c28" },
    letras: { titulos: "Creepster", texto: "Nunito" }, adorno: "lunas", particulas: "estrellas", fondo: "bruma",
    textos: { pista: "Toca el sello… si te atreves", saludo: "¡Buuu!", faltan: "Faltan pocas noches", rsvp: "¿Te atreves a venir?" },
    dress: ["#160b22", "#f28c28", "#3a1d5c", "#2b2b2b"], dressEstilo: "Disfraz obligatorio" } },
  { re: /vaquer|rancho|western|charr|country|rodeo/i, tema: {
    nombre: "Fiesta en el rancho", colores: { fondo: "#3b2416", fondo2: "#5c3a22", tarjeta: "#f7ecd9", tinta: "#4a2b17", claro: "#f7ecd9", acento: "#d9a441", sobre: "#7a4b2a", sello: "#b5532f" },
    letras: { titulos: "Abril Fatface", texto: "Libre Baskerville" }, adorno: "estrellas", particulas: "ninguna", fondo: "rayas",
    textos: { pista: "Toca el sello, compadre", saludo: "¡Howdy!", faltan: "Faltan pocos días", rsvp: "¿Vienes al rancho?" },
    dress: ["#7a4b2a", "#d9a441", "#f7ecd9", "#3b5b7a"], dressEstilo: "Vaquero" } },
  { re: /safari|selva|jungla|animal|le[oó]n|tigre/i, tema: {
    nombre: "Safari", colores: { fondo: "#2a3318", fondo2: "#4a5a2a", tarjeta: "#f6f0dc", tinta: "#3a4220", claro: "#f6f0dc", acento: "#d9a441", sobre: "#6b7a3a", sello: "#c27c2c" },
    letras: { titulos: "Amatic SC", texto: "Nunito" }, adorno: "hojas", particulas: "hojas", fondo: "bruma",
    textos: { pista: "Toca el sello y empieza la aventura", saludo: "¡Aventura!", faltan: "Falta poco", rsvp: "¿Te unes a la expedición?" },
    dress: ["#6b7a3a", "#d9c7a0", "#c27c2c", "#3a4220"], dressEstilo: "Explorador" } },
  { re: /infantil|dinosaur|unicorni|arco ?[ií]ris|globo|fiesta|juguet|circo|superh[eé]ro/i, tema: {
    nombre: "Fiesta de colores", colores: { fondo: "#fff4d6", fondo2: "#ffe0ec", tarjeta: "#ffffff", tinta: "#3b2a6b", claro: "#3b2a6b", acento: "#ff6b9a", sobre: "#7ec8e3", sello: "#ffb703" },
    letras: { titulos: "Fredoka", texto: "Nunito" }, adorno: "globos", particulas: "confeti", fondo: "puntos",
    textos: { pista: "¡Toca el sello!", saludo: "¡Hola, hola!", faltan: "¡Ya casi!", rsvp: "¿Vienes a la fiesta?" },
    dress: ["#ff6b9a", "#7ec8e3", "#ffb703", "#8ac926"], dressEstilo: "¡Ven con mucho color!" } },
  { re: /rom[aá]nt|amor|coraz[oó]n|san valent/i, tema: {
    nombre: "Amor eterno", colores: { fondo: "#fbe9ec", fondo2: "#f6d3da", tarjeta: "#fffafb", tinta: "#6e1f33", claro: "#5e1a2c", acento: "#c9505f", sobre: "#e7a1ad", sello: "#b8323f" },
    letras: { titulos: "Allura", texto: "Cormorant Garamond" }, adorno: "corazones", particulas: "petalos", fondo: "puntos",
    textos: { pista: "Toca el sello", saludo: "Con amor", faltan: "Falta poco", rsvp: "¿Nos acompañas?" },
    dress: ["#e7a1ad", "#fbe9ec", "#b8323f", "#ffffff"], dressEstilo: "Tonos rosa" } },
];

/** Tema sin IA: el de la primera lista de palabras que coincida, o el estilo recomendado del tipo de evento. */
export function temaPorPalabras(idea: string, tipo: Tipo): Tema {
  const elegido = PALABRAS.find((p) => p.re.test(idea))?.tema;
  const base: Base = elegido ?? (() => {
    const p = PLANTILLAS_INFO[TIPOS_INFO[tipo].plantilla];
    return { nombre: "Mi tema", colores: p.colores, letras: p.letras, adorno: p.adorno, particulas: "brillos" as const, fondo: p.fondo, textos: {}, dress: p.dress, dressEstilo: undefined };
  })();
  const nombre = elegido ? base.nombre : recortar(idea.charAt(0).toUpperCase() + idea.slice(1), 40) || base.nombre;
  return Tema.parse({ ...base, nombre, idea: recortar(idea, 300), colores: asegurarContraste(base.colores) });
}
