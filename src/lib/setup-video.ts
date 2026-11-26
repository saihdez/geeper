/**
 * El setup de un video nuevo: qué modelo anima cada escena, con qué cámara se «filma» y qué acabado lleva.
 * Cada preset de «Nuevo» (estilos-generacion.ts) es un setup ya armado; quien quiere más control lo
 * ajusta en «Personalizar el setup» (cámara de película de 35 mm, desenfoque de movimiento, grano…).
 *
 * Qué hace cada parte:
 * - **Modelo**: el workflow de Wan2GP que pasa la imagen de la escena a video (o el zoom de siempre).
 * - **Fluidez**: interpolación RIFE ×2 de Wan2GP. Sólo para el I2V 14B, que sale a 16 cuadros por
 *   segundo; los de 24 no la necesitan.
 * - **Cámara**: cámara, lente, focal, apertura, movimiento, luz y look (prompt-camara.ts) van al prompt.
 * - **Desenfoque de movimiento** y el aspecto de película se le piden al modelo en el prompt (obturador
 *   de 180°): así sale en el movimiento real del plano, no como un filtro encima.
 * - **Grano y viñeta** se suman al estilo del video (efectos del render), en todas las escenas.
 *
 * Función pura, sin Node: la usan el formulario, la API y el paso «escenas.animar».
 */
import { z } from "zod";
import type { EstiloVideo } from "./esquema";
import type { Efecto } from "./efectos-esquema";
import { FLUIDO_X2, LIGHTNING_I2V } from "./lightning";
import { APERTURAS, CAMARAS, FOCALES, LENTES, LOOKS, LUCES, MOVIMIENTOS, PLANOS, type Camara } from "./prompt-camara";
import type { AjustesWan2gp } from "./wan2gp";

const claves = <T extends object>(t: T) => Object.keys(t) as [keyof T & string, ...(keyof T & string)[]];

export const CamaraZ = z.object({
  plano: z.enum(claves(PLANOS)).optional(),
  luz: z.enum(claves(LUCES)).optional(),
  look: z.enum(claves(LOOKS)).optional(),
  camara: z.enum(claves(CAMARAS)).optional(),
  lente: z.enum(claves(LENTES)).optional(),
  focal: z.number().refine((n) => n in FOCALES, "focal desconocida").optional(),
  apertura: z.enum(claves(APERTURAS)).optional(),
  movimiento: z.enum(claves(MOVIMIENTOS)).optional(),
});

/** Los modelos que se pueden elegir (LTX no: su licencia no permite uso comercial sin revisarla). */
export const MODELOS_VIDEO = {
  // Sin Wan: cada foto con la cámara 3D de Blender (camara3d.ts); si Blender no está, el zoom suave de siempre.
  zoom: { nombre: "Cámara 3D sobre la foto (Blender)", workflow: "Profundidad de la foto + cámara 3D en Blender (sin Blender: zoom suave)", plano: null, minutos: 0.5, medido: false, fps: null },
  rapido: { nombre: "Wan 2.2 TI2V-5B + FastWan (3 pasos)", workflow: "Wan 2.2 TI2V-5B + FastWan (3 pasos)", plano: "rapido", minutos: 2, medido: true, fps: 24 },
  ti2v: { nombre: "Wan 2.2 TI2V-5B completo (50 pasos)", workflow: "Wan 2.2 TI2V-5B (50 pasos)", plano: "ti2v", minutos: 8, medido: false, fps: 24 },
  i2v: { nombre: "Wan 2.2 I2V 14B + Lightning (4 pasos)", workflow: "Wan 2.2 I2V 14B + Lightning (4 pasos)", plano: "i2v", minutos: 6, medido: false, fps: 16 },
} as const;
export type ModeloVideo = keyof typeof MODELOS_VIDEO;

export const GRANOS = {
  no: { nombre: "Sin grano", prompt: "", efecto: null },
  fino: { nombre: "Fino (digital)", prompt: "", efecto: { tipo: "grano", cantidad: 0.06, color: false, semilla: 7 } },
  "35mm": { nombre: "Película 35 mm", prompt: "organic 35mm film grain", efecto: { tipo: "grano", cantidad: 0.1, color: true, semilla: 7 } },
  "16mm": { nombre: "Película 16 mm (más grueso)", prompt: "heavy 16mm film grain", efecto: { tipo: "grano", cantidad: 0.18, color: true, semilla: 7 } },
} as const satisfies Record<string, { nombre: string; prompt: string; efecto: Efecto | null }>;
export type Grano = keyof typeof GRANOS;

export const SetupVideo = z.object({
  modelo: z.enum(claves(MODELOS_VIDEO)),
  /** RIFE ×2 (sólo el I2V 14B, que sale a 16 cuadros por segundo). */
  fluidez: z.boolean(),
  camara: CamaraZ,
  /** Obturador de 180°: el movimiento se ve con su estela natural, como en una cámara de cine. */
  desenfoqueMovimiento: z.boolean(),
  grano: z.enum(claves(GRANOS)),
  vineta: z.boolean(),
  /** Que parezca filmado: piel con textura, luz imperfecta y un negativo contra el aspecto IA. */
  realista: z.boolean(),
});
export type SetupVideo = z.infer<typeof SetupVideo>;

