/**
 * Paquete para terminar un proyecto en otro editor (FilmCraft o DaVinci Resolve): un .zip con la línea de
 * tiempo (.otio), los subtítulos (.srt) y una guía en lenguaje simple. Lo usa el botón «Terminar en otro
 * editor» de la página del proyecto (`GET /api/proyectos/<id>/editor`).
 */
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { Proyecto } from "./esquema";
import { aSrt, duracionEscenas, todosLosGrupos } from "./linea";
import { aOtio, rutasParaWindows } from "./otio";
import { QUE_NO_LLEGA } from "./que-no-llega";

/** Carpeta del proyecto vista desde Windows (`\\wsl.localhost\<distro>\...`), o la de Linux fuera de WSL. */
export function carpetaVisible(dirProyecto: string, distro: string | undefined): string {
  return distro ? `\\\\wsl.localhost\\${distro}${dirProyecto.replaceAll("/", "\\")}` : dirProyecto;
}

function guia(p: Proyecto, slug: string, carpeta: string, windows: boolean): string {
  const l = [
    `CÓMO TERMINAR «${p.nombre}» EN OTRO EDITOR DE VIDEO`,
    "",
    "Este paquete trae:",
    `  - ${slug}.otio  La línea de tiempo: escenas, voz y música en su lugar.`,
    `  - ${slug}.srt   Los subtítulos.`,
    "  - LEEME.txt    Esta guía.",
    "",
    "PASO 1. Antes de abrir el editor",
    "  Los videos y audios NO van dentro del paquete: el editor los toma de la carpeta del proyecto en Geeper.",
    `  ${carpeta}`,
    "  No muevas ni borres esa carpeta mientras trabajas.",
    "  Abre el paquete en esta misma computadora: en otra, el editor no encuentra los videos ni los audios.",
    "  Deja Geeper abierto mientras editas.",
    ...(windows ? ["  Así Ubuntu (WSL), donde están los archivos, sigue encendido."] : []),
    "",
    "PASO 2. Abrir la línea de tiempo",
    `  FilmCraft:        Archivo ▸ Importar… y elige ${slug}.otio`,
    "                    (para verlo en español: Edición ▸ Idioma ▸ Español)",
    `  DaVinci Resolve:  File ▸ Import ▸ Timeline… y elige ${slug}.otio`,
    "  Premiere Pro no abre archivos .otio.",
    "",
    "PASO 3. Agregar los subtítulos (opcional)",
    `  FilmCraft:        Archivo ▸ Importar… y elige ${slug}.srt (entra solo en una pista de subtítulos).`,
    `  DaVinci Resolve:  File ▸ Import ▸ Subtitle… y elige ${slug}.srt`,
    "",
    "LO QUE NO LLEGA AL EDITOR (si lo quieres, hay que volver a hacerlo allí)",
    ...QUE_NO_LLEGA.map((x) => `  - ${x}`),
    "",
    "SI EL EDITOR DICE QUE FALTAN ARCHIVOS",
    "  Revisa el paso 1: que la carpeta exista y que Ubuntu esté encendido. Después usa la opción de",
    "  volver a vincular archivos del editor y apunta a esa carpeta.",
    "",
    "Lo que cambies en el otro editor no vuelve a Geeper. Para seguir editando en Geeper, hazlo antes de exportar.",
  ];
  // Fin de línea de Windows: el Bloc de notas viejo no corta las líneas con \n solo.
  return l.join("\r\n") + "\r\n";
}

/**
 * Arma el .zip. `distro` es la distribución de WSL (`WSL_DISTRO_NAME`): con ella, las rutas del .otio son
 * las de Windows; sin ella (fuera de WSL) quedan las de Linux.
 */
export function paqueteEditor(p: Proyecto, slug: string, dirProyecto: string, distro = process.env.WSL_DISTRO_NAME, sustitutos: Record<string, string> = {}): Uint8Array {
  const base = aOtio(p, path.resolve(dirProyecto), sustitutos);
  const otio = distro ? rutasParaWindows(base, distro) : base;
  return zipSync({
    [`${slug}.otio`]: strToU8(JSON.stringify(otio, null, 2)),
    [`${slug}.srt`]: strToU8(aSrt(todosLosGrupos(p), duracionEscenas(p))),
    "LEEME.txt": strToU8(guia(p, slug, carpetaVisible(path.resolve(dirProyecto), distro), Boolean(distro))),
  });
}
