/**
 * Presentador: un avatar de la biblioteca (avatares.ts) habla con la voz del proyecto. InfiniteTalk
 * (Wan2GP, `infinitetalk`) mueve boca, cabeza y ojos siguiendo el audio, y el resultado entra al video:
 *
 *  - **pantalla**: el avatar llena el cuadro en las escenas elegidas. El clip queda en `sincro: "voz"`
 *    sobre el audio sin recortes de cada escena, así que recortar palabras después corta también la
 *    imagen y la boca no se desincroniza.
 *  - **burbuja**: el avatar habla en un recuadro en una esquina durante todo el video (pista libre
 *    «presentador» con `marco`). Se hace sobre la voz final: si después cambia lo que se dice, el panel
 *    avisa que hay que volver a generarlo.
 *
 * InfiniteTalk 14B a 480p con el acelerador lightx2v de 4 pasos; la imagen va en `image_refs` («0KI»:
 * cada imagen de referencia empieza un plano) y el audio en `audio_guide`. Validado con `--dry-run`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { jsonEstable, sha256Archivo, sha256Texto } from "./archivos";
import { leerAvatar, rutaRetrato, type Avatar } from "./avatares";
import { conFocos } from "./caras";
import { registrarAsset } from "./ediciones";
import { Marco, pista, validarProyecto, type Clip, type Formato, type Proyecto } from "./esquema";
import { ENTRADA, escenasEnLinea, type EscenaEnLinea } from "./linea";
import type { Contexto } from "./pasos";
import { correr } from "./proceso";
import { FFMPEG } from "./rutas";
import { generarPlano, instalacionWan2gp, probarWan2gp, type AjustesWan2gp, type Avance } from "./wan2gp";

export const MODELO_HABLAR = "infinitetalk";
export const FPS_HABLAR = 25;
/** Acelerador lightx2v (perfil «Image2Video lightx2v - 4 Steps» de Wan2GP). */
export const LORA_HABLAR = "https://huggingface.co/DeepBeepMeep/Wan2.1/resolve/main/loras_accelerators/Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors";
export const LICENCIA_HABLAR =
  "Apache-2.0 (Wan-AI/Wan2.1-I2V-14B-480P + MeiGen-AI/InfiniteTalk + lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v; wav2vec2 MIT)";
/** Más largo que esto tarda demasiado (y la identidad puede ir derivando): se pide partirlo. */
export const MAX_SEGUNDOS = 120;
export const PISTA_PRESENTADOR = "presentador";

export const CALIDADES = {
  normal: { nombre: "Normal (480p)", resoluciones: { "9:16": "480x832", "16:9": "832x480", "1:1": "640x640" } satisfies Record<Formato, string>, flowShift: 7 },
  alta: { nombre: "Alta (720p, mucho más lenta)", resoluciones: { "9:16": "720x1280", "16:9": "1280x720", "1:1": "960x960" } satisfies Record<Formato, string>, flowShift: 11 },
} as const;
export type Calidad = keyof typeof CALIDADES;

/** La burbuja es un recorte de la cara: alcanza con 480p cuadrado-vertical. */
const RESOLUCION_BURBUJA = "480x640";

export interface OpcionesPresentador {
  avatar: string;
  modo: "pantalla" | "burbuja";
  /** Pantalla: ids de las escenas (por defecto, todas). */
  escenas?: string[];
  calidad?: Calidad;
  marco?: Partial<Marco>;
  /** Cómo se mueve o qué actitud tiene (por defecto, hablar natural a cámara). */
  prompt?: string;
  semilla?: number;
  /**
   * Imagen de la que parte en vez del retrato (actuar.ts: el avatar de medio cuerpo, de cuerpo completo,
   * sobre fondo verde o ya puesto en el lugar de la escena). Ruta absoluta.
   */
  imagen?: string;
}

export interface TramoAudio {
  /** Asset de voz y rango sobre él (s). */
  asset: string;
  inicio: number;
  duracion: number;
  /** Pantalla: la escena que cubre y dónde empieza dentro del video generado (s). */
  escena?: string;
  offset: number;
}

