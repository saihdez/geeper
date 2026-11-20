/**
 * Momentos fuertes de un material largo (directo, VOD, grabación): BRECHAS.md G5.
 *
 * Portado de Bodila51/gtavi-claudecode `scripts/moments.py` (MIT), con dos cambios:
 *  1. Primero se puntúa SIN transcribir (sonoridad + «lo más visto» de YouTube + chat), que cuesta
 *     segundos aunque el VOD dure horas; sólo los candidatos se transcriben y suman las palabras de
 *     emoción («no way», «qué locura»…). Transcribir un VOD de 4 h entero en CPU tardaría ~1 h.
 *  2. Bordes a inicio y fin de frase (HEREDADO.md, claude-shorts `snap_boundaries.py`).
 *
 * Señales por segundo:
 *  - sonoridad: dB por segundo menos su media móvil de 30 s (saltos sobre el nivel local, no dB fijos),
 *  - «lo más visto» (heatmap de YouTube, vía yt-dlp), si existe,
 *  - chat: mensajes por segundo (los de emoción pesan doble), del chat de YouTube o un chat.json de
 *    TwitchDownloader.
 */
import { spawn } from "node:child_process";
import { comando } from "./aislado";
import type { Palabra } from "./esquema";
import { FFMPEG } from "./rutas";

export interface PuntoHeatmap {
  start_time: number;
  end_time: number;
  value: number;
}

export interface Senales {
  /** dB por segundo. */
  db: number[];
  heatmap?: PuntoHeatmap[];
  /** Mensajes de chat por segundo (ya ponderados). */
  chat?: number[];
}

export interface Candidato {
  n: number;
  inicio: number;
  fin: number;
  /** Segundo del pico que lo originó. */
  pico: number;
  puntaje: number;
  motivos: string[];
  /** Lo que se dice (sólo tras transcribir el candidato). */
  texto?: string;
  /** Palabras de emoción encontradas al transcribir. */
  emocion?: number;
  /**
   * Vista previa liviana (480p) con aire a cada lado, para verlo y ajustar el tramo en la web. Rutas
   * relativas a la carpeta de datos; `desde`/`hasta` son los segundos de la fuente que cubre el video.
   */
  vista?: { video: string; poster: string; desde: number; hasta: number };
}

export interface OpcionesMomentos {
  top: number;
  min: number;
  max: number;
}

export const OPCIONES_MOMENTOS: OpcionesMomentos = { top: 8, min: 15, max: 40 };

const PESOS = { sonoridad: 1, heatmap: 2, chat: 1.5, emocion: 0.5 };

