/**
 * Voz y tiempos por palabra: Kokoro (hyperframes tts) y whisper.cpp, en CPU. whisper corre directo
 * (`whisper.ts`: VAD, umbrales y probabilidad por palabra); si todavía no está en disco, por
 * `hyperframes transcribe`, que lo compila y baja el modelo la primera vez.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { correrHf } from "./hyperframes";
import { ESCRITORIO, PYTHON_SISTEMA } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { PYTHON_VOZ, RAIZ_REPO } from "./rutas";
import { MOTOR_WHISPER, transcribirWhisper, whisperDirectoDisponible } from "./whisper";
import type { Palabra } from "./esquema";

export const MODELO_WHISPER = "medium";

interface PalabraW {
  text: string;
  start: number;
  end: number;
  /** Probabilidad de whisper (0..1); sólo con whisper directo. */
  p?: number;
}

/** Huella del motor de transcripción para los pasos: cambia si se pasa de Hyperframes a whisper directo. */
export async function motorTranscripcion(): Promise<string> {
  return (await whisperDirectoDisponible(MODELO_WHISPER)) ? MOTOR_WHISPER : "hf-transcribe";
}

/**
 * Transcribe con whisper `medium` y devuelve tiempos por palabra (como mpt_acabado.py). `glosario`:
 * nombres propios para guiar a whisper (sólo con whisper directo; ver whisper.ts).
 */
export async function transcribir(audio: string, idioma: string, log: Registro, o: { glosario?: string; signal?: AbortSignal } = {}): Promise<PalabraW[]> {
  if (await whisperDirectoDisponible(MODELO_WHISPER)) {
    return transcribirWhisper(audio, { modelo: MODELO_WHISPER, idioma, glosario: o.glosario, log, signal: o.signal });
  }
  if (o.glosario) log("Aviso: el glosario no se usa hasta que whisper esté instalado (esta primera vez va por Hyperframes)");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-tr-"));
  try {
    const local = path.join(tmp, "voz" + path.extname(audio));
    await fs.copyFile(audio, local);
    const r = await correrHf(["transcribe", local, "--engine", "whisper", "--model", MODELO_WHISPER, "--language", idioma, "--json"], { cwd: tmp });
    let indicada: string | undefined;
    try {
      const j = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as { transcriptPath?: string; wordCount?: number };
      indicada = j.transcriptPath;
      log(`whisper ${MODELO_WHISPER}: ${j.wordCount ?? "?"} palabras`);
    } catch {
      /* se buscan las rutas conocidas */
    }
    const candidatos = [indicada, path.join(tmp, "transcript.json"), path.join(tmp, "assets", "transcript.json")].filter(
      (x): x is string => Boolean(x),
    );
    let datos: unknown;
    for (const c of candidatos) {
      try {
        datos = JSON.parse(await fs.readFile(c, "utf8"));
        break;
      } catch {
        /* siguiente */
      }
    }
    if (!datos) throw new Error("hyperframes transcribe no dejó transcript.json");
    const lista = (Array.isArray(datos) ? datos : ((datos as { words?: unknown[] }).words ?? [])) as PalabraW[];
    return lista.filter((w) => typeof w.text === "string" && w.text.trim());
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** La alineación es sólo biblioteca estándar: en la app corre con el Python de la voz (lo crea «Preparar el estudio»). */
const PYTHON_ALINEAR = ESCRITORIO ? PYTHON_VOZ : PYTHON_SISTEMA;

async function python(accion: string, datos: unknown): Promise<unknown> {
  const r = await correr(PYTHON_ALINEAR, [path.join(RAIZ_REPO, "py", "geeper_py.py"), accion], { entrada: JSON.stringify(datos) });
  return JSON.parse(r.stdout);
}

/** Alinea el texto del guion con los tiempos de whisper (alinear() de mpt_acabado.py, copiado en py/alineacion.py). */
export async function alinear(guion: string, palabrasW: PalabraW[], durVoz: number): Promise<Palabra[]> {
  const filtradas = palabrasW.filter((w) => w.start < durVoz - 0.05);
  const res = (await python("alinear", { guion, palabras: filtradas })) as PalabraW[];
  return res.map((w) => ({
    texto: w.text,
    inicio: Math.max(0, Math.min(durVoz, w.start)),
    fin: Math.max(0, Math.min(durVoz, w.end)),
  }));
}

/** Kokoro-82M local por `hyperframes tts`. Escribe un WAV en `salida`. */
export async function sintetizar(texto: string, voz: string, velocidad: number, salida: string, log: Registro): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-tts-"));
  try {
    const txt = path.join(tmp, "texto.txt");
    await fs.writeFile(txt, texto);
    const wav = path.join(tmp, "voz.wav");
    await correrHf(["tts", txt, "--voice", voz, "--speed", String(velocidad), "--output", wav], { cwd: tmp, log, env: { HYPERFRAMES_PYTHON: PYTHON_VOZ } });
    await fs.copyFile(wav, salida);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
