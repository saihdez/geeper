/**
 * Títulos propuestos para la portada y la publicación, con el LLM local que ya corre en MPT (Gemma en el
 * contenedor `mpt-ollama`, US$0), por `pedirJson` de llm-local.ts (salida restringida por esquema, GPU-09).
 * Gemma usa la GPU: se toma el `gpu-lock` sin esperar; si está ocupada o Docker está apagado, se devuelven
 * títulos sugeridos sin IA y el motivo en palabras simples. Con el candado tomado, si un corte dejó Ollama
 * apagado, se enciende (ia-mpt.ts, dentro de pedirJson).
 */
import { z } from "zod";
import { ErrorLlm, pedirJson, type OpcionesLlm } from "./llm-local";

export const MODELO_TITULOS = process.env.GEEPER_LLM_TITULOS ?? "gemma4:12b";
export const MAX_TITULO = 70;

export interface Propuesta {
  titulos: string[];
  fuente: "ia" | "sugeridos";
  /** Por qué no se usó la IA (si no se usó). */
  motivo?: string;
}

/** Prompt para el LLM (función pura). */
export function promptTitulos(o: { tema: string; guion: string; formato: string }): string {
  const guion = o.guion.replace(/\s+/g, " ").trim().slice(0, 1500);
  return [
    "Eres editor de un canal de videos cortos en español.",
    `Escribe 3 títulos distintos para la portada de un video ${o.formato === "9:16" ? "vertical (Shorts)" : "de YouTube"}.`,
    "Reglas: en español; máximo 55 caracteres cada uno; que den ganas de verlo sin mentir ni exagerar;",
    "nada de clickbait engañoso, ni cifras o promesas que el guion no diga; sin comillas, sin hashtags, sin emojis;",
    "estilos distintos: uno directo, uno con pregunta y uno con curiosidad.",
    `Tema: ${o.tema}`,
    `Guion: ${guion}`,
    'Responde sólo JSON: {"titulos": ["…", "…", "…"]}',
  ].join("\n");
}

export const RespuestaTitulos = z.object({ titulos: z.array(z.string()) }).describe("Tres títulos para la portada.");

/** Limpia la respuesta del LLM: JSON o texto suelto → hasta 3 títulos únicos y cortos (función pura). */
export function limpiarTitulos(texto: string): string[] {
  let crudos: unknown[] = [];
  const json = texto.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const d = JSON.parse(json[0]) as { titulos?: unknown };
      if (Array.isArray(d.titulos)) crudos = d.titulos;
    } catch {
      /* sigue con las líneas */
    }
  }
  if (!crudos.length) crudos = texto.split("\n");
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const c of crudos) {
    if (typeof c !== "string") continue;
    const t = c
      .replace(/#\S+/g, "")
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .trim()
      .replace(/^["'«“]+|["'»”]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length < 4 || t.length > MAX_TITULO || /^[{}[\]]/.test(t) || /titulos/i.test(t)) continue;
    const clave = t.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(t);
    if (salida.length === 3) break;
  }
  return salida;
}

/** Títulos sin IA: el nombre del proyecto y el tema, sin repetir (función pura). */
export function titulosSugeridos(nombre: string, tema: string): string[] {
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const lista = [nombre, capital(tema.trim())].map((s) => s.trim().slice(0, MAX_TITULO)).filter(Boolean);
  return [...new Set(lista)];
}

/**
 * Por qué falló `docker exec` contra Ollama, en palabras simples (función pura). «not running» y
 * «no such container» van antes que «daemon»: Docker los dice como «Error response from daemon: …» y
 * entonces se mandaba a abrir Docker Desktop aunque estuviera abierto.
 */
export function motivoFallo(stderr: string): string {
  const err = stderr.toLowerCase();
  if (err.includes("no such container") || err.includes("not running")) return "La IA local (MoneyPrinterTurbo) no está encendida.";
  if (err.includes("model") && err.includes("not found")) return `Falta el modelo ${MODELO_TITULOS} en la IA local.`;
  if (err.includes("docker api") || err.includes("daemon") || err.includes("pipe") || err.includes("cannot connect")) return "La IA local está apagada: abre Docker Desktop y vuelve a intentar.";
  if (err.includes("not found")) return `Falta el modelo ${MODELO_TITULOS} en la IA local.`;
  return "La IA local no respondió.";
}

export async function proponerTitulos(
  o: { nombre: string; tema: string; guion: string; formato: string },
  op: Pick<OpcionesLlm, "ejecutar" | "candado" | "encender"> = {},
): Promise<Propuesta> {
  const respaldo = (motivo: string): Propuesta => ({ titulos: titulosSugeridos(o.nombre, o.tema), fuente: "sugeridos", motivo });
  try {
    const r = await pedirJson(MODELO_TITULOS, promptTitulos(o), RespuestaTitulos, { tarea: "titulos", ...op });
    const titulos = limpiarTitulos(JSON.stringify(r.datos));
    return titulos.length ? { titulos, fuente: "ia" } : respaldo("La IA respondió algo que no se pudo usar.");
  } catch (e) {
    if (e instanceof ErrorLlm) {
      if (e.causa === "gpu-ocupada") return respaldo("La tarjeta de video está ocupada con otro trabajo (un video o un render). Prueba de nuevo en unos minutos.");
      if (e.causa === "mpt-apagado") return respaldo("La IA local (MoneyPrinterTurbo) no está encendida.");
      if (e.causa === "modelo-falta") return respaldo(`Falta el modelo ${MODELO_TITULOS} en la IA local.`);
      if (e.causa === "docker-apagado") return respaldo("La IA local está apagada: abre Docker Desktop y vuelve a intentar.");
      if (e.causa === "tiempo") return respaldo("La IA local no respondió a tiempo.");
      return respaldo(e.message);
    }
    return respaldo("La IA local no respondió a tiempo.");
  }
}
