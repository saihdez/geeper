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
import { HYPERFRAMES_VERSION, PYTHON_VOZ, RAIZ_REPO } from "./rutas";
import { MOTOR_WHISPER, transcribirWhisper, whisperDirectoDisponible } from "./whisper";
import type { Palabra } from "./esquema";
import { detectarSilencios, puntuarPalabras, resumirConfianza } from "./confianza";
import { probar } from "./media";
import { etiquetaPesos } from "./modelos";
import { paso, type Contexto } from "./pasos";

export const MODELO_WHISPER = "medium";

interface PalabraW {
  text: string;
  start: number;
  end: number;
  /** Probabilidad de whisper (0..1); sólo con whisper directo. */
  p?: number;
}

/**
 * Huella del motor de transcripción para los pasos: cambia si se pasa de Hyperframes a whisper directo, o
 * si se transcribe sin VAD (así no se reutiliza una alineación hecha con VAD).
 */
export async function motorTranscripcion(o: { vad?: boolean } = {}): Promise<string> {
  if (!(await whisperDirectoDisponible(MODELO_WHISPER))) return "hf-transcribe";
  return o.vad === false ? `${MOTOR_WHISPER}+sin-vad` : MOTOR_WHISPER;
}

/**
 * Transcribe con whisper `medium` y devuelve tiempos por palabra (como mpt_acabado.py). `glosario`:
 * nombres propios para guiar a whisper (sólo con whisper directo; ver whisper.ts).
 */
export async function transcribir(
  audio: string,
  idioma: string,
  log: Registro,
  o: { glosario?: string; signal?: AbortSignal; /** Usar VAD (por defecto sí; ver alinearVozNueva). */ vad?: boolean } = {},
): Promise<PalabraW[]> {
  if (await whisperDirectoDisponible(MODELO_WHISPER)) {
    return transcribirWhisper(audio, { modelo: MODELO_WHISPER, idioma, glosario: o.glosario, log, signal: o.signal, vad: o.vad });
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

/**
 * ¿Cuántas palabras de whisper caen fuera del audio? Con VAD, whisper.cpp a veces corre los tiempos
 * hacia adelante (REN-05: hasta 1,8 s al final de 50 s de voz): las últimas quedan después del final y,
 * al recortarlas, la última escena duraba 0,05 s y sus palabras no se veían.
 */
export function palabrasFueraDelAudio(palabras: { start: number; end: number }[], durVoz: number): number {
  return palabras.filter((w) => w.start >= durVoz - 0.05 || w.end > durVoz + 0.1).length;
}

/** Comienzo del error cuando la voz nueva no se pudo acomodar (para reconocerlo). */
export const NO_SE_ACOMODA = "No se pudo acomodar la voz nueva a las escenas.";

/**
 * El error para la persona. Volver a intentarlo igual no sirve: la voz y su alineación salen siempre
 * iguales con el mismo texto, voz y ritmo. Por eso dice qué cambiar.
 */
export function noSeAcomoda(escena?: number | null): string {
  return escena
    ? `${NO_SE_ACOMODA} Cambia un poco el texto de la escena ${escena} o elige otro ritmo de voz.`
    : `${NO_SE_ACOMODA} Cambia un poco el texto o elige otro ritmo de voz.`;
}

/** Lo que encontró la revisión de quien llama: qué pasa y en qué escena (1, 2…), si se sabe. */
export interface ProblemaVoz {
  problema: string;
  escena?: number;
}

/** Alineación que no sirve: se lanza dentro del paso para que no quede guardada y se reutilice. */
class AlineacionMala extends Error {
  constructor(readonly detalle: ProblemaVoz) {
    super(detalle.problema);
  }
}

/**
 * Tiempos por palabra de una voz nueva (Kokoro o VoxCPM: voz sola, sin música), alineados al texto
 * (paso con manifiesto). Va primero SIN VAD: en una voz sintetizada no hay ruido que saltar y el VAD
 * corría los tiempos (REN-05). Si whisper deja palabras fuera del audio (o `revisar` encuentra un
 * problema), prueba con VAD; si también, falla con noSeAcomoda en vez de guardar subtítulos corridos.
 * Una alineación mala no se guarda como paso hecho: si no, se reutilizaría al pedirla otra vez.
 */
export async function alinearVozNueva(
  ctx: Contexto,
  rutaVoz: string,
  texto: string,
  idioma: string,
  o: {
    /** Otra revisión de quien llama (p. ej. que ninguna escena quede de menos de 0,2 s): el problema o null. */
    revisar?: (palabras: Palabra[], dur: number) => ProblemaVoz | null;
    /** Escena (1, 2…) de esta voz, si es de una sola: para decir cuál cambiar. */
    escena?: number;
  } = {},
): Promise<Palabra[]> {
  const revisar = o.revisar ?? (() => null);
  const dur = (await probar(rutaVoz)).duracion;
  const pesos = await etiquetaPesos(`whisper-${MODELO_WHISPER}`);
  const silencios = await detectarSilencios(rutaVoz);
  let escena = o.escena ?? null;
  const revisarTodo = (fuera: number, palabras: Palabra[]): ProblemaVoz | null =>
    fuera ? { problema: `dejó ${fuera} palabra(s) después del final de la voz (${dur.toFixed(2)} s)` } : revisar(palabras, dur);
  for (const vad of [false, true]) {
    const salida = path.join(ctx.dir, "assets", `palabras-${path.parse(rutaVoz).name}-${vad ? "vad" : "sin-vad"}.json`);
    let mala: ProblemaVoz | null = null;
    try {
      await paso(
        ctx,
        "voz.alinear",
        {
          archivos: [rutaVoz],
          params: { texto, idioma, modelo: MODELO_WHISPER, vad },
          motor: `alinear-v3+hyperframes@${HYPERFRAMES_VERSION}+${await motorTranscripcion({ vad })}+${pesos}`,
        },
        [salida],
        async ([tmp]) => {
          const w = await transcribir(rutaVoz, idioma, ctx.log, { vad });
          const palabras = puntuarPalabras(await alinear(texto, w, dur), w, silencios);
          const fuera = palabrasFueraDelAudio(w, dur);
          const problema = revisarTodo(fuera, palabras);
          if (problema) throw new AlineacionMala(problema);
          const c = resumirConfianza([{ id: "voz", palabras }]);
          if (c.dudosas) ctx.log(`Aviso: ${c.dudosas} de ${c.medidas} palabras con tiempos dudosos (${(c.proporcion * 100).toFixed(0)} %)`);
          await fs.writeFile(tmp!, JSON.stringify(palabras));
          return { palabras: palabras.length, whisper: w.length, dudosas: c.dudosas, fuera };
        },
      );
    } catch (e) {
      if (!(e instanceof AlineacionMala)) throw e;
      mala = e.detalle;
    }
    if (!mala) {
      const palabras = JSON.parse(await fs.readFile(salida, "utf8")) as Palabra[];
      // Ya hecho antes (con otra revisión de quien llama): se vuelve a revisar.
      mala = revisar(palabras, dur);
      if (!mala) return palabras;
    }
    escena = mala.escena ?? escena;
    ctx.log(`Aviso: whisper${vad ? " con VAD" : " sin VAD"}: ${mala.problema}${vad ? "" : "; pruebo con VAD"}`);
  }
  throw new Error(noSeAcomoda(escena));
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
