/**
 * Estilos de partida para una plantilla de canal: colores y letra listos para video, para quien no
 * sabe elegirlos. Se aplican en el editor de plantillas y la persona puede cambiar todo después.
 *
 * Salen de los sistemas de diseño genéricos de OpenDesign (nexu-io/open-design, Apache-2.0, carpeta
 * `design-systems/`, commit a7eb8e9): de cada familia se tomó el fondo, la tinta, el acento y el
 * carácter de la letra. Esos sistemas son para páginas web (fondo blanco y un solo acento), así que
 * aquí se rehicieron para video: la caja de los subtítulos, la palabra que suena, un segundo acento
 * para el título final y letras de Google Fonts (las de esos sistemas son del sistema operativo, como
 * Arial Black o Georgia, y Hyperframes sólo descarga las de Google). Los sistemas de marcas reales
 * (Apple, Nike, Stripe…) no se usan: copiar su identidad no es nuestro.
 *
 * Cada estilo cumple la legibilidad del editor en el peor caso (video blanco o negro debajo):
 * subtítulos, palabra que suena y botón ≥ 4,5:1, título final ≥ 3:1 (tests/estilos-plantilla.test.ts).
 */
import type { DatosPlantilla } from "./plantillas";

export interface EstiloPlantilla {
  id: string;
  nombre: string;
  /** Para quien no sabe: cómo se siente y para qué tipo de canal va bien. */
  descripcion: string;
  colores: DatosPlantilla["colores"];
  tipografia: DatosPlantilla["tipografia"];
  /** Sistemas de OpenDesign de los que sale (carpetas de `design-systems/`). */
  origen: string[];
}

