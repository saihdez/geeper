/**
 * Sugerencias de gancho y título de reacción para un clip, con el modelo local de MPT (Ollama en
 * Docker; gratis y en esta PC). Las reglas son las de la skill `geeper` (de `hook-writer` de
 * gtavi-claudecode): nada de citas inventadas, ni «oficial», ni leaks. Todo lo que el modelo devuelve
 * se filtra antes de mostrarlo; la persona elige y puede editarlo.
 */
import { z } from "zod";
import { terminosProhibidos } from "./clips";
import { ErrorLlm, pedirJson, type OpcionesLlm } from "./llm-local";

export const MODELO_GANCHOS = process.env.GEEPER_OLLAMA_MODELO ?? "gemma4:26b";

export interface Sugerencias {
  ganchos: string[];
  titulo: string | null;
}

export function promptGanchos(d: { texto: string; canal: string | null; idioma: string; react: boolean }): string {
  return [
    "Eres editor de clips verticales para redes. Escribe en español neutro.",
    `Esto es lo que se dice en un momento de un video${d.canal ? ` de ${d.canal}` : ""} (idioma original: ${d.idioma}):`,
    `"""${d.texto.slice(0, 1500)}"""`,
    "",
    "Devuelve SOLO un JSON: {\"ganchos\": [3 textos], \"titulo\": texto}.",
    "- ganchos: frases de 3 a 9 palabras para los primeros 2 segundos. Fórmulas que funcionan: promesa con número,",
    "  dato que sorprende, situación («Cuando…»), negación, pregunta, nombrar al creador si se sabe.",
    `- titulo: ${d.react ? "título de reacción: creador + verbo de reacción + a qué reacciona, con 2 o 3 palabras clave en MAYÚSCULAS" : "título corto y descriptivo"}.`,
    "Reglas: describe sólo lo que pasa; NUNCA pongas palabras en boca del creador ni uses comillas; no inventes datos ni números;",
    "nada de «oficial», leaks, «jugar antes», descargas gratis ni trucos de dinero; sin «espera al final» ni «no lo vas a creer»;",
    "como mucho un emoji; si es de GTA, escribe «GTA 6».",
  ].join("\n");
}

export const RespuestaGanchos = z
  .object({ ganchos: z.array(z.string()).default([]), titulo: z.string().nullable().optional() })
  .describe("Sugerencias de gancho y título para un clip.");

/**
 * El último objeto JSON que se puede leer en la salida del modelo. Si el modelo razona antes de
 * contestar, el razonamiento puede traer llaves sueltas («{"titulo": texto}»): no sirve tomar de la
 * primera llave a la última.
 */
export function ultimoJson(crudo: string): unknown {
  const fin = crudo.lastIndexOf("}");
  if (fin < 0) return null;
  for (let i = crudo.lastIndexOf("{", fin); i >= 0; i = i > 0 ? crudo.lastIndexOf("{", i - 1) : -1) {
    try {
      return JSON.parse(crudo.slice(i, fin + 1));
    } catch {
      /* esa llave no abre el objeto completo: probar con la anterior */
    }
  }
  return null;
}

/** Filtra lo que devolvió el modelo: quita comillas, términos prohibidos, vacíos, largos y repetidos. */
export function filtrarSugerencias(datos: z.infer<typeof RespuestaGanchos>): Sugerencias {
  const bueno = (s: string, max: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (!t || t.length > max) return null;
    if (/["“”«»]/.test(t)) return null; // una cita sería poner palabras en boca del creador
    if (terminosProhibidos(t).length) return null;
    return t;
  };
  const vistos = new Set<string>();
  const ganchos = datos.ganchos
    .map((g) => bueno(g, 70))
    .filter((g): g is string => g !== null && !vistos.has(g.toLowerCase()) && Boolean(vistos.add(g.toLowerCase())))
    .slice(0, 3);
  return { ganchos, titulo: datos.titulo ? bueno(datos.titulo, 100) : null };
}

/** Lo mismo desde texto crudo (con o sin JSON alrededor). */
export function limpiarSugerencias(crudo: string): Sugerencias {
  const r = RespuestaGanchos.safeParse(ultimoJson(crudo));
  return r.success ? filtrarSugerencias(r.data) : { ganchos: [], titulo: null };
}

type OpcionesPrueba = Pick<OpcionesLlm, "ejecutar" | "candado" | "encender">;

/**
 * Pregunta al modelo local (Ollama de MPT, en la GPU) y devuelve el JSON crudo (por llm-local.ts, GPU-09).
 * `queHacer` completa los mensajes de error para la persona («escribe el gancho a mano»).
 */
export async function preguntarModeloLocal(prompt: string, motivo: string, queHacer: string, op: OpcionesPrueba = {}): Promise<string> {
  try {
    const r = await pedirJson(MODELO_GANCHOS, prompt, z.unknown(), { tarea: motivo, formato: "json", ...op });
    return r.crudo;
  } catch (e) {
    if (e instanceof ErrorLlm) throw new Error(`${e.message} O bien, ${queHacer}.`);
    throw e;
  }
}

export async function sugerirGanchos(d: { texto: string; canal: string | null; idioma: string; react: boolean }, op: OpcionesPrueba = {}): Promise<Sugerencias> {
  if (!d.texto.trim()) throw new Error("Este momento no tiene palabras transcritas: escribe el gancho a mano.");
  let datos: z.infer<typeof RespuestaGanchos>;
  try {
    datos = (await pedirJson(MODELO_GANCHOS, promptGanchos(d), RespuestaGanchos, { tarea: "sugerir ganchos", ...op })).datos;
  } catch (e) {
    if (e instanceof ErrorLlm) throw new Error(`${e.message} Mientras tanto, puedes escribir el gancho a mano.`);
    throw e;
  }
  const s = filtrarSugerencias(datos);
  if (!s.ganchos.length && !s.titulo) throw new Error("El modelo no dio ideas que cumplan las reglas: prueba otra vez o escribe el gancho a mano.");
  return s;
}
