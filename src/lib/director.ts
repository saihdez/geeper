/**
 * Contrato de salida del director (G1 de BRECHAS: brief → guion → storyboard aprobado).
 *
 * Es lo que un agente (Claude Code, el modelo local o quien sea) devuelve cuando propone un video desde
 * cero: escenas con lo que se oye, el plano que pide, cuánto cree que dura y dónde caen las marcas de
 * ritmo. Todavía no hay flujo en la app que lo consuma; se define ya porque el servidor MCP (B1) y las
 * salidas restringidas de Ollama (A3) lo usan, y su JSON Schema se publica en docs/esquemas/.
 *
 * La validación real es Zod (`validarDirector`): el JSON Schema no expresa los refinamientos de abajo.
 */
import { z } from "zod";
import { Formato } from "./esquema";

const ID_ESCENA = /^e\d{2,3}$/;

export const TipoPlano = z
  .enum(["generado", "archivo", "clip", "texto"])
  .describe("De dónde sale la imagen: generado (MPT o Wan), archivo propio, clip de material largo o sólo texto sobre fondo.");

export const EncuadrePlano = z
  .enum(["general", "medio", "primer-plano", "detalle"])
  .describe("Tamaño del plano pedido.");

export const MovimientoPlano = z
  .enum(["fijo", "acercar", "alejar", "paneo-izquierda", "paneo-derecha"])
  .describe("Movimiento de cámara pedido (se traduce a `movimiento` del clip visual).");

export const Plano = z
  .object({
    tipo: TipoPlano,
    descripcion: z.string().trim().min(3).max(400).describe("Qué se ve, en una o dos frases. Para planos generados es la base del prompt."),
    encuadre: EncuadrePlano.optional(),
    movimiento: MovimientoPlano.optional(),
  })
  .strict()
  .describe("El plano que el director pide para la escena.");

export const MarcaRitmo = z
  .object({
    tipo: z.enum(["corte", "pausa", "enfasis", "pulso"]).describe("corte: cambio de plano; pausa: silencio breve; enfasis: palabra que se remarca; pulso: golpe de música."),
    palabra: z.number().int().min(0).describe("Índice (desde 0) de la palabra de `narracion` donde cae la marca."),
    nota: z.string().max(120).optional().describe("Aclaración breve para quien edita."),
  })
  .strict();

export const EscenaDirector = z
  .object({
    id: z.string().regex(ID_ESCENA).describe("Id de la escena: e01, e02… (el mismo que tendrá en geeper.json)."),
    narracion: z.string().trim().min(1).max(600).describe("Lo que se oye en la escena, tal cual lo dirá la voz."),
    plano: Plano,
    duracionEstimada: z.number().min(0.5).max(60).describe("Segundos que el director cree que dura la escena."),
    textoEnPantalla: z.string().trim().max(80).optional().describe("Título o rótulo superpuesto, si la escena lo lleva."),
    ritmo: z.array(MarcaRitmo).max(20).default([]).describe("Marcas de ritmo sobre la narración."),
  })
  .strict();

export const Director = z
  .object({
    titulo: z.string().trim().min(1).max(100).describe("Nombre de trabajo del video."),
    tema: z.string().trim().min(1).max(300).describe("De qué trata, en una frase."),
    formato: Formato.default("9:16").describe("Formato del video."),
    duracionObjetivo: z.number().min(5).max(600).describe("Duración buscada en segundos."),
    escenas: z.array(EscenaDirector).min(1).max(40).describe("Escenas en orden de aparición."),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = d.escenas.map((e) => e.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Hay escenas con el mismo id" });
    d.escenas.forEach((e, i) => {
      const palabras = e.narracion.split(/\s+/).filter(Boolean).length;
      for (const m of e.ritmo) {
        if (m.palabra >= palabras) {
          ctx.addIssue({ code: "custom", path: ["escenas", i, "ritmo"], message: `${e.id}: la marca en la palabra ${m.palabra} cae fuera de la narración (${palabras} palabras)` });
        }
      }
    });
  })
  .describe("Propuesta del director: el storyboard que la persona aprueba antes de generar.");
export type Director = z.infer<typeof Director>;

export function validarDirector(datos: unknown): Director {
  return Director.parse(datos);
}

/** Prompt del director para el modelo local (función pura). La forma la impone el esquema (A3). */
export function promptDirector(o: { tema: string; duracion: number; formato?: string; notas?: string }): string {
  const escenas = Math.max(3, Math.min(10, Math.round(o.duracion / 6)));
  return [
    `Eres director de videos cortos en español neutro. Propón el storyboard de un video de ${o.duracion} s en ${o.formato ?? "9:16"}.`,
    `Tema: ${o.tema}`,
    ...(o.notas ? [`Notas de la persona: ${o.notas}`] : []),
    "",
    `- Unas ${escenas} escenas con ids e01, e02… Cada una: narración (lo que dice la voz, frases cortas), plano pedido`,
    "  (tipo generado|archivo|clip|texto, descripción visual concreta, encuadre y movimiento) y duración estimada en segundos.",
    `- La suma de duraciones cerca de ${o.duracion} s. La voz habla ~2,5 palabras por segundo: no escribas más de lo que cabe.`,
    "- La primera escena abre con un gancho (dato que sorprende, pregunta o situación). La última cierra la idea.",
    "- Marcas de ritmo: «corte», «pausa», «enfasis» o «pulso» con el índice (desde 0) de la palabra de esa narración.",
    "- NO inventes nombres propios, lugares, cifras ni citas que no estén en el tema. Si falta un dato, no lo afirmes.",
    "- Responde sólo el JSON.",
  ].join("\n");
}