export const ESTILOS_PLANTILLA: EstiloPlantilla[] = [
  {
    id: "noche-azul",
    nombre: "Noche azul",
    descripcion: "Oscuro y tecnológico, con un azul que brilla. Para tecnología, IA y apps.",
    colores: { tinta: "#f8fafc", activa: "#93c5fd", acento1: "#60a5fa", acento2: "#c7d2fe", fondoPastilla: "rgba(11, 16, 32, 0.8)", fondoCierre: "rgba(9, 11, 18, 0.88)" },
    tipografia: { titulos: "Space Grotesk", texto: "Inter", pesoTexto: 700 },
    origen: ["agentic", "dramatic", "futuristic", "sleek"],
  },
  {
    id: "blanco-negro",
    nombre: "Blanco y negro",
    descripcion: "Letra gruesa, sin color: la palabra que suena se enciende en blanco. Directo y serio.",
    colores: { tinta: "#a3a3a3", activa: "#ffffff", acento1: "#ffffff", acento2: "#d9d9d9", fondoPastilla: "rgba(17, 17, 17, 0.86)", fondoCierre: "rgba(0, 0, 0, 0.88)" },
    tipografia: { titulos: "Archivo Black", texto: "Inter", pesoTexto: 800 },
    origen: ["bold", "clean", "minimal", "mono", "atelier-zero"],
  },
  {
    id: "brutalista",
    nombre: "Amarillo brutal",
    descripcion: "Negro con amarillo chillón y letra pesada. Llama la atención; para humor y opinión.",
    colores: { tinta: "#f5f1e8", activa: "#ffef5a", acento1: "#ffef5a", acento2: "#f5f1e8", fondoPastilla: "rgba(0, 0, 0, 0.88)", fondoCierre: "rgba(0, 0, 0, 0.9)" },
    tipografia: { titulos: "Archivo Black", texto: "Archivo", pesoTexto: 800 },
    origen: ["brutalism"],
  },
  {
    id: "vibrante",
    nombre: "Vibrante",
    descripcion: "Naranja y amarillo sobre azul noche, letra redonda. Alegre; para recetas, viajes y retos.",
    colores: { tinta: "#fff8d7", activa: "#ffb703", acento1: "#ff6b00", acento2: "#ffd23f", fondoPastilla: "rgba(29, 24, 54, 0.8)", fondoCierre: "rgba(29, 24, 54, 0.88)" },
    tipografia: { titulos: "Poppins", texto: "Poppins", pesoTexto: 800 },
    origen: ["vibrant", "colorful", "energetic", "friendly", "creative"],
  },
  {
    id: "corporativo",
    nombre: "Corporativo",
    descripcion: "Azul sobrio y letra limpia. Para empresas, servicios y explicar algo con confianza.",
    colores: { tinta: "#ffffff", activa: "#93c5fd", acento1: "#5b9cf5", acento2: "#bfdbfe", fondoPastilla: "rgba(16, 24, 40, 0.8)", fondoCierre: "rgba(16, 24, 40, 0.9)" },
    tipografia: { titulos: "Inter", texto: "Inter", pesoTexto: 800 },
    origen: ["corporate", "professional", "enterprise", "simple", "flat"],
  },
  {
    id: "neon",
    nombre: "Neón cósmico",
    descripcion: "Violeta y celeste que brillan sobre negro. Para música, juegos, fiestas y misterio.",
    colores: { tinta: "#f8f7ff", activa: "#d8b4fe", acento1: "#c084fc", acento2: "#67e8f9", fondoPastilla: "rgba(7, 7, 17, 0.82)", fondoCierre: "rgba(7, 7, 17, 0.9)" },
    tipografia: { titulos: "Outfit", texto: "Outfit", pesoTexto: 800 },
    origen: ["cosmic", "neon", "fantasy", "totality-festival"],
  },
  {
    id: "lujo",
    nombre: "Lujo",
    descripcion: "Negro y dorado con letra de revista de moda. Para moda, belleza, joyas y bienes raíces.",
    colores: { tinta: "#fff8ea", activa: "#d8b46a", acento1: "#c6a15b", acento2: "#fff8ea", fondoPastilla: "rgba(8, 7, 6, 0.82)", fondoCierre: "rgba(8, 7, 6, 0.9)" },
    tipografia: { titulos: "Bodoni Moda", texto: "Nunito Sans", pesoTexto: 700 },
    origen: ["luxury", "premium"],
  },
  {
    id: "terminal",
    nombre: "Terminal",
    descripcion: "Letra de máquina, celeste y verde sobre negro. Para programación, datos y finanzas.",
    colores: { tinta: "#e2e8f0", activa: "#38bdf8", acento1: "#38bdf8", acento2: "#4ade80", fondoPastilla: "rgba(7, 11, 18, 0.84)", fondoCierre: "rgba(7, 11, 18, 0.9)" },
    tipografia: { titulos: "IBM Plex Mono", texto: "IBM Plex Mono", pesoTexto: 700 },
    origen: ["hud", "trading-terminal", "mono"],
  },
  {
    id: "natural",
    nombre: "Natural",
    descripcion: "Verdes tranquilos. Para salud, comida sana, plantas y bienestar.",
    colores: { tinta: "#fbf7ef", activa: "#86efac", acento1: "#34a853", acento2: "#bbf7d0", fondoPastilla: "rgba(31, 42, 36, 0.8)", fondoCierre: "rgba(20, 30, 24, 0.9)" },
    tipografia: { titulos: "DM Sans", texto: "DM Sans", pesoTexto: 800 },
    origen: ["levels", "urdu"],
  },
  {
    id: "editorial",
    nombre: "Editorial cálido",
    descripcion: "Subtítulos en una caja color crema, letra de libro. Para historias, cultura y recomendaciones.",
    colores: { tinta: "#201914", activa: "#8a4b22", acento1: "#c98a55", acento2: "#f3dcc0", fondoPastilla: "rgba(251, 246, 238, 0.94)", fondoCierre: "rgba(32, 25, 20, 0.88)" },
    tipografia: { titulos: "Playfair Display", texto: "Inter", pesoTexto: 700 },
    origen: ["warm-editorial", "editorial", "artistic", "elegant", "refined", "storytelling", "cafe"],
  },
  {
    id: "papel",
    nombre: "Papel antiguo",
    descripcion: "Caja de papel envejecido y tinta café. Para historia, curiosidades y nostalgia.",
    colores: { tinta: "#211b12", activa: "#7a4c17", acento1: "#c08a45", acento2: "#f0d9a8", fondoPastilla: "rgba(250, 243, 223, 0.94)", fondoCierre: "rgba(33, 27, 18, 0.88)" },
    tipografia: { titulos: "Merriweather", texto: "Lato", pesoTexto: 700 },
    origen: ["paper", "vintage", "spacious"],
  },
  {
    id: "retro",
    nombre: "Retro",
    descripcion: "Crema, naranja quemado y letra de máquina de escribir. Para videos con aire de los 70.",
    colores: { tinta: "#2a1810", activa: "#a8380f", acento1: "#e2572a", acento2: "#ffb347", fondoPastilla: "rgba(255, 244, 207, 0.94)", fondoCierre: "rgba(42, 24, 16, 0.88)" },
    tipografia: { titulos: "Courier Prime", texto: "Rubik", pesoTexto: 700 },
    origen: ["retro", "neobrutalism", "dithered"],
  },
  {
    id: "arcilla",
    nombre: "Arcilla",
    descripcion: "Tonos de barro suaves y letra redondeada. Cálido y cercano; para manualidades y hogar.",
    colores: { tinta: "#2b211c", activa: "#93492a", acento1: "#d08560", acento2: "#f2d3bd", fondoPastilla: "rgba(247, 238, 230, 0.94)", fondoCierre: "rgba(43, 33, 28, 0.88)" },
    tipografia: { titulos: "Nunito", texto: "Nunito", pesoTexto: 800 },
    origen: ["claymorphism", "neumorphism", "skeumorphism"],
  },
  {
    id: "noticiero",
    nombre: "Noticiero",
    descripcion: "Caja blanca, letras negras y rojo de periódico. Para noticias y datos de último momento.",
    colores: { tinta: "#0b0b0b", activa: "#c1121f", acento1: "#e63946", acento2: "#ffffff", fondoPastilla: "rgba(255, 255, 255, 0.95)", fondoCierre: "rgba(11, 11, 11, 0.88)" },
    tipografia: { titulos: "Libre Franklin", texto: "Libre Franklin", pesoTexto: 800 },
    origen: ["publication"],
  },
  {
    id: "zen",
    nombre: "Zen",
    descripcion: "Papel claro y azul tinta, letra fina de inspiración japonesa. Calmo; para reflexiones y arte.",
    colores: { tinta: "#141413", activa: "#1b365d", acento1: "#7aa5d6", acento2: "#f5f4ed", fondoPastilla: "rgba(245, 244, 237, 0.94)", fondoCierre: "rgba(20, 20, 19, 0.88)" },
    tipografia: { titulos: "Shippori Mincho", texto: "Inter", pesoTexto: 700 },
    origen: ["kami"],
  },
];

/** Las letras que usan los estilos (el editor las suma a su lista). */
export const FUENTES_ESTILOS = [...new Set(ESTILOS_PLANTILLA.flatMap((e) => [e.tipografia.titulos, e.tipografia.texto]))];

/** La plantilla con los colores y la letra del estilo; lo demás (marca, logo, voz, música…) no cambia. */
export function aplicarEstilo(d: DatosPlantilla, e: EstiloPlantilla): DatosPlantilla {
  return { ...structuredClone(d), colores: { ...e.colores }, tipografia: { ...e.tipografia } };
}
