/**
 * Partes puras de Workflows que usan tanto la página como el servidor (sin `node:`): qué entradas se
 * quedan sin archivo y cómo decirlo en palabras simples (UX-04).
 */

/** Lo que pide cada tipo de entrada, en palabras simples. */
const TU_ARCHIVO: Record<string, string> = { image: "tu imagen", video: "tu video", audio: "tu audio" };
export const tuArchivo = (medio: string) => TU_ARCHIVO[medio] ?? "tu archivo";

/**
 * Si la receta trae de verdad el archivo de ejemplo de una entrada: está en su catálogo o ya en
 * `ComfyUI/input/` (función pura). Muchas recetas nombran un ejemplo que no viene con ComfyUI (UX-04).
 */
export function hayEjemplo(archivo: string | null, catalogo: Record<string, string>, enInput: (nombre: string) => boolean): boolean {
  return !!archivo && (Object.hasOwn(catalogo, archivo) || enInput(archivo));
}

/** Las entradas que se quedan sin nada: ni las subió la persona ni la receta trae ejemplo (función pura). */
export function entradasSinArchivo<E extends { nodo: number | string; archivo: string | null; medio: string }>(entradas: E[], subidos: (number | string)[], ejemplo: (e: E) => boolean): E[] {
  return entradas.filter((e) => !subidos.some((s) => String(s) === String(e.nodo)) && !ejemplo(e));
}

/** «Falta subir tu imagen.» (o «tu imagen y tu video»). */
export function textoFaltaArchivo(medios: string[]): string {
  const nombres = [...new Set(medios.map(tuArchivo))];
  return `Falta subir ${nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : nombres[0]}.`;
}

/** Los estados de un trabajo que se pueden volver a intentar (los que acepta `relanzar` de cola.ts). */
export const REINTENTABLES = ["fallido", "interrumpido", "cancelado"] as const;

/**
 * Corrida → el trabajo más nuevo que la corrió, para «Volver a intentar» (UX-30; función pura). Los
 * trabajos vienen del más nuevo al más viejo; una corrida relanzada conserva su id y sus archivos.
 */
export function trabajoPorCorrida(trabajos: { id: string; payload: unknown }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of trabajos) {
    const corrida = (t.payload as { corrida?: unknown } | null)?.corrida;
    if (typeof corrida === "string" && !(corrida in out)) out[corrida] = t.id;
  }
  return out;
}

/** Qué es una miniatura por su extensión: se muestra como imagen, video o reproductor de audio (UX-25). */
export function tipoMiniatura(nombre: string): "imagen" | "video" | "audio" | null {
  if (/\.(webp|png|jpe?g|gif)$/i.test(nombre)) return "imagen";
  if (/\.(mp4|webm)$/i.test(nombre)) return "video";
  if (/\.(mp3|wav|flac|ogg)$/i.test(nombre)) return "audio";
  return null;
}

/** El dibujo de una receta sin miniatura, por su tipo (UX-25). */
export function iconoDeTipo(tipo: string): string {
  return ({ image: "🖼️", video: "🎬", audio: "🎵", "3d": "🧊" } as Record<string, string>)[tipo.toLowerCase()] ?? "✨";
}

const sinTildes = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * Palabras en español → cómo las dicen las recetas, que vienen en inglés (UX-25). Sin tildes y en
 * minúsculas; las frases van antes que sus palabras sueltas.
 */
const EQUIVALENCIAS: [string, string[]][] = [
  ["quitar fondo", ["remove background", "background removal", "rmbg", "matting", "background"]],
  ["sin fondo", ["remove background", "background removal", "rmbg", "matting", "background"]],
  ["texto a imagen", ["text to image", "t2i"]],
  ["texto a video", ["text to video", "t2v"]],
  ["imagen a video", ["image to video", "i2v"]],
  ["foto a video", ["image to video", "i2v"]],
  ["texto a voz", ["text to speech", "tts"]],
  ["retrato", ["portrait", "headshot", "face"]],
  ["cara", ["face", "portrait"]],
  ["musica", ["music", "song", "audio"]],
  ["cancion", ["song", "music"]],
  ["letra", ["lyrics"]],
  ["voz", ["voice", "speech", "tts"]],
  ["voces", ["voice", "speech", "tts"]],
  ["sonido", ["sound", "audio"]],
  ["foto", ["image", "photo"]],
  ["fotos", ["image", "photo"]],
  ["imagen", ["image"]],
  ["imagenes", ["image"]],
  ["animar", ["animate", "animation"]],
  ["animacion", ["animate", "animation"]],
  ["mejorar", ["upscale", "enhance", "restore"]],
  ["ampliar", ["upscale"]],
  ["editar", ["edit"]],
  ["personaje", ["character"]],
  ["producto", ["product"]],
  ["ropa", ["fashion", "clothing", "outfit", "try-on"]],
  ["paisaje", ["landscape"]],
  ["dibujo", ["drawing", "sketch", "illustration"]],
  ["boceto", ["sketch"]],
  ["logotipo", ["logo"]],
  ["estilo", ["style"]],
  ["color", ["color", "colorize"]],
  ["colorear", ["colorize"]],
];

/**
 * Si una receta coincide con lo que se busca (función pura): cada palabra (o frase de la tabla) tiene que
 * estar en el título, la descripción, las etiquetas, los modelos o la categoría, en español o en inglés.
 */
export function coincideBusqueda(w: { titulo: string; descripcion: string; etiquetas: string[]; modelos: string[]; categoria: string; tipo: string }, busqueda: string): boolean {
  let q = ` ${sinTildes(busqueda).replace(/\s+/g, " ").trim()} `;
  if (!q.trim()) return true;
  const grupos: string[][] = [];
  for (const [frase, otras] of EQUIVALENCIAS) {
    if (!q.includes(` ${frase} `)) continue;
    grupos.push([frase, ...otras]);
    q = q.replace(` ${frase} `, " ");
  }
  for (const p of q.trim().split(" ")) if (p) grupos.push([p]);
  const texto = sinTildes(`${w.titulo} ${w.descripcion} ${w.etiquetas.join(" ")} ${w.modelos.join(" ")} ${w.categoria} ${w.tipo}`).replace(/[-_]/g, " ");
  return grupos.every((g) => g.some((x) => texto.includes(x.replace(/-/g, " "))));
}
