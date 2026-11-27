/**
 * whisper.cpp directo (sin pasar por `hyperframes transcribe`), con lo que trae OpenWhispr (MIT, revisión
 * 2026-11-20, HEREDADO.md):
 *
 *  - **VAD Silero** (`--vad`, modelo ggml de 885 KB, SHA-256 fijado): whisper sólo decodifica donde hay
 *    voz. Sin él, sobre 12 s de música al final de una voz inventaba «y no te dejes de ver.»; con él, cero
 *    palabras de más y los mismos tiempos al milisegundo en las 112 palabras (tiempo igual, 25–34 s).
 *    Valores de OpenWhispr (`src/constants/whisperVad.json`): umbral 0,5, voz ≥ 250 ms, silencio ≥ 200 ms,
 *    margen 100 ms, solape 0,5 s.
 *  - **Umbrales del decodificador** `--entropy-thold 2.8 --logprob-thold -1.25` (`whisperServer.js:50`:
 *    bajaron las colas inventadas de 2,25 % a 0,06 % en 4814 dictados reales).
 *  - **Probabilidad por palabra** (`p`): whisper.cpp la da por token en `--output-json-full`, pero
 *    Hyperframes la descarta. La palabra toma la menor de sus tokens (sin contar la puntuación).
 *  - **Glosario** opcional (`--prompt`): nombres propios que whisper escribiría mal («yerguen», «GTA VI»).
 *    Con cuidado: también sesga palabras vecinas (en la prueba cambió «linternas» por «linterna», con
 *    p 0,27, que la confianza marca como dudosa) y sobre casi-silencio puede repetir el glosario
 *    (OpenWhispr #1454). Por eso sólo se usa si se pide.
 *
 * Si no hay binario o modelo de whisper en disco (p. ej. la primera vez, antes de que Hyperframes lo
 * compile), quien llama vuelve a `hyperframes transcribe`. Si el VAD falla (binario viejo, sin red para
 * bajar el modelo), se transcribe sin VAD y se avisa.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existe, rutaTemporal, sha256Archivo } from "./archivos";
import { correr, ErrorDeComando, type Registro } from "./proceso";
import { CACHE_HF, FFMPEG, WHISPER_CLI } from "./rutas";

/** Cambia si cambian los argumentos o el armado de palabras: entra en la huella de los pasos. */
export const MOTOR_WHISPER = "whisper-directo-v1";

export const VAD_SILERO = {
  id: "silero-v5.1.2",
  url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
  archivo: "ggml-silero-v5.1.2.bin",
  tamano: 885_098,
  sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
  licencia: "MIT (Silero VAD, convertido a ggml por ggml-org).",
} as const;

/** Valores de VAD de OpenWhispr (`src/constants/whisperVad.json`). */
export const ARGS_VAD = ["--vad-threshold", "0.5", "--vad-min-speech-duration-ms", "250", "--vad-min-silence-duration-ms", "200", "--vad-speech-pad-ms", "100", "--vad-samples-overlap", "0.5"];
export const ARGS_DECODIFICADOR = ["--entropy-thold", "2.8", "--logprob-thold", "-1.25"];

/**
 * Hilos para whisper-cli (GPU-04). Sin `-t`, whisper.cpp usa 4 aunque haya 32 núcleos, y casi todo el tiempo
 * de importar es esto. Por defecto la mitad de los núcleos, entre 4 (lo de whisper) y 8 (deja sitio a un
 * render a la vez). Con `GEEPER_WHISPER_HILOS` se fija a mano. No cambia MOTOR_WHISPER: no se realinea nada.
 */
export function hilosWhisper(nucleos = os.availableParallelism(), env: string | undefined = process.env.GEEPER_WHISPER_HILOS): number {
  const fijo = Number(env);
  if (Number.isInteger(fijo) && fijo >= 1) return Math.min(fijo, 64);
  return Math.max(1, Math.min(8, Math.max(Math.min(4, nucleos), Math.floor(nucleos / 2))));
}

