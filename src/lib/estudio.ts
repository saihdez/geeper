/**
 * «Preparar el estudio» (app de escritorio, fase 2 de docs/ESCRITORIO.md): deja listo un equipo nuevo con
 * un clic, sin que la persona instale Python, compiladores ni nada a mano.
 *
 *  1. Navegador para renderizar (Chrome de Hyperframes).
 *  2. Voz: Python propio creado con uv (viene en el instalador) + kokoro-onnx; una frase de prueba baja
 *     los modelos de Kokoro.
 *  3. Transcribir: whisper-cli (viene en el instalador) + el modelo `medium`, probado con esa frase.
 *  4. Clips: Python con OpenCV y yt-dlp, y el modelo YuNet.
 *  5. PhotoCraft y VectorCraft (instaladores de Craft).
 *  6. Docker: sólo se revisa. MoneyPrinterTurbo y la IA local viven en el PC del estudio (decidido el
 *     2026-11-20); sin Docker, todo lo demás funciona.
 *
 * Cada paso primero comprueba; sólo instala lo que falta, así que se puede repetir sin miedo. Todo queda en
 * la carpeta de herramientas (rutas.ts ESTUDIO), nunca en el sistema. Una preparación a la vez por servidor.
 */
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asegurarYunet, PYTHON_CARAS } from "./caras";
import { correrHf } from "./hyperframes";
import { estadoInstalacion as estadoPhotocraft, iniciarInstalacion as iniciarPhotocraft, type EstadoInstalacion } from "./instalar-photocraft";
import { estadoInstalacionVectorcraft, iniciarInstalacionVectorcraft } from "./instalar-vectorcraft";
import { versionPhotocraft } from "./photocraft";
import { ESCRITORIO, pythonDeVenv, SISTEMA } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { CACHE_HF, ESTUDIO, PHOTOCRAFT_VERSION, PYTHON_VOZ, UV, VECTORCRAFT_VERSION, VENV_CLIPS, WHISPER_CLI } from "./rutas";
import { versionVectorcraft } from "./vectorcraft";
import { MODELO_WHISPER, sintetizar, transcribir } from "./voz";
import { asegurarVad, rutaVad } from "./whisper";

/** Python de los venvs (uv lo baja: no hace falta tenerlo instalado). */
export const PYTHON_VERSION = "3.12";

/** Paquetes fijados, los mismos que usa el estudio de desarrollo. */
export const PAQUETES = {
  voz: ["kokoro-onnx==0.6.1", "soundfile==0.14.0"],
  clips: ["numpy==2.5.5", "opencv-python-headless==4.14.0.94", "yt-dlp[default]==2026.10.26"],
} as const;

const VOZ_PRUEBA = { texto: "Hola, esto es una prueba de voz de Geeper.", voz: "ef_dora", idioma: "es" };

/** Entorno de uv: el Python, su caché y los venvs quedan dentro de las herramientas. */
export function entornoUv(base = ESTUDIO, disco: (p: string) => number | null = numeroDeDisco): Record<string, string> {
  const cache = process.env.UV_CACHE_DIR ?? path.join(base, "uv-cache");
  return {
    UV_PYTHON_INSTALL_DIR: path.join(base, "python"),
    UV_CACHE_DIR: cache,
    // Sólo el Python que baja uv: uno del sistema (o el de la Tienda de Windows) podría no servir.
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_LINK_MODE: modoEnlaceUv(cache, base, disco),
    UV_NO_PROGRESS: "1",
  };
}

/** El número del disco de una ruta (o de su carpeta más cercana que exista); null si no se sabe. */
function numeroDeDisco(p: string): number | null {
  for (let d = path.resolve(p); ; d = path.dirname(d)) {
    try {
      return statSync(d).dev;
    } catch {
      if (path.dirname(d) === d) return null;
    }
  }
}

/**
 * TER-02: con «copy» la caché guardaba una segunda copia de todo lo instalado (13,4 GB en Wan2GP y ComfyUI).
 * Si la caché y los venvs están en el mismo disco se enlazan (no ocupa dos veces); si no, o si no se sabe
 * (OneDrive, otra unidad), se copia como antes. Si un enlace falla, uv copia solo.
 */
export function modoEnlaceUv(cache: string, base: string, disco: (p: string) => number | null = numeroDeDisco): "hardlink" | "copy" {
  const a = disco(cache);
  const b = disco(base);
  return a !== null && a === b ? "hardlink" : "copy";
}

