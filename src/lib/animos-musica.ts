/** Ánimos de la música libre (audio-libre/), sin nada de Node: lo usan el servidor y el editor de estilos. */

/** En `musica.carpeta` de un estilo: «libre:» (cualquier ánimo) o «libre:<ánimo>», p. ej. «libre:calm». */
export const PREFIJO_LIBRE = "libre:";
export const LICENCIA_LIBRE = "CC0-1.0 (biblioteca de audio de Doory, sintetizada; github.com/shaongitbd/doory)";

/** Ánimo de la música, en palabras de la persona (las claves son las de la biblioteca de Doory). */
export const ANIMOS: Record<string, string> = {
  upbeat: "Alegre",
  calm: "Tranquila",
  lofi: "Lo-fi relajada",
  cinematic: "Épica",
  dramatic: "Tensa",
  corporate: "Profesional",
  playful: "Divertida",
  romantic: "Romántica",
};

/** También vale escribirlo en español, sin acentos: «libre:tranquila». */
export const ANIMO_ES: Record<string, string> = {
  alegre: "upbeat", tranquila: "calm", calma: "calm", lofi: "lofi", "lo-fi": "lofi", epica: "cinematic",
  tensa: "dramatic", profesional: "corporate", divertida: "playful", romantica: "romantic",
};

/** En `musica.carpeta` de un estilo: el estilo no lleva música, a propósito (null = elige Geeper). */
export const SIN_MUSICA = "ninguna";

/** Palabras del tema que sugieren cada ánimo (sin acentos, en minúsculas). El primero que aparece gana. */
const PISTAS_ANIMO: [string, RegExp][] = [
  ["dramatic", /\b(misterio|terror|miedo|crimen|asesin|policia|guerra|batalla|conspiracion|oscur|suspenso|tension|peligro|desastre|tragedia)/],
  ["romantic", /\b(amor|boda|pareja|romanc|novi[oa]s?|aniversario|san valentin)/],
  ["calm", /\b(relaj|meditac|dormir|sueno|calma|yoga|bienestar|spa|respira|ansiedad|paz)/],
  ["lofi", /\b(estudi|leer|lectura|concentra|productividad|cafe|noche|lluvia)/],
  ["corporate", /\b(empresa|negocio|finanz|dinero|inversi|marketing|ventas|startup|tecnolog|software|app|inteligencia artificial|ia\b|trabajo|emprend|econom)/],
  ["playful", /\b(nin[oa]s?|humor|chiste|divertid|gracios|mascota|perro|gato|juguete|caricatura|broma)/],
  ["cinematic", /\b(historia|epic|aventura|viaje|espacio|universo|planeta|montana|documental|naturaleza|antigu|imperio|leyenda|juego|gta)/],
];

/** Ánimo de música que encaja con un tema («los misterios del Titanic» → tensa). Si nada encaja, alegre. */
export function animoSugerido(tema: string): string {
  const t = tema.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return PISTAS_ANIMO.find(([, re]) => re.test(t))?.[0] ?? "upbeat";
}
