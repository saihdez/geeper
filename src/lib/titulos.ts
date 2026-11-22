/**
 * Títulos propuestos para la portada y la publicación, con el LLM local que ya corre en MPT (Gemma en el
 * contenedor `mpt-ollama`, US$0). Ollama no expone puerto al host, así que se llama con `docker exec`.
 * Gemma usa la GPU: se toma el `gpu-lock` sin esperar; si está ocupada o Docker está apagado, se devuelven
 * títulos sugeridos sin IA y el motivo en palabras simples. Con el candado tomado, si un corte dejó Ollama
 * apagado, se enciende (ia-mpt.ts).
 */
import { tomarGpu } from "./gpu";
import { encenderIaMpt, OLLAMA_MPT } from "./ia-mpt";
import { correr } from "./proceso";

export const CONTENEDOR_LLM = OLLAMA_MPT;
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

/**
 * `docker exec … ollama run` para los títulos (WEB-02), como en ganchos.ts y traducir.ts:
 * - `--keepalive 0s`: el modelo sale de la tarjeta al responder (si no, quedaba 5 min con 7–9 GB tomados
 *   y el candado ya suelto).
 * - `--think=false --hidethinking`: sin «pensar en voz alta»; gemma4 razona antes y repite el formato
 *   pedido con llaves, lo que tarda y rompe la lectura del JSON.
 */
export const argsOllamaTitulos = () => ["exec", "-i", CONTENEDOR_LLM, "ollama", "run", MODELO_TITULOS, "--format", "json", "--think=false", "--hidethinking", "--nowordwrap", "--keepalive", "0s"];

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
    // Con el candado en la mano: si un corte dejó apagada la IA de MPT, se enciende aquí (GPU-02).
    const ia = await encenderIaMpt({ contenedores: [CONTENEDOR_LLM] });
    if (ia.faltan.length) return respaldo("La IA local (MoneyPrinterTurbo) no está instalada en esta computadora.");
    const r = await correr("docker", argsOllamaTitulos(), {
      entrada: promptTitulos(o),
      timeout: 120_000,
      permitirFallo: true,
    });
    if (r.codigo !== 0) return respaldo(motivoFallo(r.stderr));
    const titulos = limpiarTitulos(r.stdout);
    return titulos.length ? { titulos, fuente: "ia" } : respaldo("La IA respondió algo que no se pudo usar.");
  } catch {
    return respaldo("La IA local no respondió a tiempo.");
  } finally {
    candado.liberar();
  }
}
