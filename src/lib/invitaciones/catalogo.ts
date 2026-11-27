/** Textos por tipo de evento y las tres plantillas (colores y letras de Google Fonts, licencia OFL). */
import type { PlantillaId, Tipo } from "./esquema";

export interface InfoTipo {
  nombre: string;
  titulo: string;
  plantilla: PlantillaId;
  mensajes: [string, string, string];
}

export const TIPOS_INFO: Record<Tipo, InfoTipo> = {
  boda: {
    nombre: "Boda", titulo: "Nuestra boda", plantilla: "vino-oro",
    mensajes: [
      "Con amor, ilusión y la certeza de que queremos caminar juntos para siempre, te invitamos a compartir el día más importante de nuestras vidas.",
      "Hay momentos que se viven una sola vez y queremos que estés en el nuestro. Acompáñanos a celebrar nuestro amor.",
      "Nos casamos y no sería lo mismo sin ti. Ven a brindar, bailar y celebrar con nosotros.",
    ],
  },
  xv: {
    nombre: "XV años", titulo: "Mis XV años", plantilla: "vino-oro",
    mensajes: [
      "Hay sueños que se cumplen y hoy celebro uno de ellos. Me encantaría que me acompañes en mis XV años.",
      "Quince años de recuerdos, risas y amor. Te espero para celebrar juntos esta noche tan especial.",
      "Una noche mágica no está completa sin las personas que quiero. ¡Ven a celebrar mis XV conmigo!",
    ],
  },
  cumpleanos: {
    nombre: "Cumpleaños", titulo: "Mi cumpleaños", plantilla: "minimal",
    mensajes: [
      "Un año más de vida merece celebrarse con quienes más quiero. ¡Te espero!",
      "Hay pastel, música y ganas de verte. Acompáñame a celebrar mi cumpleaños.",
      "La mejor forma de empezar un nuevo año es rodeado de amigos. ¿Vienes?",
    ],
  },
  bautizo: {
    nombre: "Bautizo", titulo: "Mi bautizo", plantilla: "jardin",
    mensajes: [
      "Con mucha alegría te invitamos a acompañarnos en el bautizo de nuestro pequeño tesoro.",
      "Un nuevo comienzo lleno de fe y amor. Nos encantaría compartir este día contigo.",
      "Queremos que seas parte de este momento tan especial para nuestra familia.",
    ],
  },
  babyshower: {
    nombre: "Baby shower", titulo: "Baby shower", plantilla: "jardin",
    mensajes: [
      "Un bebé está por llegar y queremos celebrarlo contigo. ¡Te esperamos!",
      "Muy pronto seremos uno más. Acompáñanos a darle la bienvenida con mucho cariño.",
      "Pequeños pies, gran amor. Ven a celebrar con nosotros la espera más dulce.",
    ],
  },
  graduacion: {
    nombre: "Graduación", titulo: "Mi graduación", plantilla: "minimal",
    mensajes: [
      "Después de mucho esfuerzo, ¡lo logré! Me encantaría celebrar este logro contigo.",
      "Cierro una etapa y empiezo otra. Acompáñame a celebrar mi graduación.",
      "Gracias por ser parte del camino. Ahora ven a celebrar la meta conmigo.",
    ],
  },
  otro: {
    nombre: "Otro evento", titulo: "Te invitamos", plantilla: "minimal",
    mensajes: [
      "Nos encantaría contar contigo en este día tan especial.",
      "Tenemos algo que celebrar y queremos hacerlo contigo.",
      "Reserva la fecha: te esperamos para compartir un momento inolvidable.",
    ],
  },
};

export interface InfoPlantilla {
  nombre: string;
  desc: string;
  /** Colores: fondo de la página, tarjetas, tinta sobre tarjeta, texto sobre fondo, acento, sobre y sello. */
  colores: { fondo: string; fondo2: string; tarjeta: string; tinta: string; claro: string; acento: string; sobre: string; sello: string };
  letras: { titulos: string; texto: string };
  /** Colores sugeridos para el dress code si la persona no elige. */
  dress: string[];
}

export const PLANTILLAS_INFO: Record<PlantillaId, InfoPlantilla> = {
  "vino-oro": {
    nombre: "Vino y oro", desc: "Elegante, de noche: bodas y XV.",
    colores: { fondo: "#3b0a14", fondo2: "#5a1222", tarjeta: "#f3e9dc", tinta: "#4a0d1a", claro: "#f6ece0", acento: "#c9a24a", sobre: "#6b1427", sello: "#b8892f" },
    letras: { titulos: "Pinyon Script", texto: "Cormorant Garamond" },
    dress: ["#4a0d1a", "#6e5a5e", "#c8b99a", "#efe6d6"],
  },
  jardin: {
    nombre: "Jardín", desc: "Fresco y suave: bautizos, baby showers, bodas de día.",
    colores: { fondo: "#e7ece3", fondo2: "#d5dfcf", tarjeta: "#fffdf8", tinta: "#33402f", claro: "#33402f", acento: "#b0686f", sobre: "#a9bba0", sello: "#b0686f" },
    letras: { titulos: "Great Vibes", texto: "Lora" },
    dress: ["#a9bba0", "#e8c7c3", "#f4ecdf", "#8a9a86"],
  },
  minimal: {
    nombre: "Minimal", desc: "Moderno y directo: cumpleaños, graduaciones, eventos.",
    colores: { fondo: "#111111", fondo2: "#1d1d1d", tarjeta: "#fafafa", tinta: "#111111", claro: "#f5f5f5", acento: "#e0b04a", sobre: "#2a2a2a", sello: "#e0b04a" },
    letras: { titulos: "Playfair Display", texto: "Inter" },
    dress: ["#111111", "#ffffff", "#e0b04a", "#7a7a7a"],
  },
};

/** Ciudad de una zona IANA («America/Mexico_City» → «Mexico City»). */
export function ciudadDeZona(zona: string): string {
  return (zona.split("/").pop() ?? zona).replace(/_/g, " ");
}
