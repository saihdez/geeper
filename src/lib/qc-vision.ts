/**
 * QC visual con un modelo de visión local (E1 de docs/STACK-AGENTICO.md, Q3 de BRECHAS): manos, caras,
 * texto o marcas deformes en lo generado. Mira la **hoja de contacto** (un fotograma por escena en una
 * sola imagen), no cada fotograma.
 *
 * Apagado por defecto: se enciende con `GEEPER_QC_VISION=<modelo de Ollama con visión>` (p. ej.
 * `gemma4:12b` si su tag trae visión, o `qwen3-vl:8b`). Siempre es **aviso**, nunca bloquea, hasta medir
 * los falsos positivos en 30 renders (`scripts/medir-qc-vision.ts`). Si la GPU está ocupada o Docker
 * apagado, la regla lo dice y el QC sigue.
 */
import fs from "node:fs/promises";
import { z } from "zod";
import { ErrorLlm, pedirJson, type OpcionesLlm } from "./llm-local";
import type { Regla } from "./qc";

export const MODELO_QC_VISION = () => process.env.GEEPER_QC_VISION?.trim() || null;

export const ProblemaVisual = z
  .object({
    fotograma: z.number().int().min(1).describe("Número del recuadro en la hoja (1 = arriba a la izquierda, se cuenta por filas)."),
    tipo: z.enum(["mano", "cara", "texto", "marca", "otro"]).describe("mano o cara deforme, texto ilegible o inventado, logo o marca de terceros, u otro defecto visual."),
    gravedad: z.enum(["leve", "media", "grave"]),
    nota: z.string().max(160).describe("Qué se ve mal, en una frase."),
  })
  .strict();

export const RevisionVisual = z.object({ problemas: z.array(ProblemaVisual).max(30) }).describe("Defectos visuales en la hoja de contacto.");
export type RevisionVisual = z.infer<typeof RevisionVisual>;

export function promptQcVision(fotos: { nota: string }[], columnas: number): string {
  return [
    "Eres control de calidad de videos cortos hechos en parte con IA. Esta imagen es una hoja de contacto:",
    `${fotos.length} recuadros en ${columnas} columnas, numerados de 1 en adelante por filas, de izquierda a derecha.`,
    `Qué es cada uno: ${fotos.map((f, i) => `${i + 1} = ${f.nota}`).join("; ")}.`,
    "",
    "Busca SÓLO defectos claros: manos con dedos de más o fundidos, caras deformes, texto ilegible o con letras inventadas,",
    "logos o marcas de terceros reconocibles. No marques estilo, encuadre, color ni subtítulos (se revisan aparte).",
    "Si no hay defectos claros, devuelve {\"problemas\": []}. No inventes: ante la duda, no lo marques.",
  ].join("\n");
}

/** Regla de QC (aviso) a partir de la revisión (función pura). Graves y medias cuentan; leves sólo se listan. */
export function reglaVisual(modelo: string, r: RevisionVisual, fotos: { nota: string }[]): Regla {
  const validos = r.problemas.filter((p) => p.fotograma <= fotos.length);
  const importantes = validos.filter((p) => p.gravedad !== "leve");
  const texto = (p: z.infer<typeof ProblemaVisual>) => `${fotos[p.fotograma - 1]!.nota}: ${p.tipo} (${p.gravedad}) — ${p.nota}`;
  return {
    id: "visual-ia",
    nombre: "Revisión visual con IA (manos, caras, texto, marcas)",
    ok: importantes.length === 0,
    aviso: true,
    medido: { modelo, problemas: validos },
    objetivo: "sin defectos claros (aviso: el modelo puede equivocarse; mira la hoja de contacto)",
    detalle: validos.length ? validos.map(texto).join("; ") : undefined,
  };
}

/**
 * Revisa la hoja de contacto con el modelo de visión. Devuelve null si está apagado. Nunca lanza: si no
 * se pudo revisar, la regla queda en aviso con el motivo.
 */
export async function revisarHojaVisual(
  hoja: string,
  fotos: { nota: string }[],
  op: Pick<OpcionesLlm, "ejecutar" | "candado"> & { modelo?: string | null } = {},
): Promise<Regla | null> {
  const modelo = op.modelo === undefined ? MODELO_QC_VISION() : op.modelo;
  if (!modelo || !fotos.length) return null;
  try {
    const imagen = (await fs.readFile(hoja)).toString("base64");
    const r = await pedirJson(modelo, promptQcVision(fotos, Math.min(6, fotos.length)), RevisionVisual, {
      tarea: "qc visual",
      imagenes: [imagen],
      temperatura: 0,
      timeoutMs: 180_000,
      ejecutar: op.ejecutar,
      candado: op.candado,
    });
    return reglaVisual(modelo, r.datos, fotos);
  } catch (e) {
    const motivo = e instanceof ErrorLlm ? e.message : e instanceof Error ? e.message : String(e);
    return {
      id: "visual-ia",
      nombre: "Revisión visual con IA (manos, caras, texto, marcas)",
      ok: false,
      aviso: true,
      medido: { modelo, revisado: false },
      objetivo: "sin defectos claros",
      detalle: `No se pudo revisar: ${motivo}`,
    };
  }
}