export interface PalabraOidaP {
  text: string;
  start: number;
  end: number;
  /** Probabilidad de whisper (0..1): la menor de los tokens de la palabra. */
  p?: number;
}

export interface OpcionesWhisper {
  modelo: string;
  idioma: string;
  /** Nombres propios o términos raros, separados por coma. */
  glosario?: string;
  /** Usar VAD (por defecto sí). */
  vad?: boolean;
  log?: Registro;
  signal?: AbortSignal;
}

/** whisper-cli: el del instalador (Windows/macOS) o el que compiló Hyperframes (Linux). */
export function rutaWhisperCli(): string {
  return WHISPER_CLI ?? path.join(CACHE_HF, "whisper", "whisper.cpp", "build", "bin", "whisper-cli");
}

export const rutaModeloWhisper = (modelo: string) => path.join(CACHE_HF, "whisper", "models", `ggml-${modelo}.bin`);
export const rutaVad = () => path.join(CACHE_HF, "whisper", "models", VAD_SILERO.archivo);

/** ¿Se puede correr whisper directo? (binario y modelo ya en disco). */
export async function whisperDirectoDisponible(modelo: string): Promise<boolean> {
  return (await existe(rutaWhisperCli())) && (await existe(rutaModeloWhisper(modelo)));
}

/** Deja el modelo de VAD en disco, comprobado por tamaño y SHA-256 (mismo patrón que YuNet en caras.ts). */
export async function asegurarVad(log?: Registro): Promise<string> {
  const ruta = rutaVad();
  if ((await existe(ruta)) && (await sha256Archivo(ruta)) === VAD_SILERO.sha256) return ruta;
  await fs.mkdir(path.dirname(ruta), { recursive: true });
  log?.(`Descargando el VAD ${VAD_SILERO.id} (${Math.round(VAD_SILERO.tamano / 1024)} KB, ${VAD_SILERO.licencia})`);
  const r = await fetch(VAD_SILERO.url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`No pude descargar ${VAD_SILERO.id}: HTTP ${r.status}`);
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length !== VAD_SILERO.tamano) throw new Error(`${VAD_SILERO.id}: llegaron ${datos.length} bytes, se esperaban ${VAD_SILERO.tamano}`);
  const tmp = rutaTemporal(ruta);
  await fs.writeFile(tmp, datos);
  if ((await sha256Archivo(tmp)) !== VAD_SILERO.sha256) {
    await fs.rm(tmp, { force: true });
    throw new Error(`${VAD_SILERO.id}: el SHA-256 no coincide con el fijado; descarté el archivo`);
  }
  await fs.rename(tmp, ruta);
  return ruta;
}

