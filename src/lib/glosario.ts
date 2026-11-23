/**
 * Nombres sugeridos para el glosario de un clip (ver whisper.ts): los nombres propios del título del video
 * y el canal, para ofrecerlos con un toque en el asistente de /clips. Sin red ni IA; se usa en el navegador.
 *
 * Un título GRITADO («KAI PIERDE LA CABEZA») o En Mayúscula Cada Palabra no deja distinguir nombres: de
 * ese título sólo se toman «sigla + número» («GTA 6», «GTA VI»); el canal se ofrece siempre.
 */

/** Palabras que van con mayúscula al empezar una frase pero no son nombres. */
const COMUNES = new Set(
  (
    "el la los las un una unos unas lo al del de en y o a que qué como cómo por porqué cuando cuándo donde dónde quien quién " +
    "mi mis tu tus su sus este esta estos estas ese esa esto eso es son fue ya no si sí nunca siempre todo todos nadie hoy " +
    "nuevo nueva mejor peor parte capítulo cap ep episodio directo stream vod reacción reaccionando " +
    "the a an and or of in on to my your his her this that these those how why what when where who is are was i you we they " +
    "new best worst part live official video full"
  ).split(" "),
);

const esMayus = (w: string) => /\p{Lu}/u.test(w) && w === w.toLocaleUpperCase("es");
const empiezaMayus = (w: string) => /^\p{Lu}/u.test(w);
const limpiar = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Hasta `max` nombres, sin repetir (sin distinguir mayúsculas). */
export function sugerirGlosario(titulo: string, canal: string | null, max = 6): string[] {
  const out: string[] = [];
  const agregar = (t: string) => {
    const x = t.trim();
    if (x.length < 2 || x.length > 40) return;
    if (COMUNES.has(x.toLocaleLowerCase("es"))) return;
    if (!out.some((o) => o.toLocaleLowerCase("es") === x.toLocaleLowerCase("es"))) out.push(x);
  };

  const canalLimpio = canal?.replace(/\s*-\s*(topic|tema)$/i, "").trim() ?? "";
  if (canalLimpio && !/^@?[\w.]+$/.test(canalLimpio)) agregar(canalLimpio);
  else if (canalLimpio) agregar(canalLimpio.replace(/^@/, ""));

  // Las frases se separan en signos fuertes: la primera palabra de cada una no cuenta como nombre por su mayúscula.
  const frases = titulo.split(/[|.!?¡¿:()[\]{}"«»–—]+|\s-\s/u);
  const palabras = titulo.split(/\s+/).map(limpiar).filter((w) => /\p{L}/u.test(w));
  const letras = palabras.filter((w) => w.length > 1);
  const gritado = letras.length > 0 && letras.filter(esMayus).length / letras.length > 0.6;
  // En Mayúscula Cada Palabra: ninguna palabra va en minúscula (un título normal en español sí las tiene: «juega», «en»).
  const tituloCase = !gritado && letras.length >= 3 && letras.every((w) => !/^\p{Ll}/u.test(w));

  if (gritado || tituloCase) {
    // Sólo «sigla + número»: «GTA 6», «GTA VI», «FC25». Una palabra gritada sola puede ser cualquier cosa.
    const re = /(?<![\p{L}\p{N}])(\p{Lu}{2,5})(?:\s(\d{1,3}|[IVX]{1,4})|(\d{1,3}))(?![\p{L}\p{N}])/gu;
    for (const m of titulo.matchAll(re)) agregar(m[3] ? `${m[1]}${m[3]}` : `${m[1]} ${m[2]}`);
    return out.slice(0, max);
  }

  for (const frase of frases) {
    const ws = frase.split(/\s+/).filter(Boolean);
    let grupo: string[] = [];
    let desde = 0;
    const cerrar = () => {
      // La primera palabra de una frase va con mayúscula igual: sola no es un nombre (salvo una sigla).
      const sola = grupo.length === 1 && desde === 0 && !/^\p{Lu}{2,5}\d{0,3}$/u.test(grupo[0]!);
      if (grupo.length && !sola) agregar(grupo.join(" "));
      grupo = [];
    };
    ws.forEach((crudo, i) => {
      const w = limpiar(crudo.replace(/^#/, ""));
      const sigla = /^\p{Lu}{2,5}\d{0,3}$/u.test(w) || /^\d{1,3}$/.test(w) || /^[IVX]{1,4}$/.test(w);
      const nombre = empiezaMayus(w) && !COMUNES.has(w.toLocaleLowerCase("es"));
      if (w && (nombre || (grupo.length > 0 && sigla))) {
        if (!grupo.length) desde = i;
        grupo.push(w);
      } else cerrar();
      if (/[,;]$/.test(crudo)) cerrar();
    });
    cerrar();
  }
  return out.filter((t) => !/^\d+$/.test(t)).slice(0, max);
}

/** Agrega un término a lo que ya está escrito en el campo («A, B» + «C» → «A, B, C»), sin repetir. */
export function sumarAlGlosario(actual: string, termino: string): string {
  const ya = actual.split(",").map((t) => t.trim()).filter(Boolean);
  if (ya.some((t) => t.toLocaleLowerCase("es") === termino.toLocaleLowerCase("es"))) return ya.join(", ");
  return [...ya, termino].join(", ");
}

/* ───────────────────────── Vocabulario de pantalla (A11-06) ─────────────────────────
 * Otro glosario, el de la persona: una palabra por cosa en todas las pantallas. Antes había unos 20
 * conceptos con 2 a 4 nombres («GPU», «tarjeta gráfica» y «tarjeta de video»; «QC» y «control de
 * calidad»; «Formato», «9:16» y «shorts-9x16»…). Es el vocabulario de Clips y de la demo web, que son
 * las pantallas pensadas para quien no sabe de video. Al escribir un texto nuevo se usa `usar`; las
 * palabras de `evitar` no van en pantalla (sí en el código, el registro y los nombres técnicos).
 * tests/vocabulario.test.ts revisa los textos de las pantallas que ya lo siguen.
 */
export interface Termino {
  /** La palabra que se muestra. */
  usar: string;
  /** Otros nombres de lo mismo que no se muestran (se buscan como palabra entera, sin mayúsculas). */
  evitar: string[];
  nota?: string;
}

export const VOCABULARIO = {
  tarjeta: { usar: "tarjeta de video", evitar: ["GPU", "tarjeta gráfica", "VRAM"], nota: "«la memoria de la tarjeta de video» en vez de VRAM" },
  revision: { usar: "revisión", evitar: ["QC", "control de calidad"], nota: "«la revisión» del video antes de publicar" },
  crear: { usar: "crear el video", evitar: ["renderizar", "renderizado", "render"], nota: "el video terminado es «el video», no «el render»" },
  enCola: { usar: "en cola", evitar: ["encolado", "render en cola"], nota: "«quedó en cola: empieza cuando termine lo anterior»" },
  forma: { usar: "forma del video", evitar: ["formato", "perfil", "relación de aspecto", "shorts-9x16", "youtube-16x9", "cuadrado-1x1"], nota: "vertical, horizontal o cuadrado; ver nombreForma()" },
  estilo: { usar: "estilo del canal", evitar: ["plantilla de canal", "plantilla"], nota: "letra, colores, cierre y voz; la página se llama «Estilos del canal» cuando la toque su grupo" },
  idea: { usar: "idea", evitar: ["concepto"] },
  reintentar: { usar: "Volver a intentar", evitar: ["Reintentar", "Relanzar", "reintento", "relanzas"] },
  nuevo: { usar: "Nuevo video", evitar: ["Nuevo proyecto", "Nuevo proyecto o lote"] },
  varios: { usar: "varios videos", evitar: ["lote"], nota: "«Crear 3 videos» en vez de «Crear lote de 3»" },
  interrumpido: { usar: "interrumpido", evitar: ["abortado"], nota: "lo que se cortó porque se apagó la PC o se cerró Geeper" },
  voz: { usar: "voz", evitar: ["narración", "locución", "TTS"] },
  subtitulos: { usar: "subtítulos", evitar: ["captions", "SRT"] },
  portada: { usar: "portada", evitar: ["miniatura", "thumbnail"] },
  registro: { usar: "registro", evitar: ["log", "logs"] },
  efectos: { usar: "efectos de sonido", evitar: ["SFX"] },
  link: { usar: "link", evitar: ["URL"] },
  escena: { usar: "escena", evitar: ["segmento"] },
  avatar: { usar: "avatar", evitar: ["gemelo digital"] },
  cuenta: { usar: "cuenta", evitar: ["credencial", "token"], nota: "«conectar una cuenta»" },
} as const satisfies Record<string, Termino>;

/** Las palabras que no van en pantalla y la que va en su lugar (para avisos y pruebas). */
export function palabrasAEvitar(): { palabra: string; usar: string }[] {
  return Object.values(VOCABULARIO).flatMap((t: Termino) => t.evitar.map((palabra) => ({ palabra, usar: t.usar })));
}

/** Las palabras de `evitar` que aparecen en `texto`, como palabra entera y sin distinguir mayúsculas. */
export function jergaEn(texto: string): { palabra: string; usar: string }[] {
  const t = texto.toLocaleLowerCase("es");
  return palabrasAEvitar().filter(({ palabra }) => {
    const p = palabra.toLocaleLowerCase("es").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}_-])${p}(?![\\p{L}\\p{N}_-])`, "u").test(t);
  });
}

/** Las tres formas del video, como se muestran. */
export const FORMAS: Record<"9:16" | "16:9" | "1:1", { nombre: string; para: string }> = {
  "9:16": { nombre: "Vertical", para: "TikTok, Reels, Shorts" },
  "16:9": { nombre: "Horizontal", para: "YouTube, web" },
  "1:1": { nombre: "Cuadrado", para: "Instagram, Facebook" },
};

const PERFILES: Record<string, keyof typeof FORMAS> = { "shorts-9x16": "9:16", "youtube-16x9": "16:9", "cuadrado-1x1": "1:1" };

/** «vertical (9:16)» para "9:16" o para el perfil "shorts-9x16"; lo que no conoce lo devuelve igual. */
export function nombreForma(formatoOPerfil: string): string {
  const f = (formatoOPerfil in FORMAS ? formatoOPerfil : PERFILES[formatoOPerfil]) as keyof typeof FORMAS | undefined;
  return f ? `${FORMAS[f].nombre.toLocaleLowerCase("es")} (${f})` : formatoOPerfil;
}
