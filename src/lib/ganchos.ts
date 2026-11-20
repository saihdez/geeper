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

/** Lo que se le pide al modelo (docs/esquemas/ganchos.schema.json). Los filtros finos van en `limpiarSugerencias`. */
export const RespuestaGanchos = z
  .object({
    ganchos: z.array(z.string().describe("Gancho de 3 a 9 palabras para los primeros 2 segundos, sin comillas.")).default([]).describe("Tres ganchos distintos."),
    titulo: z.string().nullable().optional().describe("Título del clip (de reacción si es react)."),
  })
  .describe("Sugerencias de gancho y título para un clip.");

/** Limpia lo que devuelve el modelo: quita comillas, términos prohibidos, vacíos, largos y repetidos. */
export function limpiarSugerencias(crudo: string): Sugerencias {
  const inicio = crudo.indexOf("{");
  const fin = crudo.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return { ganchos: [], titulo: null };
  let datos: z.infer<typeof RespuestaGanchos>;
  try {
    datos = RespuestaGanchos.parse(JSON.parse(crudo.slice(inicio, fin + 1)));
  } catch {
    return { ganchos: [], titulo: null };
  }
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

export async function sugerirGanchos(d: { texto: string; canal: string | null; idioma: string; react: boolean }): Promise<Sugerencias> {
  if (!d.texto.trim()) throw new Error("Este momento no tiene palabras transcritas: escribe el gancho a mano.");
  const candado = await tomarGpu("sugerir ganchos", { esperar: false });
  if (!candado) throw new Error("La tarjeta de video está ocupada (renderizando o generando). Prueba en un rato o escribe el gancho a mano.");
  try {
    const r = await correr("docker", ["exec", "-i", CONTENEDOR, "ollama", "run", MODELO_GANCHOS, "--format", "json", "--keepalive", "0s"], {
      entrada: promptGanchos(d),
      timeout: 150_000,
      permitirFallo: true,
    });
    if (r.codigo !== 0) {
      if (/docker API|daemon|No such container|cannot connect/i.test(r.stderr)) {
        throw new Error("Las sugerencias usan el modelo local de MoneyPrinterTurbo: abre Docker Desktop y vuelve a intentar, o escribe el gancho a mano.");
      }
      throw new Error(`El modelo local no respondió (${r.stderr.trim().split("\n").pop()?.slice(0, 160) ?? r.codigo}).`);
    }
    const s = limpiarSugerencias(r.stdout);
    if (!s.ganchos.length && !s.titulo) throw new Error("El modelo no dio ideas que cumplan las reglas: prueba otra vez o escribe el gancho a mano.");
    return s;
  } finally {
    candado.liberar();
  }
}