/** Palabras de emoción en inglés y español (el material de juegos mezcla los dos). */
export const EMOCION =
  /\b(no way|oh my god|omg|what|wait|bro|let'?s go|holy|insane|crazy|yo+|wtf|dude|look at|nah|run|go go|no puede ser|qué locura|que locura|dios mío|dios mio|mira|corre|vamos|madre mía|madre mia|no mames|wey|güey|increíble|increible|ay no|espera|qué fue eso|que fue eso)\b/i;
export const EMOCION_CHAT = /(LMAO|LOL|KEKW|OMEGALUL|\bW+\b|CLIP|💀|😂|🔥|NO WAY|HOLY|JAJA+|XD)/i;

export function mediana(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** (a − mediana) / desviación; ceros si la serie es plana. */
export function zscore(a: number[]): number[] {
  if (!a.length) return [];
  const media = a.reduce((s, x) => s + x, 0) / a.length;
  const std = Math.sqrt(a.reduce((s, x) => s + (x - media) ** 2, 0) / a.length);
  if (std < 1e-9) return a.map(() => 0);
  const med = mediana(a);
  return a.map((x) => (x - med) / (std + 1e-9));
}

/** Media móvil centrada de ancho k (como np.convolve mode="same": los bordes cuentan ceros). */
export function suavizar(a: number[], k: number): number[] {
  const n = Math.max(1, Math.floor(k));
  if (n === 1) return [...a];
  const izq = Math.floor((n - 1) / 2);
  const pref = [0];
  for (const x of a) pref.push(pref[pref.length - 1]! + x);
  return a.map((_, i) => {
    const lo = Math.max(0, i - (n - 1 - izq));
    const hi = Math.min(a.length, i + izq + 1);
    return (pref[hi]! - pref[lo]!) / n;
  });
}

const positivo = (a: number[]) => a.map((x) => Math.max(0, x));

export interface Puntaje {
  total: number[];
  sonoridad: number[];
  heatmap: number[];
  chat: number[];
}

/** Puntaje por segundo, sin transcripción. */
export function puntuar(s: Senales): Puntaje {
  const n = s.db.length;
  const local = suavizar(s.db, 30);
  const sonoridad = suavizar(positivo(zscore(s.db.map((x, i) => x - local[i]!))), 3);
  const heat = new Array<number>(n).fill(0);
  for (const h of s.heatmap ?? []) {
    for (let t = Math.max(0, Math.floor(h.start_time)); t < Math.min(n, Math.ceil(h.end_time)); t++) heat[t] = h.value;
  }
  const chatCrudo = (s.chat ?? []).slice(0, n);
  while (chatCrudo.length < n) chatCrudo.push(0);
  const hayHeat = heat.some((x) => x > 0);
  const hayChat = chatCrudo.some((x) => x > 0);
  const heatmap = hayHeat ? positivo(zscore(heat)) : heat;
  const chat = hayChat ? suavizar(positivo(zscore(suavizar(chatCrudo, 10))), 3) : chatCrudo;
  const total = sonoridad.map((x, i) => PESOS.sonoridad * x + PESOS.heatmap * heatmap[i]! + PESOS.chat * chat[i]!);
  return { total, sonoridad, heatmap: hayHeat ? heat : heatmap, chat };
}

/**
 * Ventanas sin solape alrededor de los picos, de mayor a menor puntaje. El pico queda al 55 % de la
 * ventana (la reacción viene después de lo que la provoca). Devuelve en orden cronológico.
 */
export function elegirVentanas(p: Puntaje, duracion: number, o: OpcionesMomentos = OPCIONES_MOMENTOS): Candidato[] {
  const usado = new Array<boolean>(Math.ceil(duracion) + 1).fill(false);
  const orden = [...p.total.keys()].sort((a, b) => p.total[b]! - p.total[a]!);
  const out: Candidato[] = [];
  for (const pico of orden) {
    if (out.length >= o.top || p.total[pico]! <= 0) break;
    let ini = Math.max(0, pico - 0.55 * o.max);
    const fin = Math.min(duracion, ini + o.max);
    if (fin - ini < o.min) ini = Math.max(0, fin - o.min);
    if (fin - ini < o.min) continue; // el material entero es más corto que un clip
    const a = Math.floor(ini);
    const b = Math.min(usado.length, Math.ceil(fin));
    if (usado.slice(a, b).some(Boolean)) continue;
    for (let i = a; i < b; i++) usado[i] = true;
    const motivos: string[] = [];
    if (p.sonoridad[pico]! > 1) motivos.push("pico de sonoridad");
    if (p.heatmap[pico]! > 0.5) motivos.push(`lo más visto de YouTube (${p.heatmap[pico]!.toFixed(2)})`);
    if (p.chat[pico]! > 1) motivos.push("pico del chat");
    out.push({ n: 0, inicio: round2(ini), fin: round2(fin), pico, puntaje: round2(p.total[pico]!), motivos: motivos.length ? motivos : ["energía general"] });
  }
  return out.sort((x, y) => x.inicio - y.inicio).map((c, i) => ({ ...c, n: i + 1 }));
}

const round2 = (x: number) => Math.round(x * 100) / 100;

const FIN_FRASE = /[.!?…]["»”)]?$/;

/**
 * Bordes a frase (palabras en tiempo absoluto del material). Inicio: el comienzo de frase más cercano a
 * ±1,5 s (palabra tras un fin de frase o tras una pausa > 0,5 s), si no la primera palabra; 0,2 s antes.
 * Fin: el último fin de frase dentro de los 3 s antes del borde, si no la última palabra; 0,3 s después.
 * Respeta [min, max].
 */
export function ajustarBordes(c: Pick<Candidato, "inicio" | "fin">, palabras: Palabra[], o: Pick<OpcionesMomentos, "min" | "max">, duracion: number): { inicio: number; fin: number } {
  const dentro = palabras.filter((w) => w.inicio >= c.inicio - 1.5 && w.fin <= c.fin + 0.5);
  if (!dentro.length) return { inicio: c.inicio, fin: c.fin };
  const esInicio = (i: number) => {
    const w = palabras.indexOf(dentro[i]!);
    const prev = palabras[w - 1];
    return !prev || FIN_FRASE.test(prev.texto) || dentro[i]!.inicio - prev.fin > 0.5;
  };
  const cercanos = dentro.map((w, i) => ({ w, i })).filter(({ w, i }) => Math.abs(w.inicio - c.inicio) <= 1.5 && esInicio(i));
  cercanos.sort((x, y) => Math.abs(x.w.inicio - c.inicio) - Math.abs(y.w.inicio - c.inicio));
  const primera = cercanos[0]?.w ?? dentro.find((w) => w.inicio >= c.inicio) ?? dentro[0]!;
  let inicio = Math.max(0, primera.inicio - 0.2);
  const finales = dentro.filter((w) => w.fin <= c.fin + 0.5 && w.fin >= c.fin - 3 && FIN_FRASE.test(w.texto) && w.fin - inicio >= o.min);
  const ultima = finales[finales.length - 1] ?? [...dentro].reverse().find((w) => w.fin <= c.fin + 0.5) ?? dentro[dentro.length - 1]!;
  let fin = Math.min(duracion, ultima.fin + 0.3);
  if (fin - inicio < o.min) fin = Math.min(duracion, inicio + o.min);
  if (fin - inicio > o.max) fin = inicio + o.max;
  if (fin - inicio < o.min) inicio = Math.max(0, fin - o.min);
  return { inicio: round2(inicio), fin: round2(fin) };
}

/** Cuántas palabras de emoción hay (para reordenar candidatos ya transcritos). */
export function contarEmocion(palabras: Palabra[]): number {
  // Frases de dos palabras («no way», «qué locura») se buscan sobre el texto unido.
  const texto = palabras.map((w) => w.texto).join(" ");
  return (texto.match(new RegExp(EMOCION.source, "gi")) ?? []).length;
}

/** Puntaje final tras transcribir: suma la emoción (con tope) a las señales. */
export function puntajeFinal(c: Candidato): number {
  return round2(c.puntaje + PESOS.emocion * Math.min(4, c.emocion ?? 0));
}

// ---- Chat ----------------------------------------------------------------------------------------

/** Mensajes por segundo de un chat de YouTube (`*.live_chat.json` de yt-dlp: un JSON por línea). */
export function chatYoutube(lineas: string, n: number): number[] {
  const c = new Array<number>(n).fill(0);
  for (const l of lineas.split("\n")) {
    if (!l.trim()) continue;
    try {
      const a = (JSON.parse(l) as { replayChatItemAction?: { videoOffsetTimeMsec?: string; actions?: unknown } }).replayChatItemAction;
      if (!a) continue;
      const t = Math.floor(Number(a.videoOffsetTimeMsec) / 1000);
      if (t >= 0 && t < n) c[t]! += EMOCION_CHAT.test(JSON.stringify(a.actions ?? "")) ? 2 : 1;
    } catch {
      /* línea rota: se ignora */
    }
  }
  return c;
}

/** Mensajes por segundo de un chat.json de TwitchDownloader. */
export function chatTwitch(json: unknown, n: number): number[] {
  const c = new Array<number>(n).fill(0);
  const comentarios = (json as { comments?: { content_offset_seconds?: number; message?: { body?: string } }[] })?.comments ?? [];
  for (const m of comentarios) {
    const t = Math.floor(m.content_offset_seconds ?? -1);
    if (t >= 0 && t < n) c[t]! += EMOCION_CHAT.test(m.message?.body ?? "") ? 2 : 1;
  }
  return c;
}

// ---- Audio ---------------------------------------------------------------------------------------

/** dB RMS por segundo del audio (mono, 8 kHz), leído en flujo: no carga el VOD entero en memoria. */
export async function dbPorSegundo(archivo: string, maxSegundos?: number): Promise<number[]> {
  const SR = 8000;
  const args = ["-hide_banner", "-nostdin", "-v", "error", "-i", archivo];
  if (maxSegundos) args.push("-t", String(maxSegundos));
  args.push("-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "-");
  // Es lo primero que decodifica un VOD bajado: aislado (sin red, sin escribir) si viene de fuera.
  const c = await comando(FFMPEG, args, [archivo], []);
  return new Promise((ok, mal) => {
    const p = spawn(c.cmd, c.args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: number[] = [];
    let suma = 0;
    let cuenta = 0;
    let resto: Buffer = Buffer.alloc(0);
    let err = "";
    p.stdout.on("data", (b: Buffer) => {
      const buf = resto.length ? Buffer.concat([resto, b]) : b;
      const pares = buf.length - (buf.length % 2);
      for (let i = 0; i < pares; i += 2) {
        const x = buf.readInt16LE(i) / 32768;
        suma += x * x;
        if (++cuenta === SR) {
          out.push(20 * Math.log10(Math.sqrt(suma / SR + 1e-9)));
          suma = 0;
          cuenta = 0;
        }
      }
      resto = buf.subarray(pares);
    });
    p.stderr.on("data", (b: Buffer) => (err += b.toString()));
    p.on("error", mal);
    p.on("close", (code) => (code === 0 ? ok(out) : mal(new Error(`ffmpeg (${code}): ${err.slice(-400)}`))));
  });
}
