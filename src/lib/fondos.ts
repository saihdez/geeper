/**
 * REN-09: el fondo borroso de los clips «contenidos» (un video horizontal en un formato vertical, o al
 * revés) se hornea con ffmpeg antes de componer, en vez de pedirle a Chrome `filter: blur(40px)` en
 * cada cuadro. Los renders con ese fondo capturaban a la mitad de velocidad (33–36 fps contra 55–63).
 *
 * El fondo sale a un cuarto del tamaño del video (se ve borroso igual y pesa mucho menos al decodificar
 * la segunda capa), ya desenfocado y oscurecido; Chrome sólo lo agranda. Caché por hash en
 * `assets/fondo/`, como los clips con color (looks.ts): sólo cuesta la primera vez.
 *
 * `GEEPER_FONDO_HORNEADO=0` vuelve al desenfoque de CSS, para comparar tiempos o si el fondo se ve raro.
 * Si ffmpeg falla con un clip, ese clip sigue con el desenfoque de CSS (se avisa en el registro).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { existe, sha256Texto } from "./archivos";
import { assetsConFondo } from "./compilador";
import type { Proyecto } from "./esquema";
import { huellaFfmpeg } from "./media";
import { correr, type Registro } from "./proceso";
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
): Promise<Record<string, string>> {
  if (!fondoHorneado(env)) return {};
  const candidatos = assetsConFondo(p, W, H).filter((a) => a.tipo === "video" || (a.tipo === "imagen" && !/\.svg$/i.test(a.ruta)));
  if (!candidatos.length) return {};
  const huella = await huellaFfmpeg();
  const filtro = filtroFondo(W, H);
  const fondos: Record<string, string> = {};
  for (const a of candidatos) {
    const origen = sustitutos[a.id] ?? path.join(dirProyecto, a.ruta);
    const ext = a.tipo === "video" ? ".mp4" : ".jpg";
    const clave = sha256Texto(JSON.stringify({ a: a.hash, o: path.basename(origen), filtro, huella, v: VERSION_FONDO })).slice(0, 12);
    const destino = path.join(dirProyecto, "assets", "fondo", `${a.id}-${clave}${ext}`);
    if (!(await existe(destino))) {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      // Temporal único: el render y la vista previa pueden preparar el mismo clip a la vez.
      const tmp = `${destino}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const comunes = ["-hide_banner", "-nostdin", "-y", "-v", "error", "-i", path.resolve(origen), "-map", "0:v:0", "-vf", filtro];
      try {
        if (a.tipo === "video") {
          // CPU (libx264): la GPU es de un trabajo a la vez. Sin sonido (el video va mudo) y un keyframe por segundo.
          await correr(FFMPEG, [...comunes, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "30", "-movflags", "+faststart", path.resolve(tmp)], { log });
        } else {
          await correr(FFMPEG, [...comunes, "-frames:v", "1", "-q:v", "3", path.resolve(tmp)], { log });
        }
        await fs.rename(tmp, destino);
      } catch (e) {
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
