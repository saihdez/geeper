/**
 * Estilos de generación de «Nuevo»: cuánto se trabaja cada escena después de que MPT hace el guion, las
 * imágenes (Z-Image Turbo, fotos realistas) y la voz. Para quien no sabe de video: tres opciones con lo
 * que tarda cada una, y «Lo más real posible» para que no se note que es IA.
 *
 * - **Rápido**: lo de siempre, cada imagen con un zoom suave. Unos 3 minutos por tema.
 * - **Equilibrado**: cada escena pasa a video con Wan 2.2 TI2V-5B + FastWan (3 pasos, medido ~100 s).
 * - **Máxima calidad** (id `real`): lo mejor que cabe en 16 GB (decisión del dueño, 2026-11-23). Cada
 *   escena con Wan 2.2 I2V-A14B (el más fiel a la foto y con el movimiento más natural) con Lightning (4
 *   pasos), interpolado con RIFE de 16 a 32 cuadros por segundo (sin saltos), un prompt de cámara real
 *   (luz natural, piel con textura, cámara en mano leve) y un grano fino en todo el video, que esconde lo
 *   «demasiado limpio». LTX-2.3/2.5 no: su licencia no permite uso comercial sin revisarla.
 *
 * Función pura: la usan el formulario (lo que tarda), el servidor (qué guarda en el proyecto) y el
 * trabajo que anima las escenas (qué le pide a plano.ts).
 */
import { z } from "zod";
import type { EstiloVideo } from "./esquema";
import { FLUIDO_X2, LIGHTNING_I2V } from "./lightning";
import type { Camara } from "./prompt-camara";
import type { AjustesWan2gp } from "./wan2gp";

export const EstiloGeneracion = z.enum(["rapido", "equilibrado", "real"]);
export type EstiloGeneracion = z.infer<typeof EstiloGeneracion>;

export interface DefinicionEstilo {
  id: EstiloGeneracion;
  nombre: string;
  /** Para quien no sabe: qué gana, sin jerga. */
  descripcion: string;
  /** Minutos de tarjeta de video por escena, aparte de los ~3 de MPT por tema. null: no anima. */
  minutosPorEscena: number | null;
  /** Si lo que tarda ya se midió en la RTX 5080 (si no, es una estimación y se dice). */
  medido: boolean;
  /** Cómo se anima cada escena (opciones de plano.ts). null: no se anima. */
  animar: { modelo: string; camara?: Camara; realista: boolean; extra?: AjustesWan2gp } | null;
  /** Estilo del video que se guarda en el proyecto (lo heredan todas las escenas). */
  estilo?: EstiloVideo;
}

export const ESTILOS_GENERACION: Record<EstiloGeneracion, DefinicionEstilo> = {
  rapido: {
    id: "rapido",
    nombre: "Rápido",
    descripcion: "Fotos con un movimiento suave. Para probar ideas.",
    minutosPorEscena: null,
    medido: true,
    animar: null,
  },
  equilibrado: {
    id: "equilibrado",
    nombre: "Equilibrado",
    descripcion: "Cada escena pasa a video con movimiento real. Buena calidad en poco tiempo.",
    minutosPorEscena: 2,
    medido: true,
    animar: { modelo: "rapido", camara: { movimiento: "mano" }, realista: true },
  },
  real: {
    id: "real",
    nombre: "Máxima calidad",
    descripcion: "Lo mejor que corre en tu PC: movimiento natural y fiel a la imagen, fluido (32 cuadros por segundo), luz y piel creíbles y grano de cámara. Es lo más lento.",
    minutosPorEscena: 6,
    medido: false,
    animar: { modelo: "i2v", camara: { movimiento: "mano", look: "documental" }, realista: true, extra: { ...LIGHTNING_I2V, ...FLUIDO_X2 } },
    estilo: { efectos: [{ tipo: "grano", cantidad: 0.06, color: false, semilla: 7 }] },
  },
};

export const ESTILO_POR_DEFECTO: EstiloGeneracion = "rapido";

/**
 * Lo que se suma al prompt de cada escena para que parezca filmado: los modelos de video copian el
 * «aspecto IA» (piel lisa, luz perfecta, movimiento flotante) si no se les pide otra cosa.
 */
export const PROMPT_REALISTA =
  "real footage shot on a real camera, natural imperfect lighting, realistic skin texture with pores and fine details, " +
  "natural human motion with real weight and timing, subtle handheld camera, true-to-life colors, no visual effects";

/** Lo que delata a la IA (va como prompt negativo; Wan 2.2 completo lo respeta). */
export const NEGATIVO_REALISTA =
  "CGI, 3D render, video game, cartoon, illustration, painting, plastic skin, waxy skin, airbrushed, oversmoothed, " +
  "overexposed, oversaturated, glowing, deformed hands, extra fingers, distorted face, morphing body, melting, " +
  "floating motion, flicker, blurry, watermark, text, subtitles";

/** El prompt de una escena con el estilo: el de la escena y, si es realista, lo que la hace parecer filmada. */
export function promptEstilo(estilo: EstiloGeneracion, base: string): { prompt: string; negativo?: string } {
  const d = ESTILOS_GENERACION[estilo];
  const limpio = base.trim().replace(/[.\s]+$/, "");
  if (!d.animar?.realista) return { prompt: limpio };
  return { prompt: limpio ? `${limpio}. ${PROMPT_REALISTA}` : PROMPT_REALISTA, negativo: NEGATIVO_REALISTA };
}

/** Lo que tarda, dicho para el formulario («unos 45 minutos más», «estimado» si no se midió). */
export function tiempoEstimado(estilo: EstiloGeneracion, escenas = 6): string {
  const d = ESTILOS_GENERACION[estilo];
  if (d.minutosPorEscena === null) return "Unos 3 minutos por tema.";
  const total = 3 + d.minutosPorEscena * escenas;
  const texto = total >= 90 ? `unas ${Math.round(total / 60)} horas` : total >= 60 ? "una hora" : `unos ${Math.round(total / 5) * 5} minutos`;
  return `${d.medido ? "" : "Estimado: "}${d.minutosPorEscena} minutos por escena, ${texto} en un video de ${escenas} escenas.`;
}