/** Lo que se suma al prompt para que parezca filmado (la cámara en mano va aparte, en el movimiento). */
export const PROMPT_REALISTA =
  "real footage shot on a real camera, natural imperfect lighting, realistic skin texture with pores and fine details, " +
  "natural human motion with real weight and timing, true-to-life colors, no visual effects";

/** Lo que delata a la IA (va como prompt negativo; Wan 2.2 completo lo respeta). */
export const NEGATIVO_REALISTA =
  "CGI, 3D render, video game, cartoon, illustration, painting, plastic skin, waxy skin, airbrushed, oversmoothed, " +
  "overexposed, oversaturated, glowing, deformed hands, extra fingers, distorted face, morphing body, melting, " +
  "floating motion, flicker, blurry, watermark, text, subtitles";

export const PROMPT_DESENFOQUE = "natural motion blur from a 180-degree shutter";

export const anima = (s: SetupVideo) => MODELOS_VIDEO[s.modelo].plano !== null;
/** La fluidez sólo aplica al modelo de 16 cuadros por segundo. */
export const conFluidez = (s: SetupVideo) => s.fluidez && MODELOS_VIDEO[s.modelo].fps === 16;

/**
 * El prompt de una escena con el setup (sin la cámara: plano.ts la agrega con promptConCamara). Si pide
 * desenfoque de movimiento, «blurry» sale del negativo (si no, se contradicen).
 */
export function promptSetup(s: SetupVideo, base: string): { prompt: string; negativo?: string } {
  const partes = [base.trim().replace(/[.\s]+$/, "")];
  if (s.desenfoqueMovimiento) partes.push(PROMPT_DESENFOQUE);
  if (GRANOS[s.grano].prompt) partes.push(GRANOS[s.grano].prompt);
  if (s.realista) partes.push(PROMPT_REALISTA);
  const prompt = partes.filter(Boolean).join(". ");
  if (!s.realista) return { prompt };
  const negativo = s.desenfoqueMovimiento
    ? NEGATIVO_REALISTA.split(",").map((x) => x.trim()).filter((x) => x !== "blurry").join(", ")
    : NEGATIVO_REALISTA;
  return { prompt, negativo };
}

/** Cómo se anima cada escena (opciones de plano.ts). null: no se anima. */
export function animarDe(s: SetupVideo): { modelo: string; camara: Camara; extra?: AjustesWan2gp } | null {
  const plano = MODELOS_VIDEO[s.modelo].plano;
  if (!plano) return null;
  const extra = { ...(s.modelo === "i2v" ? LIGHTNING_I2V : {}), ...(conFluidez(s) ? FLUIDO_X2 : {}) };
  return { modelo: plano, camara: s.camara as Camara, extra: Object.keys(extra).length ? extra : undefined };
}

/** Los efectos que el setup suma al estilo del video (grano y viñeta). */
export function estiloVideoDe(s: SetupVideo): EstiloVideo | undefined {
  const efectos: Efecto[] = [];
  if (s.vineta) efectos.push({ tipo: "vineta", cantidad: 0.25, angulo: 60 });
  const g = GRANOS[s.grano].efecto;
  if (g) efectos.push({ ...g });
  return efectos.length ? { efectos } : undefined;
}

/** Si el setup hace algo en el paso «escenas.animar» (animar o sumar acabado). */
export const necesitaPasoAnimar = (s: SetupVideo) => anima(s) || !!estiloVideoDe(s);

/** Lo que tarda cada escena (null: no anima) y si se midió. */
export function minutosPorEscena(s: SetupVideo): { minutos: number | null; medido: boolean } {
  const m = MODELOS_VIDEO[s.modelo];
  return { minutos: m.minutos, medido: m.medido };
}

/** Los pasos de video y acabado del setup, como se muestran en «Nuevo». */
export function pasosSetup(s: SetupVideo): { paso: string; workflow: string }[] {
  const m = MODELOS_VIDEO[s.modelo];
  const pasos: { paso: string; workflow: string }[] = [{ paso: m.plano ? "Video" : "Movimiento", workflow: m.workflow }];
  if (conFluidez(s)) pasos.push({ paso: "Fluidez", workflow: "RIFE → 32 cuadros por segundo" });
  const acabado = [
    m.plano && (s.realista || Object.values(s.camara).some((v) => v !== undefined)) ? "cámara real" : "",
    m.plano && s.desenfoqueMovimiento ? "desenfoque de movimiento" : "",
    s.grano !== "no" ? `grano ${s.grano === "fino" ? "fino" : `de ${s.grano}`}` : "",
    s.vineta ? "viñeta" : "",
  ].filter(Boolean);
  if (acabado.length) pasos.push({ paso: "Acabado", workflow: acabado.join(", ").replace(/^./, (c) => c.toUpperCase()) });
  return pasos;
}

/** Igualdad de setups (para saber si se personalizó un preset). */
export function mismoSetup(a: SetupVideo, b: SetupVideo): boolean {
  const norm = (s: SetupVideo) => JSON.stringify({ ...s, camara: Object.fromEntries(Object.entries(s.camara).filter(([, v]) => v !== undefined).sort()) });
  return norm(a) === norm(b);
}
