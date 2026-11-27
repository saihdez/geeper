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
