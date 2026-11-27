/**
 * REN-09: el fondo borroso de los clips «contenidos» (un video horizontal en un formato vertical, o al
 * revés) se hornea con ffmpeg antes de componer, en vez de pedirle a Chrome `filter: blur(40px)` en
 * cada cuadro. Los renders con ese fondo capturaban a la mitad de velocidad (33–36 fps contra 55–63).
 *
 * El fondo sale a un cuarto del tamaño del video (se ve borroso igual y pesa mucho menos al decodificar
 * la segunda capa), ya desenfocado y oscurecido; Chrome sólo lo agranda. Caché por hash en
 * `assets/fondo/`, como los clips con color (looks.ts): sólo cuesta la primera vez.
 *
 * Sólo se hornea hasta donde el video usa el clip (más 1 s): de un clip largo del que se usan unos
 * segundos no se procesa el resto. El comienzo no se corta: el fondo tiene que seguir en el mismo tiempo
 * que el clip nítido de adelante (las dos piezas usan el mismo `desde`).
 *
 * `GEEPER_FONDO_HORNEADO=0` vuelve al desenfoque de CSS, para comparar tiempos o si el fondo se ve raro.
 * Si ffmpeg falla con un clip, ese clip sigue con el desenfoque de CSS (se avisa en el registro). Cancelar
 * el trabajo corta ffmpeg y cancela el render (no sigue con el desenfoque de CSS).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { existe, sha256Texto } from "./archivos";
import { ajusteDe } from "./caras";
import { assetsConFondo, segmentosVisuales } from "./compilador";
import { aplicarEstilo, type Proyecto } from "./esquema";
import { escenasEnLinea } from "./linea";
import { huellaFfmpeg } from "./media";
import { correr, senalDelTrabajo, type Registro } from "./proceso";
import { FFMPEG } from "./rutas";

type Entorno = Record<string, string | undefined>;

/** Sube si cambia el filtro: invalida la caché. */
export const VERSION_FONDO = "fondo-v1";
/** El mismo desenfoque y brillo que pedía el CSS (`.fondo.desenfoque`). */
export const BLUR_CSS = 40;
export const BRILLO = 0.55;
/** Tamaño del fondo respecto del video. */
export const ESCALA_FONDO = 4;

export const fondoHorneado = (env: Entorno = process.env) => env.GEEPER_FONDO_HORNEADO !== "0";

const par = (x: number) => Math.max(2, Math.round(x / 2) * 2);

/**
 * Filtro de ffmpeg equivalente a `object-fit: cover` + `filter: blur(40px) brightness(0.55)` sobre
 * W×H, pero a 1/ESCALA_FONDO del tamaño (el desenfoque se escala igual: sigma 40 → 10).
 */
export function filtroFondo(W: number, H: number): string {
  const w = par(W / ESCALA_FONDO);
  const h = par(H / ESCALA_FONDO);
  const sigma = BLUR_CSS / ESCALA_FONDO;
  const k = BRILLO;
  return [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `gblur=sigma=${sigma}`,
    `colorchannelmixer=rr=${k}:gg=${k}:bb=${k}`,
    "format=yuv420p",
  ].join(",");
}

/**
 * Hasta qué segundo del archivo usa el video cada clip contenido (el mismo cálculo de tramos que
 * `compilar`). Con el fondo cortado ahí, no se hornea la parte del clip que no se ve.
 */
export function finUsado(original: Proyecto, W: number, H: number): Record<string, number> {
  const p = aplicarEstilo(original);
  const fin: Record<string, number> = {};
  for (const es of escenasEnLinea(p)) {
    const a = p.assets[es.visual.asset];
    if (!a || a.tipo !== "video" || ajusteDe(es.visual, a, W, H) !== "contener") continue;
    const velocidad = es.visual.sincro === "voz" ? 1 : (es.visual.velocidad ?? 1);
    const entrada = es.indice === 0 ? es.inicio : 0;
    for (const s of segmentosVisuales(es, a, velocidad, entrada)) fin[a.id] = Math.max(fin[a.id] ?? 0, s.desde + s.dur * velocidad);
  }
  return fin;
}

/** Segundo donde cortar el fondo (con 1 s de margen), o null si conviene hornear el clip entero. */
export function corteFondo(fin: number | undefined, duracion: number | undefined): number | null {
  if (fin === undefined || !duracion) return null;
  const corte = Math.ceil(fin) + 1;
  return corte < duracion ? corte : null;
}

/**
 * Hornea los fondos que hacen falta y devuelve id de asset → ruta absoluta (para `compilar`).
 * `sustitutos` son los clips con color (prepararColor): el fondo sale de ellos para que combine.
 */
export async function prepararFondos(
  p: Proyecto,
  dirProyecto: string,
  sustitutos: Record<string, string>,
  W: number,
  H: number,
  log?: Registro,
  env: Entorno = process.env,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (!fondoHorneado(env)) return {};
  const candidatos = assetsConFondo(p, W, H).filter((a) => a.tipo === "video" || (a.tipo === "imagen" && !/\.svg$/i.test(a.ruta)));
  if (!candidatos.length) return {};
  const huella = await huellaFfmpeg();
  const filtro = filtroFondo(W, H);
  const fines = finUsado(p, W, H);
  const fondos: Record<string, string> = {};
  for (const a of candidatos) {
    const origen = sustitutos[a.id] ?? path.join(dirProyecto, a.ruta);
    const ext = a.tipo === "video" ? ".mp4" : ".jpg";
    const corte = a.tipo === "video" ? corteFondo(fines[a.id], a.duracion) : null;
    const clave = sha256Texto(JSON.stringify({ a: a.hash, o: path.basename(origen), filtro, huella, v: VERSION_FONDO, ...(corte ? { t: corte } : {}) })).slice(0, 12);
    const destino = path.join(dirProyecto, "assets", "fondo", `${a.id}-${clave}${ext}`);
    if (!(await existe(destino))) {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      // Temporal único: dos renders del mismo proyecto (otro formato, otro intento) pueden preparar el mismo
      // clip a la vez. La vista previa no hornea fondos: usa el desenfoque de CSS.
      const tmp = `${destino}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const comunes = ["-hide_banner", "-nostdin", "-y", "-v", "error", "-i", path.resolve(origen), "-map", "0:v:0", "-vf", filtro];
      try {
        if (a.tipo === "video") {
          // CPU (libx264): la GPU es de un trabajo a la vez. Sin sonido (el video va mudo) y un keyframe por segundo.
          const hasta = corte ? ["-t", String(corte)] : [];
          await correr(FFMPEG, [...comunes, ...hasta, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "30", "-movflags", "+faststart", path.resolve(tmp)], { log, signal });
        } else {
          await correr(FFMPEG, [...comunes, "-frames:v", "1", "-q:v", "3", path.resolve(tmp)], { log, signal });
        }
        await fs.rename(tmp, destino);
      } catch (e) {
        // Cancelado: no se sigue con el desenfoque de CSS, se corta el render.
        if (signal?.aborted || senalDelTrabajo()?.aborted) throw e;
        log?.(`Aviso: no se pudo preparar el fondo borroso de ${a.id}; queda el de CSS (${String(e).slice(0, 200)})`);
        continue;
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    fondos[a.id] = destino;
  }
  return fondos;
}