export interface PlanPresentador {
  modo: OpcionesPresentador["modo"];
  escenas: { id: string; numero: number }[];
  tramos: TramoAudio[];
  /** Pantalla: silencio al comienzo del audio (para la entrada del video). Burbuja: la entrada ya va en los tramos. */
  silencioInicial: number;
  segundos: number;
  cuadros: number;
  resolucion: string;
  marco: Marco | null;
  huella: string;
  prompt: string;
  notas: string[];
  avisos: string[];
}

export const PROMPT_HABLAR = "The character talks to the camera naturally, with subtle head movements, natural blinking and expressive lips, steady camera";

/** Cuadros para Wan (4k + 1) que cubren `segundos` a 25 fps. */
export function cuadrosHablar(segundos: number): number {
  return Math.ceil((segundos * FPS_HABLAR) / 4) * 4 + 1;
}

/** Huella de lo que se oye en cada escena (si cambia, el presentador quedó viejo). */
export const huellaVoz = (escenas: EscenaEnLinea[]) =>
  sha256Texto(jsonEstable(escenas.map((e) => ({ id: e.escena.id, asset: e.voz.asset, tramos: e.tramos.map((t) => [Number(t.inicio.toFixed(3)), Number(t.fin.toFixed(3))]) })))).slice(0, 16);

/** El audio sin recortes de una escena (asset y rango): si cambia, el presentador en pantalla quedó viejo. */
export const huellaAudioEscena = (e: Pick<EscenaEnLinea, "voz">) => `${e.voz.asset}@${e.voz.rango.inicio.toFixed(3)}+${e.voz.rango.duracion.toFixed(3)}`;

/** Qué se va a generar, sin tocar nada (función pura). */
export function planearPresentador(p: Proyecto, op: OpcionesPresentador): PlanPresentador {
  const todas = escenasEnLinea(p);
  const notas: string[] = [];
  const avisos: string[] = [];
  const calidad = CALIDADES[op.calidad ?? "normal"];
  let tramos: TramoAudio[] = [];
  let elegidas: EscenaEnLinea[];
  let silencioInicial = 0;
  let segundos: number;
  if (op.modo === "pantalla") {
    const pedidas = op.escenas?.length ? new Set(op.escenas) : null;
    elegidas = todas.filter((e) => !pedidas || pedidas.has(e.escena.id));
    if (pedidas && elegidas.length !== pedidas.size) throw new Error("Alguna de las escenas elegidas ya no está en el proyecto");
    if (!elegidas.length) throw new Error("Elige al menos una escena para el presentador");
    // El audio empieza con la entrada en silencio: la primera escena la muestra sin saltos.
    silencioInicial = ENTRADA;
    let t = silencioInicial;
    tramos = elegidas.map((e) => {
      const x = { asset: e.voz.asset, inicio: e.voz.rango.inicio, duracion: e.voz.rango.duracion, escena: e.escena.id, offset: t };
      t += e.voz.rango.duracion;
      return x;
    });
    segundos = t;
    if (elegidas.some((e) => e.tramos.length > 1 || Math.abs(e.duracion - e.voz.rango.duracion) > 0.05)) {
      notas.push("Hay palabras recortadas: el avatar se genera con la frase completa y el recorte se aplica igual a la imagen y a la voz.");
    }
  } else {
    elegidas = todas;
    // La voz tal como queda en el video final: los tramos que suenan, uno detrás del otro, después de la entrada.
    let t = ENTRADA;
    for (const e of todas) {
      for (const tr of e.tramos) {
        tramos.push({ asset: e.voz.asset, inicio: tr.inicio, duracion: tr.fin - tr.inicio, offset: t });
        t += tr.fin - tr.inicio;
      }
    }
    silencioInicial = ENTRADA;
    segundos = t;
    notas.push("Si después cambias lo que se dice (recortar palabras, otra voz), vuelve a generar el presentador para que la boca siga a la voz.");
  }
  if (!tramos.length) throw new Error("El proyecto no tiene voz: el presentador necesita algo que decir");
  if (segundos > MAX_SEGUNDOS) {
    throw new Error(`Son ${Math.round(segundos)} s de voz y el presentador admite hasta ${MAX_SEGUNDOS} s por vez. Elige menos escenas (modo pantalla completa).`);
  }
  const marco = op.modo === "burbuja" ? Marco.parse(op.marco ?? {}) : null;
  if (op.modo === "pantalla" && p.formato === "16:9") notas.push("En 16:9 el avatar (vertical) se ve completo, con el fondo desenfocado a los costados.");
  if ((op.calidad ?? "normal") === "alta") avisos.push("La calidad alta tarda mucho más y usa más memoria de la tarjeta; pruébala primero con una escena corta.");
  return {
    modo: op.modo,
    escenas: elegidas.map((e) => ({ id: e.escena.id, numero: e.indice + 1 })),
    tramos,
    silencioInicial,
    segundos,
    cuadros: cuadrosHablar(segundos),
    // Recorte (streamer): figura vertical de medio cuerpo o cuerpo completo.
    resolucion: op.modo === "burbuja" ? (marco?.forma === "recorte" ? calidad.resoluciones["9:16"] : RESOLUCION_BURBUJA) : calidad.resoluciones[p.formato],
    marco,
    huella: huellaVoz(elegidas),
    prompt: op.prompt?.trim() ? `${op.prompt.trim()}. ${PROMPT_HABLAR}` : PROMPT_HABLAR,
    notas,
    avisos,
  };
}

