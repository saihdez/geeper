/**
 * Confianza de la alineación (BRECHAS.md E5). whisper.cpp por `hyperframes transcribe` no da
 * probabilidades por palabra, así que se mide con tres señales que sí tenemos:
 *  1. Acuerdo: lo que whisper oyó en ese momento ¿se parece a la palabra del guion? (el alineador
 *     reparte el guion sobre los tiempos de whisper; donde no coinciden, el tiempo es una conjetura),
 *  2. Silencio: una palabra cuyo tiempo cae dentro de un silencio es una alucinación de whisper
 *     (hyperframes `captions.md`: descartar palabras dentro de `silencedetect=noise=-35dB:d=0.6`),
 *  3. Duración: < 30 ms o > 2 s por palabra son síntomas de una alineación forzada que falló.
 *  4. Probabilidad de whisper (`p`, sólo con whisper directo, ver whisper.ts), y sólo cuando el texto
 *     del subtítulo ES lo que oyó whisper (clips). En una voz TTS el texto sale del guion y ya está bien
 *     escrito: ahí una `p` baja no dice nada del tiempo, y el acuerdo (1) es la señal correcta.
 * Una palabra con confianza < 0,6 es «dudosa»: la UI la marca y el QC avisa (o bloquea si son > 20 %).
 */
import { correr } from "./proceso";
import { FFMPEG } from "./rutas";
import type { Palabra } from "./esquema";
import { norm } from "./subtitulos";

export const UMBRAL_DUDOSA = 0.6;
/** Más de esta proporción de palabras dudosas = transcripción fallida (bloquea el QC). */
export const MAX_DUDOSAS = 0.2;

export interface Silencio {
  inicio: number;
  fin: number;
}

export interface PalabraOida {
  text: string;
  start: number;
  end: number;
  p?: number;
}

/**
 * Tope de confianza según la probabilidad de whisper. Medido (HEREDADO.md, OpenWhispr): la mediana es
 * 0,99; las palabras mal oídas quedaron entre 0,27 y 0,31. < 0,35 = dudosa; de 0,35 a 0,85 sube de
 * 0,6 a 1 («poco segura» en la UI); desde 0,85 no limita.
 */
export function topePorProbabilidad(p: number): number {
  if (p < 0.35) return 0.5;
  if (p < 0.85) return 0.6 + 0.8 * (p - 0.35);
  return 1;
}

/** Silencios de la voz (−35 dB durante ≥ 0,6 s), con ffmpeg `silencedetect`. */
export async function detectarSilencios(audio: string): Promise<Silencio[]> {
  const r = await correr(FFMPEG, ["-hide_banner", "-nostdin", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"]);
  return leerSilencios(r.stderr);
}

export function leerSilencios(stderr: string): Silencio[] {
  const out: Silencio[] = [];
  let inicio: number | null = null;
  for (const linea of stderr.split("\n")) {
    const a = /silence_start: (-?[\d.]+)/.exec(linea);
    if (a) inicio = Math.max(0, Number(a[1]));
    const b = /silence_end: ([\d.]+)/.exec(linea);
    if (b && inicio !== null) {
      out.push({ inicio, fin: Number(b[1]) });
      inicio = null;
    }
  }
  return out;
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Parecido entre dos palabras (1 = iguales), sin tildes ni signos. */
export function parecido(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  return 1 - distancia(x, y) / Math.max(x.length, y.length);
}

const solape = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Agrega `confianza` (0..1) a cada palabra alineada. `probabilidad`: usar la `p` de whisper (sólo cuando
 * las palabras son las que oyó whisper, como en los clips).
 */
export function puntuarPalabras(palabras: Palabra[], oidas: PalabraOida[], silencios: Silencio[], o: { probabilidad?: boolean } = {}): Palabra[] {
  return palabras.map((w) => {
    const dur = w.fin - w.inicio;
    // 1. Acuerdo con lo que whisper oyó cerca de ese tiempo.
    const cerca = oidas.filter((o) => solape(w.inicio - 0.15, w.fin + 0.15, o.start, o.end) > 0);
    let c = cerca.length ? Math.max(...cerca.map((o) => parecido(w.texto, o.text))) : 0.3;
    // 2. Dentro de un silencio: alucinación o palabra sin voz.
    const enSilencio = silencios.reduce((s, x) => s + solape(w.inicio, w.fin, x.inicio, x.fin), 0);
    if (dur > 0 && enSilencio / dur > 0.5) c = Math.min(c, 0.2);
    // 3. Duraciones imposibles.
    if (dur < 0.03 || dur > 2) c = Math.min(c, 0.4);
    // 4. Probabilidad de whisper de la misma palabra (mismo texto y tiempo que se solapa).
    if (o.probabilidad) {
      const misma = cerca.find((x) => typeof x.p === "number" && Math.abs(x.start - w.inicio) < 0.05 && norm(x.text) === norm(w.texto));
      if (misma) c = Math.min(c, topePorProbabilidad(misma.p!));
    }
    return { ...w, confianza: Math.round(c * 100) / 100 };
  });
}

export interface ResumenConfianza {
  medidas: number;
  dudosas: number;
  proporcion: number;
  /** Escenas con alguna palabra dudosa, con el texto de esas palabras. */
  escenas: { escena: string; palabras: string[] }[];
}

export function resumirConfianza(escenas: { id: string; palabras: Palabra[] }[]): ResumenConfianza {
  let medidas = 0;
  let dudosas = 0;
  const conDudas: ResumenConfianza["escenas"] = [];
  for (const e of escenas) {
    const malas: string[] = [];
    for (const w of e.palabras) {
      if (w.confianza === undefined) continue;
      medidas++;
      if (w.confianza < UMBRAL_DUDOSA) {
        dudosas++;
        malas.push(w.texto);
      }
    }
    if (malas.length) conDudas.push({ escena: e.id, palabras: malas });
  }
  return { medidas, dudosas, proporcion: medidas ? dudosas / medidas : 0, escenas: conDudas };
}
