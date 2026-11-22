/**
 * Sugerencias de gancho y título de reacción para un clip, con el modelo local de MPT (Ollama en
 * Docker; gratis y en esta PC). Las reglas son las de la skill `geeper` (de `hook-writer` de
 * gtavi-claudecode): nada de citas inventadas, ni «oficial», ni leaks. Todo lo que el modelo devuelve
 * se filtra antes de mostrarlo; la persona elige y puede editarlo.
 */
import { z } from "zod";
import { terminosProhibidos } from "./clips";
import { tomarGpu } from "./gpu";
import { correr } from "./proceso";

export const MODELO_GANCHOS = process.env.GEEPER_OLLAMA_MODELO ?? "gemma4:26b";
const CONTENEDOR = process.env.GEEPER_OLLAMA_CONTENEDOR ?? "mpt-ollama";

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

const Respuesta = z.object({ ganchos: z.array(z.string()).default([]), titulo: z.string().nullable().optional() });

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

/** Limpia lo que devuelve el modelo: quita comillas, términos prohibidos, vacíos, largos y repetidos. */
export function limpiarSugerencias(crudo: string): Sugerencias {
  const r = Respuesta.safeParse(ultimoJson(crudo));
  if (!r.success) return { ganchos: [], titulo: null };
  const datos = r.data;
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

/**
 * Pregunta al modelo local (Ollama de MPT, en la GPU; sale JSON). `queHacer` completa los mensajes de
 * error para la persona («escribe el gancho a mano»).
 */
export async function preguntarModeloLocal(prompt: string, motivo: string, queHacer: string): Promise<string> {
  const candado = await tomarGpu(motivo, { esperar: false });
  if (!candado) throw new Error(`La tarjeta de video está ocupada (renderizando o generando). Prueba en un rato o ${queHacer}.`);
  try {
    // Sin «pensar en voz alta»: gemma4 razona antes y repite el formato pedido con llaves, lo que rompía
    // la lectura del JSON (medido 2026-11-20: 140 s y respuesta ilegible).
    const r = await correr("docker", ["exec", "-i", CONTENEDOR, "ollama", "run", MODELO_GANCHOS, "--format", "json", "--think=false", "--hidethinking", "--keepalive", "0s"], {
      entrada: prompt,
      timeout: 150_000,
      permitirFallo: true,
    });
    if (r.codigo !== 0) {
      if (/docker API|daemon|No such container|cannot connect/i.test(r.stderr)) {
        throw new Error(`Las sugerencias usan el modelo local de MoneyPrinterTurbo: abre Docker Desktop y vuelve a intentar, o ${queHacer}.`);
      }
      throw new Error(`El modelo local no respondió (${r.stderr.trim().split("\n").pop()?.slice(0, 160) ?? r.codigo}).`);
    }
    return r.stdout;
  } finally {
    candado.liberar();
  }
}

export async function sugerirGanchos(d: { texto: string; canal: string | null; idioma: string; react: boolean }): Promise<Sugerencias> {
  if (!d.texto.trim()) throw new Error("Este momento no tiene palabras transcritas: escribe el gancho a mano.");
  const s = limpiarSugerencias(await preguntarModeloLocal(promptGanchos(d), "sugerir ganchos", "escribe el gancho a mano"));
  if (!s.ganchos.length && !s.titulo) throw new Error("El modelo no dio ideas que cumplan las reglas: prueba otra vez o escribe el gancho a mano.");
  return s;
}
