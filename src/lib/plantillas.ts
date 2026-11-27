/** Plantillas de canal: datos (colores, tipografía, logo, CTA, tarjeta final, voz), no código. */
import { z } from "zod";
import { Formato, Mostrar, Voz } from "./esquema";
import { AjustesColor, COLOR_POR_DEFECTO } from "./looks";

const Color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,]+\))$/);

export const DatosPlantilla = z.object({
  descripcion: z.string(),
  marca: z.object({
    /** Texto de la marca arriba (chip). */
    texto: z.string(),
    /** Logo opcional: ruta absoluta a un PNG/SVG local. Si falta, se usa el texto. */
    logo: z.string().nullable().default(null),
  }),
  colores: z.object({
    tinta: Color,
    activa: Color,
    acento1: Color,
    acento2: Color,
    fondoPastilla: Color,
    fondoCierre: Color,
  }),
  tipografia: z.object({
    titulos: z.string(),
    texto: z.string(),
    pesoTexto: z.number().int().min(100).max(900).default(800),
  }),
  cta: z.string(),
  tarjetaFinal: z.object({ titulo: z.string(), duracion: z.number().min(2).max(6) }),
  voz: Voz,
  /** Parámetros de MoneyPrinterTurbo para generar con esta plantilla. */
  mpt: z.object({
    video_language: z.string(),
    voice_name: z.string(),
    video_source: z.string(),
    video_clip_duration: z.number().int().min(2).max(15),
    /** Velocidad de la voz en MPT. 0,85 deja los subtítulos en ≤ 17 car./s (ver docs/DECISIONES.md). */
    voice_rate: z.number().min(0.5).max(1.5).default(0.85),
    paragraph_number: z.number().int().min(1).max(5).default(1),
    video_script_prompt: z.string().default(""),
  }),
  musica: z.object({
    volumen: z.number().min(0).max(1),
    ducking: z.boolean(),
    /**
     * Carpeta con pistas de música (se elige una por proyecto, de forma estable), «libre:<ánimo>» para la
     * música libre (audio-libre/) o «ninguna» para un estilo sin música. null = Geeper elige música libre
     * según el tema (importador.ts, elegirMusica).
     */
    carpeta: z.string().nullable(),
    /** Licencia de esa música: se copia a cada asset y el QC avisa si no está verificada. */
    licencia: z.string(),
  }),
  mostrar: z.array(Mostrar).default([]),
  /** Portada (docs/PHOTOCRAFT.md): PSD propio por formato con capas `@titulo`, `@imagen`, `@marca`…; sin PSD, la base. */
  portada: z
    .object({
      /** Ruta absoluta a un PSD (o .pcraft) por formato. */
      plantillas: z.partialRecord(Formato, z.string()).default({}),
      /** Segundo del render del que sale la imagen. null = al 30 % del video. */
      segundo: z.number().min(0).nullable().default(null),
      /** Diseño de la portada base cuando no hay PSD propio (src/lib/portada.ts, ESTILOS_PORTADA). */
      estilo: z.enum(["abajo", "centro", "banda"]).default("abajo"),
    })
    .default({ plantillas: {}, segundo: null, estilo: "abajo" }),
  /** Look de color del canal y mejora automática de las imágenes generadas (src/lib/looks.ts). */
  color: AjustesColor.default(COLOR_POR_DEFECTO),
});
export type DatosPlantilla = z.infer<typeof DatosPlantilla>;

export const PLANTILLAS_INICIALES: { slug: string; nombre: string; datos: DatosPlantilla }[] = [
  {
    slug: "gta-vi-shorts",
    nombre: "GTA VI Shorts",
    datos: {
      descripcion: "La del canal actual: rosa y naranja, karaoke amarillo. Sin material de Rockstar.",
      marca: { texto: "GTA VI Shorts", logo: null },
      colores: {
        tinta: "#ffffff",
        activa: "#ffd23f",
        acento1: "#ff3d81",
        acento2: "#ffb347",
        fondoPastilla: "rgba(8, 8, 18, 0.62)",
        fondoCierre: "rgba(0, 0, 0, 0.72)",
      },
      tipografia: { titulos: "Archivo Black", texto: "Montserrat", pesoTexto: 800 },
      cta: "Suscríbete para más",
      tarjetaFinal: { titulo: "GTA VI Shorts", duracion: 2.8 },
      voz: { motor: "mpt", voz: "kokoro:ef_dora", velocidad: 0.85, idioma: "es" },
      mpt: {
        video_language: "es-ES",
        voice_name: "kokoro:ef_dora",
        video_source: "openai_image",
        video_clip_duration: 6,
        voice_rate: 0.85,
        paragraph_number: 1,
        video_script_prompt: "",
      },
      musica: {
        volumen: 0.16,
        ducking: true,
        carpeta: `${process.env.HOME}/dev/MoneyPrinterTurbo/resource/songs`,
        licencia: "desconocida: resource/songs de MPT (su README dice que viene de YouTube)",
      },
      mostrar: [{ de: "GTA seis", a: "GTA VI" }],
      portada: { plantillas: {}, segundo: null, estilo: "abajo" },
      color: COLOR_POR_DEFECTO,
    },
  },
  {
    slug: "dimerso",
    nombre: "Dimerso",
    datos: {
      descripcion: "Neutra, para videos de Farol y de los otros productos de Dimerso.",
      marca: { texto: "Dimerso", logo: null },
      colores: {
        tinta: "#f8fafc",
        activa: "#7dd3fc",
        acento1: "#e2e8f0",
        acento2: "#94a3b8",
        fondoPastilla: "rgba(15, 23, 42, 0.66)",
        fondoCierre: "rgba(15, 23, 42, 0.86)",
      },
      tipografia: { titulos: "Inter", texto: "Inter", pesoTexto: 800 },
      cta: "Síguenos para más",
      tarjetaFinal: { titulo: "Dimerso", duracion: 2.8 },
      voz: { motor: "mpt", voz: "kokoro:ef_dora", velocidad: 0.85, idioma: "es" },
      mpt: {
        video_language: "es-ES",
        voice_name: "kokoro:ef_dora",
        video_source: "openai_image",
        video_clip_duration: 6,
        voice_rate: 0.85,
        paragraph_number: 1,
        video_script_prompt: "",
      },
      musica: { volumen: 0.12, ducking: true, carpeta: null, licencia: "sin música" },
      mostrar: [],
      portada: { plantillas: {}, segundo: null, estilo: "abajo" },
      color: COLOR_POR_DEFECTO,
    },
  },
];

export async function obtenerPlantilla(slug: string): Promise<{ slug: string; nombre: string; datos: DatosPlantilla }> {
  const { db } = await import("./db");
  const fila = await db.plantilla.findUnique({ where: { slug } });
  if (!fila) throw new Error(`No existe la plantilla «${slug}»`);
  return { slug: fila.slug, nombre: fila.nombre, datos: DatosPlantilla.parse(fila.datos) };
}
