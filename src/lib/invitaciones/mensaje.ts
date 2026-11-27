/** «Escríbelo por mí»: tres mensajes para la invitación con el modelo local (llm-local / Ollama). */
import { TIPOS_INFO } from "./catalogo";
import type { Tipo } from "./esquema";

export function promptMensaje(d: { tipo: Tipo; nombres: string; tono?: string }): string {
  const t = TIPOS_INFO[d.tipo];
  return [
    `Escribe 3 mensajes distintos para una invitación digital de ${t.nombre.toLowerCase()} de ${d.nombres}.`,
    "Reglas: español neutro latinoamericano, cálido y natural, en primera persona de quien invita.",
    "Cada mensaje de 1 a 3 frases y como máximo 240 caracteres. Sin emojis, sin hashtags, sin fecha ni lugar (ya están en la invitación), sin comillas.",
    d.tono ? `Tono: ${d.tono}.` : "Uno emotivo, uno elegante y uno alegre.",
    'Responde sólo con JSON: {"mensajes": ["...", "...", "..."]}',
  ].join("\n");
}

/** Lee la respuesta del modelo; descarta lo vacío, lo largo o lo que trae llaves o emojis. */
export function leerMensajes(crudo: string): string[] {
  let datos: unknown;
  try {
    datos = JSON.parse(crudo.slice(crudo.indexOf("{"), crudo.lastIndexOf("}") + 1));
  } catch {
    return [];
  }
  const lista = (datos as { mensajes?: unknown })?.mensajes;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.replace(/^["«“\s]+|["»”\s]+$/g, "").replace(/\s+/g, " ").trim())
    .filter((m) => m.length >= 20 && m.length <= 320 && !/[{}#]|\p{Extended_Pictographic}/u.test(m))
    .slice(0, 3);
}
