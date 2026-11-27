/**
 * Estilos de generación de «Nuevo»: cuánto se trabaja cada escena después de que MPT hace el guion, las
 * imágenes (Z-Image Turbo, fotos realistas) y la voz. Para quien no sabe de video: tres opciones con lo
 * que tarda cada una, y «Lo más real posible» para que no se note que es IA.
 *
 * - **Rápido**: cada foto con la cámara 3D de Blender (profundidad, paralaje y desenfoque; camara3d.ts) en
 *   vez del zoom plano. Unos 30 s más por escena; sin Blender, el zoom de siempre.
 * - **Equilibrado**: cada escena pasa a video con Wan 2.2 TI2V-5B + FastWan (3 pasos, medido ~100 s).
 * - **Máxima calidad** (id `real`): lo mejor que cabe en 16 GB (decisión del dueño, 2026-11-23). Cada
 *   escena con Wan 2.2 I2V-A14B (el más fiel a la foto y con el movimiento más natural) con Lightning (4
 *   pasos), interpolado con RIFE de 16 a 32 cuadros por segundo (sin saltos), un prompt de cámara real
 *   (luz natural, piel con textura, cámara en mano leve) y un grano fino en todo el video, que esconde lo
 *   «demasiado limpio». LTX-2.3/2.5 no: su licencia no permite uso comercial sin revisarla.
 *
 * - **Todo en 3D** (id `3d`, decisión del dueño 2026-11-27): el director de Geeper (director3d.ts) arma cada
 *   escena en Blender con piezas probadas: un personaje que habla al abrir y al cerrar, gráficos con las
 *   cifras del guion, títulos 3D sobre la imagen de la escena y la cámara 3D sobre las fotos. El modelo local
 *   sólo elige pieza y frase. Su setup es el de «Rápido» (no anima con Wan) y no se personaliza.
 *
 * Cada preset es un setup ya armado (setup-video.ts): modelo, fluidez, cámara y acabado. En «Nuevo» se
 * puede partir de uno y personalizarlo.
 *
 * Función pura: la usan el formulario (lo que tarda), el servidor (qué guarda en el proyecto) y el
 * trabajo que anima las escenas (qué le pide a plano.ts).
 */
import { z } from "zod";
import type { EstiloVideo } from "./esquema";
import type { Camara } from "./prompt-camara";
import { animarDe, estiloVideoDe, minutosPorEscena, NEGATIVO_REALISTA, pasosSetup, PROMPT_REALISTA, promptSetup, type SetupVideo } from "./setup-video";
import type { AjustesWan2gp } from "./wan2gp";

export { NEGATIVO_REALISTA, PROMPT_REALISTA };

export const EstiloGeneracion = z.enum(["rapido", "equilibrado", "real", "3d"]);
export type EstiloGeneracion = z.infer<typeof EstiloGeneracion>;

export interface DefinicionEstilo {
  id: EstiloGeneracion;
  nombre: string;
  /** Para quien no sabe: qué gana, sin jerga. */
  descripcion: string;
  /** El setup del preset (modelo, fluidez, cámara y acabado). */
  setup: SetupVideo;
  /** Minutos de tarjeta de video por escena, aparte de los ~3 de MPT por tema. null: no anima. */
  minutosPorEscena: number | null;
  /** Si lo que tarda ya se midió en la RTX 5080 (si no, es una estimación y se dice). */
  medido: boolean;
  /** Cómo se anima cada escena (opciones de plano.ts). null: no se anima. */
  animar: { modelo: string; camara?: Camara; realista: boolean; extra?: AjustesWan2gp } | null;
  /** Estilo del video que se guarda en el proyecto (lo heredan todas las escenas). */
  estilo?: EstiloVideo;
  /** Los workflows que usa en cada paso, para mostrarlos en «Nuevo» (paso → qué lo hace). */
  pasos: { paso: string; workflow: string }[];
  /** La opción que se recomienda para el mejor resultado. */
  recomendado?: boolean;
}

/** Lo que comparten todos: el guion y las imágenes de MPT, y la voz. */
const BASE: DefinicionEstilo["pasos"] = [
  { paso: "Guion", workflow: "IA local de MoneyPrinterTurbo" },
  { paso: "Imágenes", workflow: "Z-Image Turbo" },
  { paso: "Voz", workflow: "Voz de la PC, gratis (o la de tu avatar)" },
];

/** Lo que se suma con tu avatar de protagonista (protagonista.ts), muestre el preset que muestre. */
export const PASOS_AVATAR: DefinicionEstilo["pasos"] = [
  { paso: "Avatar en cada fondo", workflow: "Qwen Image Edit" },
  { paso: "Avatar que habla", workflow: "InfiniteTalk (Wan 2.1 14B)" },
];

