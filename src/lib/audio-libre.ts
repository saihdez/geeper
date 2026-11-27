/**
 * Música y efectos de sonido libres que vienen con Geeper (`audio-libre/`): 24 pistas en bucle y 88
 * efectos, CC0-1.0, sintetizados por código (sin muestras ni grabaciones de terceros). Salen de la
 * biblioteca de audio de Doory (shaongitbd/doory, `backend/data/audio/`), ver audio-libre/LEEME.md.
 * Sólo se copiaron los archivos de audio y sus datos (CC0); ningún código de Doory, que tiene otra licencia.
 *
 * Sirven para lo que antes pedía la tarjeta de video (whoosh, golpe, pop) o una carpeta de música sin
 * licencia clara: con ellos el QC comercial no bloquea por licencia.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describirAsset } from "./almacen";
import { aplicarEdicion, registrarAsset } from "./ediciones";
import { ANIMO_ES, ANIMOS, LICENCIA_LIBRE, PREFIJO_LIBRE } from "./animos-musica";
import type { Proyecto } from "./esquema";
import { RAIZ_REPO } from "./rutas";

/**
 * Los mismos de efectos-sonido.ts (una prueba lo revisa). No se importan de ahí porque ese módulo trae
 * la GPU y el LLM, y el importador usa éste.
 */
export const PISTA_EFECTOS = "efectos";
export const VOLUMEN_EFECTO = 0.6;

export { ANIMOS, LICENCIA_LIBRE, PREFIJO_LIBRE };
export const DIR_AUDIO_LIBRE = process.env.GEEPER_AUDIO_LIBRE ?? path.join(RAIZ_REPO, "audio-libre");

const Pista = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["music", "sfx"]),
  title: z.string(),
  tags: z.array(z.string()).default([]),
  durationMs: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mood: z.string().optional(),
  bpm: z.number().optional(),
  archivo: z.string().regex(/^(musica|efectos)\/[a-z0-9-]+\.ogg$/),
});
const Biblioteca = z.object({ pistas: z.array(Pista) });

export const GRUPOS_EFECTO = {
  transicion: "Para pasar de escena",
  golpe: "Golpes (para un título)",
  aparecer: "Para un texto que aparece",
  logro: "Logros y brillos",
  aviso: "Avisos y tecnología",
  comico: "Cómicos",
  ambiente: "Naturaleza y ambiente",
} as const;
export type GrupoEfecto = keyof typeof GRUPOS_EFECTO;

/** Nombre en español y grupo de cada efecto (una prueba revisa que no falte ninguno). */
export const NOMBRES_EFECTO: Record<string, [string, GrupoEfecto]> = {
  "air-burst": ["Soplo de aire", "transicion"],
  "harp-gliss": ["Arpa mágica", "transicion"],
  "message-sent": ["Mensaje enviado (whoosh corto)", "transicion"],
  "reverse-swell": ["Crecida al revés", "transicion"],
  "riser-long": ["Subida larga (tensión)", "transicion"],
  "riser-short": ["Subida corta", "transicion"],
  "riser-tension": ["Subida de suspenso", "transicion"],
  "swipe-left": ["Deslizar a la izquierda", "transicion"],
  "swipe-quick": ["Deslizar rápido", "transicion"],
  "swipe-right": ["Deslizar a la derecha", "transicion"],
  "swoosh-down": ["Swoosh hacia abajo", "transicion"],
  "swoosh-up": ["Swoosh hacia arriba", "transicion"],
  "transition-sweep": ["Barrido de transición", "transicion"],
  "whoosh-airy": ["Whoosh suave y aireado", "transicion"],
  "whoosh-deep": ["Whoosh grave", "transicion"],
  "whoosh-fast": ["Whoosh rápido", "transicion"],
  "whoosh-soft": ["Whoosh suave", "transicion"],
  boom: ["Explosión grave", "golpe"],
  "cymbal-crash": ["Platillo", "golpe"],
  "drum-roll": ["Redoble de tambor", "golpe"],
  "hit-cinematic": ["Golpe de cine", "golpe"],
  "hit-heavy": ["Golpe fuerte", "golpe"],
  "hit-medium": ["Golpe medio", "golpe"],
  "hit-soft": ["Golpe suave", "golpe"],
  slam: ["Portazo", "golpe"],
  stomp: ["Pisotón", "golpe"],
  "stinger-brass": ["Metales dramáticos", "golpe"],
  thud: ["Golpe sordo", "golpe"],
  "balloon-pop": ["Globo que revienta", "aparecer"],
  bloop: ["Bloop", "aparecer"],
  "bubble-pop": ["Burbuja", "aparecer"],
  "camera-shutter": ["Foto (obturador)", "aparecer"],
  "click-sharp": ["Clic seco", "aparecer"],
  "click-soft": ["Clic suave", "aparecer"],
  deselect: ["Soltar", "aparecer"],
  "drop-in": ["Caer en su lugar", "aparecer"],
  "finger-snap": ["Chasquido de dedos", "aparecer"],
  "key-press": ["Tecla", "aparecer"],
  "pop-bright": ["Pop brillante", "aparecer"],
  "pop-small": ["Pop pequeño", "aparecer"],
  select: ["Elegir", "aparecer"],
  tap: ["Toque", "aparecer"],
  "toggle-off": ["Apagar interruptor", "aparecer"],
  "toggle-on": ["Encender interruptor", "aparecer"],
  typing: ["Escribir en el teclado", "aparecer"],
  "applause-clap": ["Aplauso", "logro"],
  "chime-high": ["Campanita aguda", "logro"],
  coin: ["Moneda", "logro"],
  ding: ["Ding", "logro"],
  glitter: ["Brillitos", "logro"],
  "level-up": ["Subir de nivel", "logro"],
  "magic-wand": ["Varita mágica", "logro"],
  "party-horn": ["Corneta de fiesta", "logro"],
  "power-up": ["Potenciador", "logro"],
  shimmer: ["Destello", "logro"],
  sparkle: ["Chispa", "logro"],
  success: ["Éxito", "logro"],
  twinkle: ["Estrellita", "logro"],
  beep: ["Pitido", "aviso"],
  boot: ["Encendido de computadora", "aviso"],
  "data-burst": ["Ráfaga de datos", "aviso"],
  "ding-dong": ["Timbre", "aviso"],
  "double-beep": ["Doble pitido", "aviso"],
  error: ["Error", "aviso"],
  glitch: ["Falla digital (glitch)", "aviso"],
  heartbeat: ["Latido", "aviso"],
  laser: ["Láser", "aviso"],
  "message-received": ["Mensaje recibido", "aviso"],
  "notification-bright": ["Notificación", "aviso"],
  "notification-soft": ["Notificación suave", "aviso"],
  "power-down": ["Apagado", "aviso"],
  "radar-ping": ["Radar", "aviso"],
  scan: ["Escaneo", "aviso"],
  tick: ["Tic", "aviso"],
  tock: ["Tac", "aviso"],
  warning: ["Alerta", "aviso"],
  zap: ["Chispazo eléctrico", "aviso"],
  boing: ["Boing (resorte)", "comico"],
  crumple: ["Papel arrugado", "comico"],
  downer: ["Bajón", "comico"],
  "slide-whistle-down": ["Silbato que baja", "comico"],
  "slide-whistle-up": ["Silbato que sube", "comico"],
  squeak: ["Juguete que chilla", "comico"],
  "bird-chirp": ["Pájaro", "ambiente"],
  "chime-low": ["Gong suave", "ambiente"],
  "water-drop": ["Gota de agua", "ambiente"],
  "wind-chimes": ["Campanas de viento", "ambiente"],
  "wind-gust": ["Ráfaga de viento", "ambiente"],
};