/** Comandos de uv para crear un venv desde cero e instalarle paquetes (función pura, para las pruebas). */
export function comandosVenv(venv: string, paquetes: readonly string[]): string[][] {
  return [
    ["venv", "--clear", "--python", PYTHON_VERSION, venv],
    ["pip", "install", "--python", pythonDeVenv(venv), ...paquetes],
  ];
}

export type FasePaso = "pendiente" | "revisando" | "instalando" | "listo" | "falta" | "aviso" | "error";

export interface EstadoPaso {
  id: string;
  nombre: string;
  paraQue: string;
  estado: FasePaso;
  detalle: string;
}

export interface EstadoEstudio {
  /** Sólo en la app de escritorio: en desarrollo el estudio se arma a mano (ESTUDIO.md). */
  disponible: boolean;
  corriendo: boolean;
  pasos: EstadoPaso[];
  /** Últimas líneas de lo que se hizo (para ver qué pasó si algo falla). */
  registro: string[];
  revisado: string | null;
}

interface Paso {
  id: string;
  nombre: string;
  paraQue: string;
  /** Detalle si está listo; null si falta. */
  comprobar: () => Promise<string | null>;
  /** Sin instalar: sólo se revisa (Docker). */
  instalar?: (log: Registro) => Promise<void>;
  /** Mensaje cuando falta y no se instala. */
  siFalta?: string;
  /** Pasos que tienen que estar listos antes. */
  requiere?: string[];
}

const existe = (p: string) => fs.access(p).then(() => true, () => false);

async function pythonCon(py: string, modulos: string): Promise<string | null> {
  if (!(await existe(py))) return null;
  const r = await correr(py, ["-I", "-c", `import ${modulos}, sys; print(sys.version.split()[0])`], { permitirFallo: true, timeout: 60_000 }).catch(() => null);
  return r?.codigo === 0 ? r.stdout.trim() : null;
}

async function crearVenv(venv: string, paquetes: readonly string[], log: Registro) {
  await fs.mkdir(path.dirname(venv), { recursive: true });
  for (const args of comandosVenv(venv, paquetes)) await correr(UV, args, { env: entornoUv(), log, timeout: 30 * 60_000 });
}

/** Espera a que termine una instalación de Craft y lanza su error si falló. */
async function instalarCraft(iniciar: () => EstadoInstalacion, estado: () => EstadoInstalacion, log: Registro) {
  iniciar();
  let ultimo = "";
  for (;;) {
    const e = estado();
    if (e.detalle !== ultimo) log((ultimo = e.detalle));
    if (e.fase === "lista") return;
    if (e.fase === "error" || e.fase === "inactiva") throw new Error(e.detalle || "no se instaló");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const dirKokoro = () => path.join(CACHE_HF, "tts");
const modeloWhisper = () => path.join(CACHE_HF, "whisper", "models", `ggml-${MODELO_WHISPER}.bin`);
const tamano = (p: string) => fs.stat(p).then((s) => s.size, () => 0);

/** Una frase con Kokoro (baja sus modelos la primera vez). Devuelve el WAV. */
async function frasePrueba(log: Registro): Promise<string> {
  const wav = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "geeper-estudio-")), "prueba.wav");
  await sintetizar(VOZ_PRUEBA.texto, VOZ_PRUEBA.voz, 1, wav, log);
  return wav;
}