/** Todo lo que se deriva del setup (el preset sólo pone nombre, descripción y el setup). */
function preset(d: { id: EstiloGeneracion; nombre: string; descripcion: string; setup: SetupVideo; recomendado?: boolean }): DefinicionEstilo {
  const a = animarDe(d.setup);
  const t = minutosPorEscena(d.setup);
  return {
    ...d,
    minutosPorEscena: t.minutos,
    medido: t.medido,
    animar: a && { ...a, realista: d.setup.realista },
    estilo: estiloVideoDe(d.setup),
    pasos: [...BASE, ...pasosSetup(d.setup)],
  };
}

export const ESTILOS_GENERACION = {
  rapido: preset({
    id: "rapido",
    nombre: "Rápido",
    descripcion: "Fotos con una cámara de verdad: se mueve entre lo de adelante y el fondo, con desenfoque. Para probar ideas.",
    setup: { modelo: "zoom", fluidez: false, camara: {}, desenfoqueMovimiento: false, grano: "no", vineta: false, realista: false },
  }),
  equilibrado: preset({
    id: "equilibrado",
    nombre: "Equilibrado",
    descripcion: "Cada escena pasa a video con movimiento real. Buena calidad en poco tiempo.",
    setup: { modelo: "rapido", fluidez: false, camara: { movimiento: "mano" }, desenfoqueMovimiento: false, grano: "no", vineta: false, realista: true },
  }),
  real: preset({
    id: "real",
    nombre: "Máxima calidad",
    descripcion: "Lo mejor que corre en tu PC: movimiento natural y fiel a la imagen, fluido (32 cuadros por segundo), luz y piel creíbles y grano de cámara. Es lo más lento.",
    setup: { modelo: "i2v", fluidez: true, camara: { movimiento: "mano", look: "documental" }, desenfoqueMovimiento: true, grano: "fino", vineta: false, realista: true },
    recomendado: true,
  }),
} as Record<EstiloGeneracion, DefinicionEstilo>;

ESTILOS_GENERACION["3d"] = {
  id: "3d",
  nombre: "Todo en 3D",
  descripcion: "Cada escena hecha en 3D, como una animación: un personaje que habla al abrir y al cerrar, gráficos con tus cifras y títulos en 3D sobre las imágenes.",
  setup: ESTILOS_GENERACION.rapido.setup,
  minutosPorEscena: 3,
  medido: false,
  animar: null,
  pasos: [
    ...BASE,
    { paso: "Escenas 3D", workflow: "Blender: personaje, gráficos, títulos y cámara 3D" },
    { paso: "Boca del personaje", workflow: "Rhubarb Lip Sync" },
  ],
};

export const ESTILO_POR_DEFECTO: EstiloGeneracion = "rapido";

/** El prompt de una escena con el estilo: el de la escena y, si es realista, lo que la hace parecer filmada. */
export function promptEstilo(estilo: EstiloGeneracion, base: string): { prompt: string; negativo?: string } {
  return promptSetup(ESTILOS_GENERACION[estilo].setup, base);
}

/** Lo que tarda, dicho para el formulario («unos 45 minutos más», «estimado» si no se midió). */
export function tiempoEstimado(estilo: EstiloGeneracion | SetupVideo, escenas = 6): string {
  const d = typeof estilo === "string" ? ESTILOS_GENERACION[estilo] : null;
  const t = d?.id === "3d" ? { minutos: d.minutosPorEscena, medido: d.medido } : minutosPorEscena(d ? d.setup : (estilo as SetupVideo));
  if (t.minutos === null) return "Unos 3 minutos por tema.";
  const total = 3 + t.minutos * escenas;
  const texto = total >= 90 ? `unas ${Math.round(total / 60)} horas` : total >= 60 ? "una hora" : `unos ${Math.round(total / 5) * 5} minutos`;
  const porEscena = t.minutos < 1 ? "medio minuto" : `${t.minutos} minutos`;
  return `${t.medido ? "" : "Estimado: "}${porEscena} por escena, ${texto} en un video de ${escenas} escenas.`;
}

/**
 * Los workflows de cada paso, como se muestran en «Nuevo». Con tu avatar de protagonista no se anima cada
 * imagen (el avatar ya es video en cada escena): se muestran sus pasos en lugar de los de video, y del
 * acabado sólo lo que va encima del video (grano, viñeta).
 */
export function pasosDe(estilo: EstiloGeneracion | SetupVideo, conAvatar: boolean): DefinicionEstilo["pasos"] {
  if (estilo === "3d") return conAvatar ? [...ESTILOS_GENERACION["3d"].pasos, ...PASOS_AVATAR] : ESTILOS_GENERACION["3d"].pasos;
  const setup = typeof estilo === "string" ? ESTILOS_GENERACION[estilo].setup : estilo;
  if (!conAvatar) return [...BASE, ...pasosSetup(setup)];
  const encima = pasosSetup({ ...setup, modelo: "zoom", desenfoqueMovimiento: false }).filter((x) => x.paso === "Acabado");
  return [...BASE, ...encima, ...PASOS_AVATAR];
}