/**
 * Video sobre fondo verde → WebM VP9 con transparencia (Hyperframes la conserva al componer). Quita el
 * verde y su reflejo en los bordes (despill). Función pura.
 */
export function argsRecorte(entrada: string, salida: string): string[] {
  return [
    "-v", "error", "-y", "-i", entrada, "-an",
    "-vf", "chromakey=0x00FF00:0.16:0.06,despill=type=green:mix=0.6:expand=0.1,format=yuva420p",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
    "-metadata:s:v:0", "alpha_mode=1", "-auto-alt-ref", "0", salida,
  ];
}

/**
 * Argumentos de ffmpeg para el audio que escucha InfiniteTalk: un silencio inicial y los tramos de voz uno
 * detrás del otro, en mono a 16 kHz (lo que usa su wav2vec2). Función pura.
 */
export function argsAudio(plan: Pick<PlanPresentador, "tramos" | "silencioInicial">, rutas: Record<string, string>, salida: string): string[] {
  const entradas: string[] = [];
  const indice = new Map<string, number>();
  for (const t of plan.tramos) {
    if (!indice.has(t.asset)) {
      const r = rutas[t.asset];
      if (!r) throw new Error(`Falta el audio ${t.asset}`);
      indice.set(t.asset, indice.size);
      entradas.push("-i", r);
    }
  }
  const partes: string[] = [];
  const etiquetas: string[] = [];
  plan.tramos.forEach((t, j) => {
    partes.push(`[${indice.get(t.asset)}:a]atrim=start=${t.inicio.toFixed(4)}:duration=${t.duracion.toFixed(4)},asetpts=PTS-STARTPTS,aresample=16000,aformat=channel_layouts=mono[t${j}]`);
    etiquetas.push(`[t${j}]`);
  });
  const retraso = Math.round(plan.silencioInicial * 1000);
  partes.push(`${etiquetas.join("")}concat=n=${etiquetas.length}:v=0:a=1${retraso ? `,adelay=delays=${retraso}:all=1` : ""}[a]`);
  return ["-hide_banner", "-nostdin", "-v", "error", "-y", ...entradas, "-filter_complex", partes.join(";"), "-map", "[a]", "-ac", "1", "-ar", "16000", salida];
}

export function ajustesHablar(plan: PlanPresentador, retrato: string, audio: string, calidad: Calidad = "normal", semilla?: number): AjustesWan2gp {
  return {
    model_type: MODELO_HABLAR,
    prompt: plan.prompt,
    resolution: plan.resolucion,
    image_prompt_type: "",
    image_refs: [retrato],
    video_prompt_type: "0KI",
    audio_guide: audio,
    audio_prompt_type: "A",
    video_length: plan.cuadros,
    sliding_window_size: 81,
    sliding_window_overlap: 9,
    flow_shift: CALIDADES[calidad].flowShift,
    activated_loras: [LORA_HABLAR],
    loras_multipliers: "1",
    num_inference_steps: 4,
    guidance_scale: 1,
    audio_guidance_scale: 1,
    seed: semilla !== undefined && semilla >= 0 ? Math.round(semilla) : Math.floor(Math.random() * 2147483647),
  };
}