function pasos(): Paso[] {
  return [
    {
      id: "navegador",
      nombre: "Navegador para renderizar",
      paraQue: "Hyperframes dibuja cada cuadro del video en un Chrome sin ventana.",
      comprobar: async () => {
        const r = await correrHf(["browser", "path"], { permitirFallo: true, timeout: 60_000 }).catch(() => null);
        const ruta = r?.codigo === 0 ? r.stdout.trim().split("\n").pop() : "";
        return ruta && existsSync(ruta) ? ruta : null;
      },
      instalar: async (log) => void (await correrHf(["browser", "ensure"], { log, timeout: 30 * 60_000 })),
    },
    {
      id: "voz",
      nombre: "Voz (Kokoro)",
      paraQue: "Regenerar la voz de un video desde su guion, sin internet.",
      comprobar: async () => {
        const v = await pythonCon(PYTHON_VOZ, "kokoro_onnx, soundfile");
        const modelos = (await tamano(path.join(dirKokoro(), "models", "kokoro-v1.0.onnx"))) > 0 && (await tamano(path.join(dirKokoro(), "voices", "voices-v1.0.bin"))) > 0;
        return v && modelos ? `Python ${v} con kokoro-onnx y sus modelos` : null;
      },
      instalar: async (log) => {
        if (!(await pythonCon(PYTHON_VOZ, "kokoro_onnx, soundfile"))) await crearVenv(path.dirname(path.dirname(PYTHON_VOZ)), PAQUETES.voz, log);
        log("Probando la voz (la primera vez baja los modelos de Kokoro, ~340 MB)…");
        const wav = await frasePrueba(log);
        await fs.rm(path.dirname(wav), { recursive: true, force: true });
      },
    },
    {
      id: "transcribir",
      nombre: "Transcribir (whisper)",
      paraQue: "Tiempos de cada palabra para los subtítulos al regenerar la voz o importar un clip.",
      requiere: ["voz"],
      comprobar: async () => {
        const modelo = (await tamano(modeloWhisper())) > 1e9;
        // En Windows y macOS whisper-cli viene en el instalador; en Linux Hyperframes lo compila.
        const programa = WHISPER_CLI ? existsSync(WHISPER_CLI) : SISTEMA === "linux";
        // El filtro de voz (VAD) evita palabras inventadas sobre música o silencio (whisper.ts).
        const vad = existsSync(rutaVad());
        return modelo && programa && vad ? `whisper ${MODELO_WHISPER} listo, con filtro de voz${WHISPER_CLI ? ` (${path.basename(WHISPER_CLI)})` : ""}` : null;
      },
      instalar: async (log) => {
        if (SISTEMA !== "linux" && !WHISPER_CLI) throw new Error("Falta whisper-cli en el instalador: vuelve a instalar Geeper.");
        await asegurarVad(log);
        log(`Probando la transcripción (la primera vez baja el modelo ${MODELO_WHISPER}, ~1,5 GB)…`);
        const wav = await frasePrueba(log);
        try {
          const palabras = await transcribir(wav, VOZ_PRUEBA.idioma, log);
          if (!palabras.length) throw new Error("whisper no reconoció ninguna palabra en la frase de prueba");
          log(`Oyó: «${palabras.map((p) => p.text).join(" ").trim()}»`);
        } finally {
          await fs.rm(path.dirname(wav), { recursive: true, force: true });
        }
      },
    },
    {
      id: "clips",
      nombre: "Clips de material largo",
      paraQue: "Bajar VODs y videos (yt-dlp) y encuadrar la cara al pasar a vertical (OpenCV + YuNet).",
      comprobar: async () => {
        const v = await pythonCon(PYTHON_CARAS, "cv2, numpy, yt_dlp");
        if (!v) return null;
        try {
          await asegurarYunet();
          return `Python ${v} con OpenCV y yt-dlp, modelo YuNet verificado`;
        } catch {
          return null;
        }
      },
      instalar: async (log) => {
        if (!(await pythonCon(PYTHON_CARAS, "cv2, numpy, yt_dlp"))) await crearVenv(VENV_CLIPS, PAQUETES.clips, log);
        await asegurarYunet(log);
      },
    },
    {
      id: "photocraft",
      nombre: `PhotoCraft ${PHOTOCRAFT_VERSION}`,
      paraQue: "Portadas desde plantillas PSD y looks de color.",
      comprobar: async () => {
        const v = await versionPhotocraft();
        return v?.includes(PHOTOCRAFT_VERSION) ? v : null;
      },
      instalar: (log) => instalarCraft(iniciarPhotocraft, estadoPhotocraft, log),
    },
    {
      id: "vectorcraft",
      nombre: `VectorCraft ${VECTORCRAFT_VERSION}`,
      paraQue: "Logos de Illustrator, PDF, EPS o Affinity, y vectorizar un PNG.",
      comprobar: async () => {
        const v = await versionVectorcraft();
        return v?.includes(VECTORCRAFT_VERSION) ? v : null;
      },
      instalar: (log) => instalarCraft(iniciarInstalacionVectorcraft, estadoInstalacionVectorcraft, log),
    },
    {
      id: "docker",
      nombre: "Docker (opcional)",
      paraQue: "Generar videos nuevos con MoneyPrinterTurbo y la IA local de títulos, ganchos e ideas.",
      comprobar: async () => {
        const r = await correr("docker", ["version", "--format", "{{.Server.Version}}"], { permitirFallo: true, timeout: 20_000 }).catch(() => null);
        return r?.codigo === 0 ? `Docker ${r.stdout.trim()} responde` : null;
      },
      siFalta:
        "Sin Docker en este equipo: MoneyPrinterTurbo y la IA local se usan en el PC del estudio. Aquí funciona todo lo demás (editar, render, voz, clips, portadas, Media, anuncios).",
    },
  ];
}

