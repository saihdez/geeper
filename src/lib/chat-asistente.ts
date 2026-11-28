/**
 * El chat del asistente (ícono flotante en todas las páginas). Puro: lo usan el navegador y la ruta
 * `/api/asistente/chat`.
 *
 * Primero entiende sin IA (decisión del dueño, 2026-11-27: la IA local carga la tarjeta gráfica): busca
 * lo escrito entre las acciones que la página registró en el buscador (Ctrl+K), las secciones y las
 * recomendaciones. Sólo si no entiende ofrece «Preguntarle a la IA», y la IA sólo puede devolver ids de
 * esas mismas acciones: nunca ejecuta algo que no sea un botón que ya existe.
 */
import { z } from "zod";

/** Lo que el chat sabe de una acción (sin la función: eso queda en el navegador). */
export interface AccionChat {
  id: string;
  titulo: string;
  grupo: string;
  palabras?: string;
  detalle?: string;
}

export type Intencion = "saludo" | "recomendar" | "ayuda" | "gracias";

/** Palabras que no dicen qué hacer («quiero», «por favor», artículos…): no cuentan al buscar. */
const VACIAS = new Set([
  "a", "al", "algo", "como", "con", "cual", "de", "del", "dame", "el", "en", "es", "esta", "este", "esto", "favor",
  "hacer", "haz", "la", "las", "le", "lo", "los", "me", "mi", "mis", "necesito", "para", "pon", "por", "puedes",
  "puedo", "que", "quiero", "se", "si", "su", "sus", "tu", "un", "una", "unos", "y", "ya", "ayudame", "podrias",
  "gustaria", "seria", "mas", "muy", "eso", "ese", "esa", "aqui", "ahora", "todo", "toda", "todos",
]);

export const normalizar = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9:ñ ]+/g, " ");

/** Raíz corta para que «silencios» encuentre «silencio», «crea» encuentre «crear» y «videos», «video». */
function raiz(p: string): string {
  const sin = p.replace(/s$/, "");
  return sin.length >= 5 ? sin.slice(0, 4) : sin;
}

/** Verbos que casi cualquier acción comparte («cambiar», «quitar»…): ayudan, pero no deciden. */
const VERBOS = new Set(["camb", "quit", "pon", "pone", "crea", "agre", "mete", "sube", "baja", "saca", "usa", "usar", "dej", "deja", "arma"]);

export function tokens(texto: string): string[] {
  return normalizar(texto).split(/\s+/).filter((p) => p.length > 1 && !VACIAS.has(p));
}

/**
 * Las acciones que mejor encajan con lo escrito, de la más probable a la menos. Una palabra que
 * coincide con el título pesa más que con los sinónimos; hace falta al menos una coincidencia clara.
 */
export function buscarAcciones(mensaje: string, acciones: AccionChat[], max = 3): AccionChat[] {
  const pedidas = tokens(mensaje);
  if (!pedidas.length) return [];
  const puntuadas = acciones.map((a) => {
    const titulo = new Set(tokens(a.titulo).map(raiz));
    const extra = new Set(tokens(`${a.palabras ?? ""} ${a.detalle ?? ""}`).map(raiz));
    let puntos = 0;
    let aciertos = 0;
    for (const p of pedidas) {
      const r = raiz(p);
      const peso = VERBOS.has(r) ? 1 : 0;
      if (titulo.has(r)) { puntos += peso || 3; aciertos++; } else if (extra.has(r)) { puntos += peso || 2; aciertos++; }
    }
    // Lo que cubre más de lo pedido gana; una sola palabra suelta en una frase larga no alcanza.
    return { a, puntos: puntos + (aciertos === pedidas.length ? 2 : 0), aciertos };
  });
  // En una frase de 3 palabras o más, una sola coincidencia suele ser casualidad («receta de pizza»).
  const minimo = pedidas.length >= 3 ? 2 : 1;
  return puntuadas
    .filter((x) => x.aciertos >= minimo && x.puntos >= 2)
    .sort((x, y) => y.puntos - x.puntos)
    .slice(0, max)
    .map((x) => x.a);
}