/** Pantalla: la huella del audio de cada escena elegida, para saber después si quedó viejo. */
export function vocesDe(p: Proyecto, plan: Pick<PlanPresentador, "modo" | "tramos">): Record<string, string> | undefined {
  if (plan.modo !== "pantalla") return undefined;
  const porId = new Map(escenasEnLinea(p).map((e) => [e.escena.id, e]));
  return Object.fromEntries(plan.tramos.map((t) => [t.escena!, huellaAudioEscena(porId.get(t.escena!)!)]));
}

/** Pone el video del presentador en el proyecto (función pura salvo el asset ya descrito). */
export function aplicarPresentador(original: Proyecto, plan: PlanPresentador, asset: Proyecto["assets"][string]): Proyecto {
  let p = registrarAsset(original, asset);
  p = structuredClone(p);
  if (plan.modo === "pantalla") {
    const visual = pista(p, "visual");
    const porEscena = new Map(escenasEnLinea(p).map((e) => [e.escena.id, e.indice]));
    for (const t of plan.tramos) {
      const i = porEscena.get(t.escena!)!;
      const c = visual.clips[i]!;
      const nuevo: Clip = { id: c.id, asset: asset.id, escena: c.escena, rango: { inicio: t.offset, duracion: t.duracion }, sincro: "voz" };
      if (c.transicion) nuevo.transicion = c.transicion;
      if (p.formato === "16:9") nuevo.ajuste = "contener";
      visual.clips[i] = nuevo;
    }
  } else {
    const clip: Clip = { id: `presentador-${asset.id.slice(-8)}`, asset: asset.id, rango: { inicio: 0, duracion: plan.segundos }, inicio: 0, marco: plan.marco!, transicion: { tipo: "fundido", duracion: 0.4 } };
    const otra = p.pistas.find((x) => x.id === PISTA_PRESENTADOR);
    if (otra) otra.clips = [clip];
    else p.pistas.push({ id: PISTA_PRESENTADOR, tipo: "video", clips: [clip] });
  }
  // Los assets que ya no usa nadie (el presentador anterior) salen del índice.
  const usados = new Set(p.pistas.flatMap((x) => x.clips.map((c) => c.asset)));
  for (const id of Object.keys(p.assets)) if (!usados.has(id)) delete p.assets[id];
  return validarProyecto(p);
}

/** ¿Hay un presentador en el proyecto y sigue al día con la voz? (para el panel). */
export function estadoPresentador(p: Proyecto): { burbuja: boolean; escenas: string[]; viejo: boolean; avatar: string | null } {
  const todas = escenasEnLinea(p);
  const esPresentador = (id: string) => p.assets[id]?.regenerar.motor === MODELO_HABLAR;
  const enPantalla = todas.filter((e) => esPresentador(e.visual.asset));
  const burbuja = p.pistas.find((x) => x.id === PISTA_PRESENTADOR)?.clips.find((c) => esPresentador(c.asset));
  let viejo = false;
  if (burbuja) viejo = p.assets[burbuja.asset]!.regenerar.huella !== huellaVoz(todas);
  // Pantalla: la boca sigue al audio de cada escena tal como estaba al generarlo (otra voz la desfasa).
  for (const e of enPantalla) {
    const porEscena = p.assets[e.visual.asset]!.regenerar.voces as Record<string, unknown> | undefined;
    if (porEscena && porEscena[e.escena.id] !== huellaAudioEscena(e)) viejo = true;
  }
  const avatar = (burbuja ? p.assets[burbuja.asset] : enPantalla[0] ? p.assets[enPantalla[0].visual.asset] : null)?.regenerar.avatar;
  return { burbuja: !!burbuja, escenas: enPantalla.map((e) => e.escena.id), viejo, avatar: typeof avatar === "string" ? avatar : null };
}

export interface ContextoPresentador extends Contexto {
  signal?: AbortSignal;
  alAvanzar?: (a: Avance) => void;
}

const dirCorrida = (dir: string) => path.join(dir, "build", "presentador", new Date().toISOString().replace(/[:.]/g, "-"));

async function prepararAudio(dir: string, p: Proyecto, plan: PlanPresentador, corrida: string): Promise<string> {
  await fs.mkdir(corrida, { recursive: true });
  const audio = path.join(corrida, "voz-16k.wav");
  const rutas = Object.fromEntries(plan.tramos.map((t) => [t.asset, path.join(dir, p.assets[t.asset]!.ruta)]));
  await correr(FFMPEG, argsAudio(plan, rutas, audio));
  return audio;
}

