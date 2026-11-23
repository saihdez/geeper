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
 * estar en el título (el traducido o el original en inglés), la descripción, las etiquetas, los modelos o la
 * categoría, en español o en inglés.
 */
export function coincideBusqueda(w: { titulo: string; descripcion: string; etiquetas: string[]; modelos: string[]; categoria: string; tipo: string; original?: string | null }, busqueda: string): boolean {
  let q = ` ${sinTildes(busqueda).replace(/\s+/g, " ").trim()} `;
  if (!q.trim()) return true;
  const grupos: string[][] = [];
  for (const [frase, otras] of EQUIVALENCIAS) {
    if (!q.includes(` ${frase} `)) continue;
    grupos.push([frase, ...otras]);
    q = q.replace(` ${frase} `, " ");
  }
  for (const p of q.trim().split(" ")) if (p) grupos.push([p]);
  const texto = sinTildes(`${w.titulo} ${w.original ?? ""} ${w.descripcion} ${w.etiquetas.join(" ")} ${w.modelos.join(" ")} ${w.categoria} ${w.tipo}`).replace(/[-_]/g, " ");
  return grupos.every((g) => g.some((x) => texto.includes(x.replace(/-/g, " "))));
}

/** «32 GB» / «850 MB». */
export const textoGb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

/** Hasta cuánto pesa una receta «ligera»: arriba de esto se pregunta antes de bajar (UX-36). */
export const LIGERA = 10e9;
/** Lo que se deja libre en el disco además de los modelos. */
export const MARGEN_DISCO = 2e9;

/** Lo que falta bajar (aprox.): el tamaño del índice menos lo que ya está en el disco (función pura). */
export function bytesPorBajar(tamano: number, faltan: number, yaBajados: number): number {
  return faltan ? Math.max(0, tamano - yaBajados) : 0;
}

/**
 * Qué decir antes de «Crear» por lo que hay que bajar (función pura, UX-36): `bloqueo` si no cabe en el
 * disco, `pregunta` si baja más de 10 GB, o nada.
 */
export function avisoDescarga(bytes: number, libre: number | null): { bloqueo?: string; pregunta?: string } {
  if (bytes <= 0) return {};
  const queda = libre == null ? "" : ` En el disco quedan ${textoGb(libre)} libres.`;
  if (libre != null && bytes + MARGEN_DISCO > libre) return { bloqueo: `No hay espacio: esta receta baja unos ${textoGb(bytes)} y en el disco quedan ${textoGb(libre)} libres. Libera espacio o elige una receta más liviana.` };
  if (bytes > LIGERA) return { pregunta: `Esta receta baja unos ${textoGb(bytes)}. Puede tardar mucho y quizá no quepa en tu tarjeta de video.${queda} ¿Seguir?` };
  return {};
}

/** Si al bajar un modelo de `total` bytes no queda espacio (función pura): el mensaje, o null. */
export function faltaEspacio(nombre: string, total: number, libre: number | null): string | null {
  if (!total || libre == null || total + MARGEN_DISCO <= libre) return null;
  return `No hay espacio en el disco para bajar ${nombre}: pesa ${textoGb(total)} y quedan ${textoGb(libre)} libres. Libera espacio y vuelve a intentar.`;
}