/** Lo que no es una acción concreta: saludar, pedir ayuda o pedir consejo. */
export function intencion(mensaje: string): Intencion | null {
  const t = normalizar(mensaje).trim();
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal)\b/.test(t) && t.split(/\s+/).length <= 4) return "saludo";
  if (/^(gracias|muchas gracias|genial|perfecto|listo|ok|vale)\b/.test(t) && t.split(/\s+/).length <= 4) return "gracias";
  if (/(que (le )?falta|que (puedo |deberia |debo )?mejorar|como (lo )?mejoro|recomienda|recomendacion|sugiere|sugerencia|que hago|que sigue|siguiente paso|esta (bien|listo)|revisa(lo|r)? (mi|el|este)? ?video|consejo)/.test(t)) return "recomendar";
  if (/(^ayuda$|^help$|que (puedes|sabes) hacer|como funciona|como te uso|que haces)/.test(t)) return "ayuda";
  return null;
}

// ---- IA local (sólo cuando la persona lo pide) -------------------------------------------------------

export const PedidoChat = z.object({
  mensaje: z.string().trim().min(1).max(500),
  /** Qué página está viendo, en palabras («Editor del proyecto Faros», «Clips»…). */
  pagina: z.string().max(120),
  acciones: z.array(z.object({ id: z.string().max(120), titulo: z.string().max(160), detalle: z.string().max(240).optional() })).max(80),
  recomendaciones: z.array(z.string().max(200)).max(8).default([]),
  historial: z.array(z.object({ de: z.enum(["persona", "asistente"]), texto: z.string().max(600) })).max(6).default([]),
});
export type PedidoChat = z.infer<typeof PedidoChat>;

export const RespuestaChatIa = z.object({
  respuesta: z.string(),
  acciones: z.array(z.string()).default([]),
});

export function promptChat(d: PedidoChat): string {
  return [
    "Eres el asistente de Geeper, un estudio para hacer videos cortos, pensado para alguien que no sabe de video.",
    "Responde en español neutro con tuteo, en 1 a 4 frases cortas y sin palabras técnicas (nada de render, QC, fps, LUFS, GPU).",
    "Puedes recomendar hasta 3 acciones de la lista de abajo, por su id exacto; la persona decide si las hace con un botón.",
    "Si nada de la lista sirve, explica en qué parte de Geeper se hace o di con honestidad que Geeper no lo hace. No inventes botones ni ids.",
    "",
    `Página que está viendo: ${d.pagina || "(desconocida)"}`,
    d.recomendaciones.length ? `Lo que Geeper ya recomienda para este video: ${d.recomendaciones.map((r) => `«${r}»`).join("; ")}` : "",
    "Acciones disponibles (id: qué hace):",
    ...d.acciones.map((a) => `- ${a.id}: ${a.titulo}${a.detalle ? ` (${a.detalle})` : ""}`),
    "",
    d.historial.length ? "Conversación hasta ahora:" : "",
    ...d.historial.map((h) => `${h.de === "persona" ? "Persona" : "Asistente"}: ${h.texto}`),
    `Persona: ${d.mensaje}`,
    "",
    'Devuelve SOLO un JSON: {"respuesta": "tu respuesta", "acciones": ["id", ...]}',
  ].filter((l, i, todas) => l !== "" || todas[i - 1] !== "").join("\n");
}

/** Deja sólo ids que existen (la IA no puede ejecutar nada que no sea un botón real), sin repetir, hasta 3. */
export function limpiarRespuestaChat(r: z.infer<typeof RespuestaChatIa>, ids: readonly string[]): { respuesta: string; acciones: string[] } {
  const validos = new Set(ids);
  const acciones = [...new Set(r.acciones.map((x) => x.trim()))].filter((x) => validos.has(x)).slice(0, 3);
  const respuesta = r.respuesta.replace(/\s+/g, " ").trim().slice(0, 700) || "No tengo una respuesta clara para eso.";
  return { respuesta, acciones };
}
