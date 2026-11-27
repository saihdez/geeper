/**
 * «Sugerir título, descripción y hashtags» del panel Publicar (BRECHAS D1), con el modelo local (gratis,
 * nada sale de la PC). Se arma con lo que el video dice de verdad; las reglas de los ganchos (nada de
 * citas inventadas, «oficial», leaks ni promesas) valen igual. La salida se limpia con los límites de
 * cada red (revision-texto.ts) y la persona la revisa antes de publicar: nunca se publica sola.
 *
 * Largo de la descripción según la duración (idea de la IA de Cap, `apps/web/workflows/generate-ai.ts`):
 * en videos de menos de un minuto, ≤ 35 palabras.
 */
import { z } from "zod";
import { terminosProhibidos } from "./clips";
import { ultimoJson } from "./ganchos";
import { HASHTAGS_RECOMENDADOS, LIMITES } from "./redes/revision-texto";

export type RedTexto = "youtube" | "tiktok" | "instagram";

export interface DatosTexto {
  red: RedTexto;
  /** Lo que se dice en el video (las escenas en orden, sin lo recortado). */
  guion: string;
  nombre: string;
  duracion: number;
  /** Crédito obligatorio si el video es un clip de otro creador. */
  credito?: string;
}

export interface Sugerencia {
  titulo: string;
  descripcion: string;
}

/** Palabras de la descripción según la duración. */
export function palabrasDescripcion(segundos: number): [number, number] {
  if (segundos < 60) return [15, 35];
  if (segundos < 180) return [40, 80];
  return [60, 120];
}

export function promptPublicacion(d: DatosTexto): string {
  const [pmin, pmax] = palabrasDescripcion(d.duracion);
  const red = { youtube: "YouTube (Shorts o video)", tiktok: "TikTok", instagram: "Instagram Reels" }[d.red];
  return [
    `Eres quien publica videos cortos en ${red}. Escribe en español neutro.`,
    `El video se llama «${d.nombre.slice(0, 120)}», dura ${Math.round(d.duracion)} s y esto es lo que se dice:`,
    `"""${d.guion.slice(0, 2500)}"""`,
    "",
    'Devuelve SOLO un JSON: {"titulo": texto, "descripcion": texto, "hashtags": [textos]}.',
    `- titulo: de 4 a 10 palabras, que diga de qué trata y dé ganas de verlo; sin comillas, sin emojis al principio, máximo ${LIMITES.youtube.tituloVisible} caracteres.`,
    `- descripcion: de ${pmin} a ${pmax} palabras, en primera persona del canal («te muestro», «aquí ves»), sin repetir el título; puede cerrar con una pregunta para comentar.`,
    `- hashtags: de 3 a ${HASHTAGS_RECOMENDADOS}, sin el signo #, palabras clave reales del tema (nada de #viral, #fyp ni #parati).`,
    "Reglas: describe sólo lo que se dice o se ve; no inventes datos, números ni citas; nada de «oficial», leaks, descargas gratis,",
    "trucos de dinero ni «no lo vas a creer»; como mucho un emoji en todo el texto.",
  ].join("\n");
}

const Respuesta = z.object({
  titulo: z.string().default(""),
  descripcion: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
});

const RELLENO = new Set(["viral", "fyp", "foryou", "foryoupage", "parati", "paratii", "xyzbca", "trending", "tendencia"]);

/** Hashtag limpio: letras y números (con tildes), sin # ni espacios; null si no sirve. */
export function hashtag(s: string): string | null {
  const t = s.trim().replace(/^#+/, "").normalize("NFC").replace(/[^\p{L}\p{N}_]/gu, "");
  if (t.length < 2 || t.length > 30 || /^\d+$/.test(t)) return null;
  if (RELLENO.has(t.toLowerCase())) return null;
  return t;
}

/**
 * Limpia lo que devuelve el modelo y arma título y descripción para la red. Lanza si no queda nada usable.
 * En YouTube los hashtags van al final de la descripción (se ven arriba del título los 3 primeros); en
 * TikTok e Instagram, también al final del texto, que es el mismo campo.
 */
export function armarSugerencia(crudo: string, d: DatosTexto): Sugerencia {
  const obj = ultimoJson(crudo);
  if (obj === null) throw new Error("El modelo no devolvió una sugerencia: prueba otra vez o escríbela a mano.");
  const leido = Respuesta.safeParse(obj);
  if (!leido.success) throw new Error("El modelo devolvió algo que no se entiende: prueba otra vez o escríbela a mano.");
  const r = leido.data;
  const limpio = (s: string) => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  let titulo = limpio(r.titulo).replace(/^["“«']+|["”»']+$/g, "");
  if (Array.from(titulo).length > LIMITES.youtube.titulo) titulo = Array.from(titulo).slice(0, LIMITES.youtube.titulo).join("").replace(/\s+\S*$/, "");
  let descripcion = r.descripcion.replace(/[<>]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // Los hashtags que el modelo haya metido en la descripción se pasan a la lista.
  const enTexto = [...descripcion.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)].map((m) => m[2]!);
  descripcion = descripcion.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").replace(/[ \t]+/g, " ").trim();
  const vistos = new Set<string>();
  const tags = [...r.hashtags, ...enTexto]
    .map(hashtag)
    .filter((t): t is string => !!t && !vistos.has(t.toLowerCase()) && Boolean(vistos.add(t.toLowerCase())))
    .slice(0, HASHTAGS_RECOMENDADOS);

  const prohibidos = [...terminosProhibidos(titulo), ...terminosProhibidos(descripcion)];
  if (prohibidos.length) throw new Error(`La sugerencia traía términos que no se usan (${[...new Set(prohibidos)].join(", ")}): prueba otra vez.`);
  if (!titulo && !descripcion) throw new Error("El modelo no dio una sugerencia usable: prueba otra vez o escríbela a mano.");

  const partes = [descripcion, d.credito?.trim(), tags.length ? tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean);
  let completa = partes.join("\n\n");
  const tope = d.red === "youtube" ? LIMITES.youtube.descripcionBytes : d.red === "tiktok" ? LIMITES.tiktok.textoUtf16 : LIMITES.instagram.caption;
  if (completa.length > tope) completa = completa.slice(0, tope);
  return { titulo: titulo || d.nombre.slice(0, LIMITES.youtube.titulo), descripcion: completa };
}
