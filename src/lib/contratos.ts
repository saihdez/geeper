/**
 * Contratos publicados: JSON Schema 2020-12 generado desde los esquemas Zod (A2 de docs/STACK-AGENTICO.md).
 *
 * Los archivos de docs/esquemas/ son para agentes (skill `geeper`, servidor MCP) y para restringir la
 * salida del modelo local (A3). **La validación real sigue siendo Zod**: los refinamientos
 * (`superRefine`, `refine`) no pasan al JSON Schema, así que un documento puede cumplir el JSON Schema
 * y aun así no pasar `validarProyecto`. Se regeneran con `pnpm run esquemas`; una prueba falla si el
 * repo quedó desactualizado.
 */
import { z } from "zod";
import { RespuestaLlm as RespuestaIdeas } from "./anuncios/ideas";
import { Propuesta as PropuestaAnuncio } from "./anuncios/propuesta";
import { Director } from "./director";
import { Proyecto } from "./esquema";
import { RespuestaGanchos } from "./ganchos";
import { RespuestaTitulos } from "./titulos";

export const BASE_ID = "https://geeper.local/esquemas/";

interface Contrato {
  nombre: string;
  titulo: string;
  descripcion: string;
  esquema: z.ZodType;
  /** input: lo que se escribe (con valores por defecto opcionales); output: lo que queda tras validar. */
  io: "input" | "output";
}

export const CONTRATOS: readonly Contrato[] = [
  {
    nombre: "geeper",
    titulo: "geeper.json (schemaVersion 2)",
    descripcion: "Proyecto de Geeper: la fuente de verdad de cada video. Referencia exacta: src/lib/esquema.ts.",
    esquema: Proyecto,
    io: "input",
  },
  {
    nombre: "propuesta-anuncio",
    titulo: "Propuesta a una campaña de anuncios",
    descripcion: "Lo que un agente propone a una campaña (brief, conceptos, quitar). Se aplica con scripts/anuncio.ts proponer. Referencia: src/lib/anuncios/propuesta.ts.",
    esquema: PropuestaAnuncio,
    io: "input",
  },
  {
    nombre: "ganchos",
    titulo: "Respuesta del modelo: ganchos de un clip",
    descripcion: "Salida del modelo local al sugerir ganchos y título de reacción. Referencia: src/lib/ganchos.ts.",
    esquema: RespuestaGanchos,
    io: "input",
  },
  {
    nombre: "titulos",
    titulo: "Respuesta del modelo: títulos de portada",
    descripcion: "Salida del modelo local al proponer títulos de portada. Referencia: src/lib/titulos.ts.",
    esquema: RespuestaTitulos,
    io: "input",
  },
  {
    nombre: "ideas-anuncio",
    titulo: "Respuesta del modelo: ideas de anuncio",
    descripcion: "Salida del modelo local al proponer conceptos para una campaña («Propónme ideas»). Referencia: src/lib/anuncios/ideas.ts.",
    esquema: RespuestaIdeas,
    io: "input",
  },
  {
    nombre: "director",
    titulo: "Propuesta del director (storyboard)",
    descripcion: "Salida del director de G1: escenas con narración, plano pedido, duración estimada y marcas de ritmo. Referencia: src/lib/director.ts.",
    esquema: Director,
    io: "input",
  },
];

const AVISO =
  "Generado desde Zod con `pnpm run esquemas`; no editar a mano. La validación real es Zod: las reglas de consistencia (refinamientos) no están aquí.";

/** JSON Schema 2020-12 de un contrato, listo para escribir (función pura). */
export function jsonSchema(c: Contrato): Record<string, unknown> {
  const generado = z.toJSONSchema(c.esquema, { target: "draft-2020-12", io: c.io, unrepresentable: "throw" }) as Record<string, unknown>;
  const { $schema, ...resto } = generado;
  return {
    $schema,
    $id: `${BASE_ID}${c.nombre}.schema.json`,
    $comment: AVISO,
    title: c.titulo,
    ...resto,
    description: c.descripcion,
  };
}

/** Texto exacto del archivo docs/esquemas/<nombre>.schema.json. */
export function textoEsquema(c: Contrato): string {
  return `${JSON.stringify(jsonSchema(c), null, 2)}\n`;
}

export const rutaRelativaEsquema = (nombre: string) => `docs/esquemas/${nombre}.schema.json`;
