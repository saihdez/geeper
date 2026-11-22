/** Cliente de la API HTTP de MoneyPrinterTurbo (127.0.0.1:8080). */
import { encenderIaMpt } from "./ia-mpt";
import { correr } from "./proceso";
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
 * IA de MPT (Ollama escribe el guion, el servidor de imágenes las dibuja), se enciende antes (GPU-02).
 */
export async function crearVideo(cuerpo: ReturnType<typeof cuerpoVideo>, log?: (l: string) => void): Promise<string> {
  const ia = await encenderIaMpt({ log });
  if (ia.encendidos.length) log?.(`IA de MPT encendida de nuevo: ${ia.encendidos.join(", ")}`);
  const r = await pedir("/videos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const id = (r.json as { data?: { task_id?: string } } | null)?.data?.task_id;
  if (r.status !== 200 || !id) throw new Error(`MPT rechazó el pedido (${r.status}): ${JSON.stringify(r.json).slice(0, 500)}`);
  return id;
}

async function tieneFinal(taskId: string): Promise<boolean> {
  const r = await correr("docker", ["exec", MPT_CONTENEDOR, "test", "-f", `${MPT_TAREAS}/${taskId}/final-1.mp4`], { permitirFallo: true });
  return r.codigo === 0;
}

export async function estadoTarea(taskId: string): Promise<EstadoMpt> {
  const r = await pedir(`/tasks/${taskId}`);
  if (r.status === 404) {
    // La API de MPT guarda el estado en memoria: si se reinició, mira si el video quedó en disco.
    return (await tieneFinal(taskId)) ? { estado: "completa", progreso: 100 } : { estado: "perdida", progreso: 0, detalle: "MPT no conoce la tarea" };
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
