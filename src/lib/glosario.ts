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