export interface SonidoLibre {
  id: string;
  tipo: "musica" | "efecto";
  nombre: string;
  /** Efectos: su grupo; música: su ánimo (clave de ANIMOS). */
  grupo: string;
  segundos: number;
  bpm?: number;
  sha256: string;
  /** Relativa a DIR_AUDIO_LIBRE. */
  archivo: string;
}

let cache: { dir: string; sonidos: SonidoLibre[] } | null = null;

/** Lo que trae `audio-libre/biblioteca.json`. Si falta la carpeta (instalación vieja), lista vacía. */
export function sonidosLibres(): SonidoLibre[] {
  if (cache?.dir === DIR_AUDIO_LIBRE) return cache.sonidos;
  let crudo: unknown;
  try {
    crudo = JSON.parse(readFileSync(path.join(DIR_AUDIO_LIBRE, "biblioteca.json"), "utf8"));
  } catch {
    return [];
  }
  const sonidos = Biblioteca.parse(crudo).pistas.map((p): SonidoLibre => {
    const musica = p.kind === "music";
    const [nombre, grupo] = musica ? [p.title, p.mood ?? "upbeat"] : (NOMBRES_EFECTO[p.id] ?? [p.title, "aviso"]);
    return { id: p.id, tipo: musica ? "musica" : "efecto", nombre, grupo, segundos: Math.round(p.durationMs / 100) / 10, bpm: p.bpm, sha256: p.sha256, archivo: p.archivo };
  });
  cache = { dir: DIR_AUDIO_LIBRE, sonidos };
  return sonidos;
}

export const efectosLibres = () => sonidosLibres().filter((s) => s.tipo === "efecto");
export const sonidoLibre = (id: string) => sonidosLibres().find((s) => s.id === id);
export const rutaSonidoLibre = (s: SonidoLibre) => path.join(DIR_AUDIO_LIBRE, s.archivo);

/** ¿`carpeta` pide la música libre? Devuelve el ánimo (null = cualquiera) o undefined si es una carpeta normal. */
export function animoDeCarpeta(carpeta: string | null): string | null | undefined {
  if (!carpeta?.startsWith(PREFIJO_LIBRE)) return undefined;
  const pedido = carpeta.slice(PREFIJO_LIBRE.length).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!pedido) return null;
  if (ANIMOS[pedido]) return pedido;
  const clave = ANIMO_ES[pedido];
  if (!clave) throw new Error(`No hay música libre «${pedido}». Ánimos: ${Object.values(ANIMOS).join(", ")}.`);
  return clave;
}

/** Pistas de música libre de un ánimo (null = todas), en orden estable. */
export function musicaLibre(animo: string | null): SonidoLibre[] {
  return sonidosLibres()
    .filter((s) => s.tipo === "musica" && (animo === null || s.grupo === animo))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Copia un efecto libre al proyecto y lo pone en la pista «efectos» en `inicio` (no guarda). */
export async function agregarEfectoLibre(dir: string, p: Proyecto, s: SonidoLibre, inicio: number): Promise<Proyecto> {
  const id = `libre-${s.id}`;
  const ruta = `assets/${id}.ogg`;
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.copyFile(rutaSonidoLibre(s), path.join(dir, ruta));
  const asset = await describirAsset(dir, ruta, {
    id,
    tipo: "audio",
    source: "archivo",
    licencia: LICENCIA_LIBRE,
    regenerar: { efecto: s.nombre, bibliotecaLibre: s.archivo, sha256: s.sha256 },
  });
  return aplicarEdicion(registrarAsset(p, asset), { tipo: "agregarClipLibre", pista: PISTA_EFECTOS, asset: id, inicio: Math.max(0, inicio), desde: 0, volumen: VOLUMEN_EFECTO });
}
