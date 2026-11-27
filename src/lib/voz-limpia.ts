/**
 * «Mejorar la voz» de los clips (voz real de creadores, con ventiladores, teclados o cuarto con eco).
 * Idea de la cadena «Studio Sound» de Cap (`crates/audio/src/voice*.rs`), hecha sólo con filtros que
 * trae ffmpeg: sin modelos externos que bajar ni licencias que revisar (Cap usa RNNoise; aquí afftdn).
 *
 *  pasa-altos 90 Hz (golpes y zumbido) → afftdn (ruido de fondo, con seguimiento) → ecualización de voz
 *  más suave que la de Cap (−3 dB a 350 Hz, +3 dB a 3,5 kHz, +2 dB sobre 9 kHz) → compresor 2:1
 *  (umbral ≈ −18 dBFS, ataque 15 ms, relajación 180 ms) que empareja gritos y susurros.
 * La sonoridad final (−14 LUFS, pico ≤ −1 dBTP) la pone la entrega, como en todo proyecto.
 *
 * Medido el 2026-11-20 sobre voz con ruido rosa agregado a −32 dB: el fondo baja 5,3 dB y la voz queda
 * igual (relación voz/fondo de 35,0 a 40,2 dB, la del original sin ruido). En voz ya limpia no cambia nada
 * audible. anlmdn quitaba menos (37,8 dB) y tarda 10 veces más.
 */
import { ffmpeg } from "./media";
import type { Registro } from "./proceso";

export const FILTRO_VOZ =
  "highpass=f=90,afftdn=nr=12:nf=-45:tn=1," +
  "equalizer=f=350:t=q:w=1.2:g=-3,equalizer=f=3500:t=q:w=0.9:g=3,highshelf=f=9000:g=2," +
  "acompressor=threshold=0.125:ratio=2:attack=15:release=180:knee=2.828";

/** Versión del filtro (para la huella de los pasos): cambiarla rehace las voces limpias. */
export const VERSION_FILTRO_VOZ = "voz-limpia-v1";

export async function limpiarVoz(entrada: string, salida: string, log?: Registro, recorte?: { desde: number; dur: number }): Promise<void> {
  const corte = recorte ? ["-ss", recorte.desde.toFixed(3), "-t", recorte.dur.toFixed(3)] : [];
  await ffmpeg([...corte, "-i", entrada, "-map", "0:a:0", "-af", FILTRO_VOZ, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", salida], log);
}