const REGISTRO_MAX = 200;
interface Global {
  __estudio?: { estado: EstadoEstudio; enCurso: Promise<void> | null };
}
const g = globalThis as unknown as Global;

function memoria() {
  return (g.__estudio ??= {
    estado: {
      disponible: ESCRITORIO,
      corriendo: false,
      pasos: pasos().map((p) => ({ id: p.id, nombre: p.nombre, paraQue: p.paraQue, estado: "pendiente", detalle: "" })),
      registro: [],
      revisado: null,
    },
    enCurso: null,
  });
}

function anotar(linea: string) {
  const e = memoria().estado;
  for (const l of linea.split("\n").map((x) => x.trimEnd()).filter(Boolean)) e.registro.push(l.slice(0, 400));
  if (e.registro.length > REGISTRO_MAX) e.registro.splice(0, e.registro.length - REGISTRO_MAX);
}

function poner(id: string, estado: FasePaso, detalle: string) {
  const p = memoria().estado.pasos.find((x) => x.id === id);
  if (p) Object.assign(p, { estado, detalle });
}

export function estadoEstudio(): EstadoEstudio {
  return memoria().estado;
}

/** Revisa todo sin instalar nada (lo que muestra Sistema al abrir). */
export async function revisarEstudio(): Promise<EstadoEstudio> {
  const m = memoria();
  if (m.enCurso) return m.estado;
  await Promise.all(
    pasos().map(async (p) => {
      if (!m.enCurso) poner(p.id, "revisando", "");
      const ok = await p.comprobar().catch(() => null);
      // Si mientras tanto alguien pulsó «Preparar», manda el estado de la preparación.
      if (!m.enCurso) poner(p.id, ok ? "listo" : p.instalar ? "falta" : "aviso", ok ?? p.siFalta ?? "");
    }),
  );
  if (!m.enCurso) m.estado.revisado = new Date().toISOString();
  return m.estado;
}

/** Prepara lo que falte, paso por paso. Vuelve enseguida; el avance se lee con estadoEstudio(). */
export function prepararEstudio(): EstadoEstudio {
  const m = memoria();
  if (!ESCRITORIO) throw new Error("«Preparar el estudio» es para la app de escritorio; en desarrollo, ver ESTUDIO.md.");
  if (m.enCurso) return m.estado;
  m.estado.corriendo = true;
  m.estado.registro = [];
  m.enCurso = (async () => {
    const listos = new Set<string>();
    for (const p of pasos()) {
      const log: Registro = (l) => anotar(`[${p.id}] ${l}`);
      poner(p.id, "revisando", "");
      try {
        let ok = await p.comprobar();
        if (!ok && p.instalar) {
          const faltan = (p.requiere ?? []).filter((r) => !listos.has(r));
          if (faltan.length) throw new Error(`Primero tiene que quedar listo: ${faltan.join(", ")}`);
          poner(p.id, "instalando", "Instalando…");
          log("Instalando…");
          await p.instalar(log);
          ok = await p.comprobar();
          if (!ok) throw new Error("Se instaló pero la comprobación no pasa; mira el registro.");
        }
        if (ok) {
          listos.add(p.id);
          poner(p.id, "listo", ok);
          log(`Listo: ${ok}`);
        } else {
          poner(p.id, "aviso", p.siFalta ?? "");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Error: ${msg}`);
        // Del error de un comando, la última línea es la que dice algo.
        poner(p.id, "error", msg.trim().split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? msg);
      }
    }
  })().finally(() => {
    m.estado.corriendo = false;
    m.estado.revisado = new Date().toISOString();
    m.enCurso = null;
  });
  return m.estado;
}

/** Espera a que termine la preparación en curso (scripts y pruebas). */
export async function esperarEstudio(): Promise<EstadoEstudio> {
  await memoria().enCurso;
  return memoria().estado;
}