/** Glosario saneado: términos separados por coma, sin saltos de línea, ≤ 400 caracteres (el prompt admite ~224 tokens). */
export function limpiarGlosario(glosario: string | undefined): string | null {
  if (!glosario) return null;
  const terminos = glosario
    .split(/[,\n;]/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const unicos = [...new Set(terminos)];
  let out = "";
  for (const t of unicos) {
    const sig = out ? `${out}, ${t}` : t;
    if (sig.length > 400) break;
    out = sig;
  }
  return out || null;
}

interface TokenW {
  text?: string;
  p?: number;
  offsets?: { from?: number; to?: number };
}

const PUNTUACION = /^[.,!?;:'")\]}>…–—¡¿\-«»]+$/;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Palabras de un `--output-json-full` de whisper.cpp. Las reglas de unión son las de Hyperframes
 * (`parseWhisperCpp`, Apache-2.0): un token sin espacio delante o de puntuación sigue la palabra anterior;
 * las palabras de duración cero se reparten entre sus vecinas.
 */
export function palabrasDeWhisperJson(datos: unknown): PalabraOidaP[] {
  const segmentos = (datos as { transcription?: { tokens?: TokenW[] }[] }).transcription ?? [];
  const out: (PalabraOidaP & { ps: number[] })[] = [];
  for (const seg of segmentos) {
    for (const tok of seg.tokens ?? []) {
      const crudo = tok.text ?? "";
      const texto = crudo.trim();
      if (!texto || texto.startsWith("[_") || texto.startsWith("[BLANK")) continue;
      const desde = (tok.offsets?.from ?? 0) / 1000;
      const hasta = (tok.offsets?.to ?? 0) / 1000;
      const esPunt = PUNTUACION.test(texto);
      const ultima = out[out.length - 1];
      if (esPunt && !ultima) continue; // puntuación suelta al principio: no es una palabra
      if (ultima && (esPunt || !crudo.startsWith(" "))) {
        ultima.text += texto;
        ultima.end = r3(hasta);
        if (!esPunt && typeof tok.p === "number") ultima.ps.push(tok.p);
        continue;
      }
      out.push({ text: texto, start: r3(desde), end: r3(hasta), ps: !esPunt && typeof tok.p === "number" ? [tok.p] : [] });
    }
  }
  // Duración cero: repartir el hueco entre la anterior y la siguiente (interpolateZeroDuration de Hyperframes).
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.start < out[i]!.end) continue;
    let j = i;
    while (j < out.length && !(out[j]!.start < out[j]!.end)) j++;
    const n = j - i;
    const antes = i > 0 ? out[i - 1]!.end : out[i]!.start;
    const despues = j < out.length ? out[j]!.start : antes + n * 0.3;
    const paso = (despues - antes) / n;
    for (let k = i; k < j; k++) {
      out[k]!.start = r3(antes + (k - i) * paso);
      out[k]!.end = r3(antes + (k - i + 1) * paso);
    }
    i = j - 1;
  }
  return out.map(({ ps, ...w }) => (ps.length ? { ...w, p: Math.round(Math.min(...ps) * 1000) / 1000 } : w));
}

/** Transcribe con whisper-cli directo. Lanza error si whisper falla (quien llama decide si vuelve a Hyperframes). */
export async function transcribirWhisper(audio: string, o: OpcionesWhisper): Promise<PalabraOidaP[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-wh-"));
  try {
    const wav = path.join(tmp, "voz.wav");
    await correr(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", audio, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { signal: o.signal });
    const base = path.join(tmp, "transcript");
    const glosario = limpiarGlosario(o.glosario);
    const comunes = ["--model", rutaModeloWhisper(o.modelo), "--output-json-full", "--output-file", base, "--suppress-nst", "--language", o.idioma, "--threads", String(hilosWhisper()), ...ARGS_DECODIFICADOR, ...(glosario ? ["--prompt", glosario] : [])];

    let vad: string[] = [];
    if (o.vad !== false) {
      try {
        vad = ["--vad", "--vad-model", await asegurarVad(o.log), ...ARGS_VAD];
      } catch (e) {
        o.log?.(`Aviso: transcribo sin VAD (${(e as Error).message})`);
      }
    }
    try {
      await correr(rutaWhisperCli(), [...comunes, ...vad, wav], { signal: o.signal });
    } catch (e) {
      if (!vad.length || !(e instanceof ErrorDeComando)) throw e;
      // whisper-cli anterior a 1.7.6 no conoce --vad: se repite sin VAD.
      o.log?.("Aviso: este whisper-cli no aceptó el VAD; transcribo sin VAD");
      await correr(rutaWhisperCli(), [...comunes, wav], { signal: o.signal });
    }
    const palabras = palabrasDeWhisperJson(JSON.parse(await fs.readFile(`${base}.json`, "utf8")));
    o.log?.(`whisper ${o.modelo}${vad.length ? " + VAD" : ""}${glosario ? " + glosario" : ""}: ${palabras.length} palabras`);
    return palabras;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