/** Valida con `wgp.py --dry-run` (sin GPU). */
export async function probarPresentador(dir: string, p: Proyecto, op: OpcionesPresentador) {
  await leerAvatar(op.avatar);
  const plan = planearPresentador(p, op);
  const corrida = dirCorrida(dir);
  const audio = await prepararAudio(dir, p, plan, corrida);
  const ajustes = ajustesHablar(plan, rutaRetrato(op.avatar), audio, op.calidad, op.semilla);
  return { plan, ajustes, ...(await probarWan2gp(instalacionWan2gp(), ajustes, corrida)) };
}

/** Genera el presentador (usa toda la GPU) y lo guarda en una versión nueva del proyecto. */
export async function generarPresentador(ctx: ContextoPresentador, proyectoId: string, p: Proyecto, op: OpcionesPresentador) {
  const avatar: Avatar = await leerAvatar(op.avatar);
  const plan = planearPresentador(p, op);
  const corrida = dirCorrida(ctx.dir);
  const audio = await prepararAudio(ctx.dir, p, plan, corrida);
  // Copia del retrato dentro del proyecto: el video no depende de que el avatar siga en la biblioteca.
  const retrato = path.join(corrida, "retrato.png");
  await fs.copyFile(op.imagen ?? rutaRetrato(avatar.id), retrato);
  const ajustes = ajustesHablar(plan, retrato, audio, op.calidad, op.semilla);
  ctx.log(`Presentador «${avatar.nombre}» (${plan.modo}): ${plan.segundos.toFixed(1)} s, ${plan.cuadros} cuadros a ${plan.resolucion}`);
  const t0 = Date.now();
  let video = await generarPlano({ instalacion: instalacionWan2gp(), ajustes, dirCorrida: corrida, signal: ctx.signal, log: ctx.log, alAvanzar: ctx.alAvanzar });
  // Streamer: el avatar se generó sobre verde; se quita el verde y queda un video con transparencia.
  if (plan.marco?.forma === "recorte") {
    const recortado = path.join(corrida, "recorte.webm");
    await correr(FFMPEG, argsRecorte(video, recortado), { log: ctx.log, signal: ctx.signal, timeout: 30 * 60_000 });
    video = recortado;
  }
  const hash = await sha256Archivo(video);
  const id = `avatar-${hash.slice(0, 12)}`;
  const ruta = `assets/${id}${path.extname(video).toLowerCase() || ".mp4"}`;
  await fs.copyFile(video, path.join(ctx.dir, ruta));
  const segundos = Math.round((Date.now() - t0) / 1000);
  const asset = await describirAsset(ctx.dir, ruta, {
    id,
    tipo: "video",
    source: "wan",
    licencia: `${LICENCIA_HABLAR}; avatar: ${avatar.licencia}; generado con WanGP (citar a WanGP si se vende el video)`,
    regenerar: { motor: MODELO_HABLAR, avatar: avatar.id, modo: plan.modo, huella: plan.huella, voces: vocesDe(p, plan), ajustes: { ...ajustes, image_refs: ["retrato.png"], audio_guide: "voz-16k.wav" }, segundos },
  });
  // Video más corto que la voz (InfiniteTalk corta en el último cuadro entero): no debería pasar, pero se avisa.
  if (asset.duracion !== undefined && asset.duracion + 0.2 < plan.segundos) ctx.log(`Aviso: el video dura ${asset.duracion.toFixed(2)} s y la voz ${plan.segundos.toFixed(2)} s`);
  let nuevo = aplicarPresentador(p, plan, asset);
  // La cara del avatar, para encuadrar (la burbuja y el 9:16) sobre ella.
  nuevo = (await conFocos(ctx, nuevo, { ids: [id], signal: ctx.signal })).p;
  const nota = plan.modo === "burbuja" ? `Presentador «${avatar.nombre}» en burbuja` : `Presentador «${avatar.nombre}» en ${plan.escenas.length === 1 ? `la escena ${plan.escenas[0]!.numero}` : `${plan.escenas.length} escenas`}`;
  const version = await guardarProyecto(proyectoId, nuevo, nota);
  await registrarAssetsEnDb(proyectoId, nuevo);
  return { version, asset: id, ruta, segundos, modo: plan.modo };
}
