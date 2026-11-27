/** Cliente de la API HTTP de MoneyPrinterTurbo (127.0.0.1:8080). */
import { randomUUID } from "node:crypto";
import { encenderIaMpt } from "./ia-mpt";
import { correr } from "./proceso";
import { asegurarMpt, levantarMptCaido } from "./liberar-mpt";
import { MPT_API, MPT_CONTENEDOR, MPT_TAREAS } from "./rutas";
import type { DatosPlantilla } from "./plantillas";
import type { Formato } from "./esquema";

export interface EstadoMpt {
  estado: "procesando" | "completa" | "fallida" | "perdida";
  progreso: number;
  detalle?: string;
}

async function pedir(ruta: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  let r: Response;
  try {
    r = await fetch(`${MPT_API}/api/v1${ruta}`, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    // «fetch failed» no le dice nada a nadie: casi siempre es que Docker o MPT están apagados.
    const tiempo = e instanceof Error && e.name === "TimeoutError";
    throw new Error(tiempo ? "MPT tardó demasiado en responder: revisa que Docker Desktop esté abierto y MPT funcionando." : "MPT no responde: abre Docker Desktop, espera a que arranque MPT y vuelve a intentar.");
  }
  let json: unknown = null;
  try {
    json = await r.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: r.status, json };
}

/** `guion`: si viene, MPT lo dice tal cual (video_script) y no escribe uno con su LLM. */
export function cuerpoVideo(tema: string, formato: Formato, mpt: DatosPlantilla["mpt"], guion?: string) {
  return {
    video_subject: tema,
    video_script: guion?.trim() ?? "",
    video_language: mpt.video_language,
    voice_name: mpt.voice_name,
    voice_rate: mpt.voice_rate,
    video_source: mpt.video_source,
    video_aspect: formato,
    video_clip_duration: mpt.video_clip_duration,
    video_count: 1,
    paragraph_number: mpt.paragraph_number,
    video_script_prompt: mpt.video_script_prompt,
    // La música la mezcla Geeper (sabe cuál es y su licencia); los subtítulos, también.
    bgm_type: "",
    subtitle_enabled: false,
    n_threads: 2,
  };
}

/**
 * Pide el video. Quien llama ya tiene el candado de la tarjeta (mpt.generar): si un corte dejó apagada la
 * IA de MPT (Ollama escribe el guion, el servidor de imágenes las dibuja), se enciende antes (GPU-02). En la
 * app de escritorio, además, vuelve lo que Wan pausó y se borra su nota (liberar-mpt.ts).
 */
export async function crearVideo(cuerpo: ReturnType<typeof cuerpoVideo>, log?: (l: string) => void): Promise<string> {
  const ia = await encenderIaMpt({ log });
  if (ia.encendidos.length) log?.(`IA de MPT encendida de nuevo: ${ia.encendidos.join(", ")}`);
  await asegurarMpt(log, { todos: true });
  if (soloMateriales()) {
    if (await cliConMateriales()) return arrancarCli(cuerpo, log);
    log?.("GEEPER_MPT_SOLO_MATERIALES=1, pero el MPT que corre no trae «cli.py --stop-at materials»: se pide el video completo por la API");
  }
  const r = await pedir("/videos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const id = (r.json as { data?: { task_id?: string } } | null)?.data?.task_id;
  if (r.status !== 200 || !id) throw new Error(`MPT rechazó el pedido (${r.status}): ${JSON.stringify(r.json).slice(0, 500)}`);
  return id;
}

async function tieneFinal(taskId: string): Promise<boolean> {
  const r = await correr("docker", ["exec", MPT_CONTENEDOR, "test", "-f", `${MPT_TAREAS}/${taskId}/final-1.mp4`], { permitirFallo: true });
  return r.codigo === 0;
}

/**
 * TER-06: de una tarea, Geeper usa sólo el guion (script.json), la voz (audio.mp3) y los clips; el video
 * final que MPT arma después (57–101 s, con NVENC) no lo usa. En task.py el avance llega a 50 cuando
 * terminan los materiales, pero el avance de la descarga también toca 50 justo antes de que se escriba
 * `material_sources`: por eso hace falta pasar de 50 y, además, ver los archivos en disco.
 */
export const PROGRESO_MATERIALES = 50;

/** Los archivos de la tarea que Geeper necesita, según su script.json; null si aún no están (función pura). */
export function archivosParaGeeper(scriptJson: string): string[] | null {
  let s: { script?: unknown; material_sources?: unknown };
  try {
    s = JSON.parse(scriptJson) as typeof s;
  } catch {
    return null;
  }
  if (typeof s.script !== "string" || !s.script.trim() || !Array.isArray(s.material_sources) || !s.material_sources.length) return null;
  const clips = s.material_sources.map((f) => (f && typeof f === "object" ? (f as { local_file?: unknown }).local_file : undefined));
  // MPT guarda el nombre del archivo (Path.name): nada de rutas.
  if (!clips.every((c): c is string => typeof c === "string" && /^[^/\\]+$/.test(c) && c !== "." && c !== "..")) return null;
  return ["script.json", "audio.mp3", ...clips];
}

/** El guion, la voz y todos los clips de la tarea ya están escritos en el contenedor de MPT (TER-06). */
export async function materialesListos(taskId: string): Promise<boolean> {
  const dir = `${MPT_TAREAS}/${taskId}`;
  const s = await correr("docker", ["exec", MPT_CONTENEDOR, "cat", `${dir}/script.json`], { permitirFallo: true, signal: null });
  if (s.codigo !== 0) return false;
  const archivos = archivosParaGeeper(s.stdout);
  if (!archivos) return false;
  const r = await correr(
    "docker",
    ["exec", "-w", dir, MPT_CONTENEDOR, "sh", "-c", 'for f in "$@"; do test -s "$f" || exit 1; done', "sh", ...archivos],
    { permitirFallo: true, signal: null },
  );
  return r.codigo === 0;
}

/**
 * TER-06 completo, apagado por defecto: con GEEPER_MPT_SOLO_MATERIALES=1 la tarea se pide con
 * `cli.py --stop-at materials` por `docker exec` dentro del contenedor de la API, y MPT se detiene al tener
 * el guion, la voz y los clips: no arma su video final (57–101 s con la tarjeta). La API no tiene ese
 * punto de parada (sólo /videos, /subtitle y /audio). La tarea queda en la misma carpeta
 * (storage/tasks/<id>), así que la importación no cambia.
 */
export const soloMateriales = (env: Record<string, string | undefined> = process.env) => env.GEEPER_MPT_SOLO_MATERIALES === "1";

/** Dónde escribe cli.py lo que va haciendo, dentro del contenedor (fuera de las carpetas de MPT). */
export const logCli = (taskId: string) => `/tmp/geeper-mpt-${taskId}.log`;

/** Los argumentos de cli.py para el mismo pedido que cuerpoVideo manda a la API (función pura). */
export function argsCli(taskId: string, c: ReturnType<typeof cuerpoVideo>): string[] {
  const a = ["--task-id", taskId, "--stop-at", "materials", "--video-subject", c.video_subject];
  if (c.video_script) a.push("--video-script", c.video_script);
  a.push(
    "--video-language", c.video_language,
    "--voice-name", c.voice_name,
    "--voice-rate", String(c.voice_rate),
    "--video-source", c.video_source,
    "--video-aspect", c.video_aspect,
    "--video-clip-duration", String(c.video_clip_duration),
    "--video-count", String(c.video_count),
    "--paragraph-number", String(c.paragraph_number),
    "--n-threads", String(c.n_threads),
    "--bgm-type", c.bgm_type || "none",
    c.subtitle_enabled ? "--subtitle-enabled" : "--no-subtitle-enabled",
  );
  if (c.video_script_prompt) a.push("--video-script-prompt", c.video_script_prompt);
  return a;
}

/** El MPT que corre trae cli.py con la parada en «materials» (se lee su --help, que no carga nada más). */
async function cliConMateriales(): Promise<boolean> {
  const r = await correr("docker", ["exec", MPT_CONTENEDOR, "python", "cli.py", "--help"], { permitirFallo: true, signal: null, timeout: 60_000 });
  return r.codigo === 0 && /--stop-at/.test(r.stdout) && /\bmaterials\b/.test(r.stdout);
}

/**
 * Lo que se sabe de una tarea de cli.py a partir de `estadoCli` (función pura): null si no es una tarea
 * de cli.py (no hay log); si su proceso sigue, un avance aproximado (por los archivos que ya escribió);
 * si terminó, las últimas líneas de su log.
 */
export function leerEstadoCli(codigo: number, stdout: string): { corriendo: true; progreso: number } | { corriendo: false; log: string } | null {
  if (codigo !== 0) return null;
  const [primera = "", ...resto] = stdout.split("\n");
  const m = /^corriendo (\d+)$/.exec(primera.trim());
  if (m) return { corriendo: true, progreso: Number(m[1]) };
  return { corriendo: false, log: resto.join("\n").trim() };
}

/** Script de sh para `estadoCli`: $1 = id de la tarea, $2 = su log. */
const SH_ESTADO_CLI = [
  'id="$1"; log="$2"; [ -f "$log" ] || exit 3',
  'for p in /proc/[0-9]*; do',
  '  [ "$p" = "/proc/$$" ] && continue',
  '  case "$(tr "\\000" " " 2>/dev/null < "$p/cmdline")" in',
  '    *"cli.py --task-id $id "*) d="storage/tasks/$id"; n=5; [ -s "$d/script.json" ] && n=20; [ -s "$d/audio.mp3" ] && n=40; echo "corriendo $n"; exit 0;;',
  "  esac",
  "done",
  'echo terminada; tail -n 15 "$log"',
].join("\n");

export async function estadoCli(taskId: string) {
  const r = await correr("docker", ["exec", "-w", "/MoneyPrinterTurbo", MPT_CONTENEDOR, "sh", "-c", SH_ESTADO_CLI, "sh", taskId, logCli(taskId)], { permitirFallo: true, signal: null });
  return leerEstadoCli(r.codigo, r.stdout);
}

/**
 * Lanza cli.py dentro del contenedor (`docker exec -d`: sigue aunque el worker se reinicie) y espera a ver
 * su proceso o su log, para que la primera consulta no la tome por perdida.
 */
export async function arrancarCli(
  cuerpo: ReturnType<typeof cuerpoVideo>,
  log?: (l: string) => void,
  op: { intentos?: number; pasoMs?: number } = {},
): Promise<string> {
  const taskId = randomUUID();
  await correr(
    "docker",
    ["exec", "-d", "-w", "/MoneyPrinterTurbo", MPT_CONTENEDOR, "sh", "-c", 'log="$1"; shift; exec python cli.py "$@" >"$log" 2>&1', "sh", logCli(taskId), ...argsCli(taskId, cuerpo)],
    { signal: null },
  );
  for (let i = 0; i < (op.intentos ?? 30); i++) {
    const e = await estadoCli(taskId);
    if (e?.corriendo || (e && e.log)) {
      log?.(`MPT (cli.py --stop-at materials) empezó la tarea ${taskId}: no armará su video final`);
      return taskId;
    }
    await new Promise((ok) => setTimeout(ok, op.pasoMs ?? 500));
  }
  throw new Error("MPT no arrancó cli.py dentro de su contenedor. Revisa que Docker Desktop y MPT estén funcionando y vuelve a intentar.");
}

export async function estadoTarea(taskId: string): Promise<EstadoMpt> {
  const r = await pedir(`/tasks/${taskId}`);
  if (r.status === 404) {
    // Una tarea de cli.py (TER-06) no está en la memoria de la API: se mira su proceso. Mientras corre,
    // script.json puede listar sólo los clips bajados hasta ahora; por eso no se miran antes los archivos.
    const cli = await estadoCli(taskId);
    if (cli?.corriendo) return { estado: "procesando", progreso: cli.progreso };
    // La API de MPT guarda el estado en memoria: si se reinició, mira si quedó en disco lo que Geeper usa.
    if ((await tieneFinal(taskId)) || (await materialesListos(taskId))) return { estado: "completa", progreso: 100 };
    if (cli) return { estado: "fallida", progreso: 0, detalle: `cli.py de MPT terminó sin dejar los materiales. ${cli.log}`.slice(0, 800) };
    return { estado: "perdida", progreso: 0, detalle: "MPT no conoce la tarea" };
  }
  const d = (r.json as { data?: { state?: number; progress?: number; videos?: string[] } } | null)?.data ?? {};
  const progreso = Number(d.progress ?? 0);
  if (d.state === 1) return { estado: "completa", progreso: 100 };
  if (d.state === -1) return { estado: "fallida", progreso, detalle: JSON.stringify(d).slice(0, 800) };
  return { estado: "procesando", progreso };
}

/**
 * Tras cancelar «Generar video», MPT sigue generando la tarea 3–7 min más: si se soltara la tarjeta en ese
 * momento, el video siguiente correría encima (GPU-03). Esto vigila la tarea hasta que MPT la dé por
 * terminada, fallida o perdida (o hasta `topeMs`) y entonces suelta el candado. No espera: vigila aparte.
 */
export function soltarCuandoTermine(
  taskId: string,
  candado: { liberar(): void },
  op: { topeMs?: number; pasoMs?: number; log?: (l: string) => void; estado?: (id: string) => Promise<EstadoMpt> } = {},
): Promise<EstadoMpt["estado"] | "tope"> {
  const estado = op.estado ?? estadoTarea;
  const limite = Date.now() + (op.topeMs ?? 10 * 60_000);
  return (async () => {
    try {
      while (Date.now() < limite) {
        const e = await estado(taskId).catch(() => null);
        if (e && e.estado !== "procesando") {
          op.log?.(`MPT dejó la tarea ${taskId} (${e.estado}): se suelta la tarjeta`);
          return e.estado;
        }
        await new Promise((ok) => setTimeout(ok, op.pasoMs ?? 5000));
      }
      op.log?.(`MPT sigue con la tarea ${taskId} tras el tope: se suelta la tarjeta igual`);
      return "tope" as const;
    } finally {
      candado.liberar();
    }
  })();
}

/**
 * La API viva, o levantada: si no responde y hay contenedores de MPT parados (un reinicio de WSL los tumba),
 * los levanta y espera hasta `esperaMs` a que contesten. Sólo en la app de escritorio (liberar-mpt.ts).
 */
export async function asegurarApi(log?: (l: string) => void, esperaMs = 120_000): Promise<boolean> {
  if (await apiViva()) return true;
  const levantados = await levantarMptCaido(log);
  if (!levantados.length) return false;
  const hasta = Date.now() + esperaMs;
  while (Date.now() < hasta) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await apiViva()) return true;
  }
  return false;
}

