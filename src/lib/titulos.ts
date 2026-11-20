/**
 * Títulos propuestos para la portada y la publicación, con el LLM local que ya corre en MPT (Gemma en el
 * contenedor `mpt-ollama`, US$0). Ollama no expone puerto al host, así que se llama con `docker exec`.
 * Gemma usa la GPU: se toma el `gpu-lock` sin esperar; si está ocupada o Docker está apagado, se devuelven
 * títulos sugeridos sin IA y el motivo en palabras simples.
 */
import { z } from "zod";
import { tomarGpu } from "./gpu";
import { correr } from "./proceso";

export const CONTENEDOR_LLM = "mpt-ollama";
export const MODELO_TITULOS = process.env.GEEPER_LLM_TITULOS ?? "gemma4:12b";
export const MAX_TITULO = 70;

export interface Propuesta {
  titulos: string[];
  fuente: "ia" | "sugeridos";
  /** Por qué no se usó la IA (si no se usó). */
  motivo?: string;
}

/** Lo que se le pide al modelo (docs/esquemas/titulos.schema.json). Largo y repetidos los filtra `limpiarTitulos`. */
export const RespuestaTitulos = z
  .object({ titulos: z.array(z.string().describe(`Título en español, máximo ${MAX_TITULO} caracteres, sin comillas, hashtags ni emojis.`)).describe("Tres títulos de estilos distintos.") })
  .describe("Títulos propuestos para la portada.");

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

/** Limpia la respuesta del LLM: JSON o texto suelto → hasta 3 títulos únicos y cortos (función pura). */
export function limpiarTitulos(texto: string): string[] {
  let crudos: unknown[] = [];
  const json = texto.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      // Se valida sólo la forma; los títulos sueltos se filtran uno por uno abajo.
      const d = z.object({ titulos: z.array(z.unknown()) }).safeParse(JSON.parse(json[0]));
      if (d.success) crudos = d.data.titulos;
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

export async function proponerTitulos(o: { nombre: string; tema: string; guion: string; formato: string }): Promise<Propuesta> {
  const respaldo = (motivo: string): Propuesta => ({ titulos: titulosSugeridos(o.nombre, o.tema), fuente: "sugeridos", motivo });
  let candado;
  try {
    candado = await tomarGpu("titulos", { esperar: false });
  } catch {
    return respaldo("No se pudo revisar si la tarjeta gráfica está libre.");
  }
  if (!candado) return respaldo("La tarjeta gráfica está ocupada con otro trabajo (un video o un render). Prueba de nuevo en unos minutos.");
  try {
    const r = await correr("docker", ["exec", "-i", CONTENEDOR_LLM, "ollama", "run", MODELO_TITULOS, "--format", "json", "--nowordwrap"], {
      entrada: promptTitulos(o),
      timeout: 120_000,
      permitirFallo: true,
    });
    if (r.codigo !== 0) {
      const err = r.stderr.toLowerCase();
      if (err.includes("docker api") || err.includes("daemon") || err.includes("pipe")) return respaldo("La IA local está apagada: abre Docker Desktop y vuelve a intentar.");
      if (err.includes("no such container") || err.includes("not running")) return respaldo("La IA local (MoneyPrinterTurbo) no está encendida.");
      if (err.includes("not found")) return respaldo(`Falta el modelo ${MODELO_TITULOS} en la IA local.`);
      return respaldo("La IA local no respondió.");
    }
    const titulos = limpiarTitulos(r.stdout);
    return titulos.length ? { titulos, fuente: "ia" } : respaldo("La IA respondió algo que no se pudo usar.");
  } catch {
    return respaldo("La IA local no respondió a tiempo.");
  } finally {
    candado.liberar();
  }
}