export async function apiViva(): Promise<boolean> {
  try {
    const r = await fetch(`${MPT_API}/api/v1/tasks?page=1&page_size=1`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function modeloImagen(): Promise<string | undefined> {
  const r = await correr("docker", ["exec", "mpt-image-server", "printenv", "IMAGE_MODEL"], { permitirFallo: true });
  const v = r.stdout.trim();
  return v ? v.split("/").pop() : undefined;
}

/** Sólo voz (POST /audio): Kokoro de MPT en CPU, sin guion por LLM ni imágenes. */
export async function crearAudio(texto: string, voz: string, velocidad: number, idioma: string): Promise<string> {
  const r = await pedir("/audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      video_script: texto,
      voice_name: voz.includes(":") ? voz : `kokoro:${voz}`,
      voice_rate: velocidad,
      video_language: idioma,
      bgm_type: "",
    }),
  });
  const id = (r.json as { data?: { task_id?: string } } | null)?.data?.task_id;
  if (r.status !== 200 || !id) throw new Error(`MPT rechazó el audio (${r.status}): ${JSON.stringify(r.json).slice(0, 500)}`);
  return id;
}

export async function esperarAudio(taskId: string, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (signal?.aborted) throw new Error("Cancelado");
    const r = await pedir(`/tasks/${taskId}`);
    const d = (r.json as { data?: { state?: number } } | null)?.data ?? {};
    if (d.state === 1) return;
    if (d.state === -1 || r.status === 404) throw new Error(`MPT no pudo generar el audio (${taskId})`);
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw new Error("MPT tardó demasiado en generar el audio");
}
