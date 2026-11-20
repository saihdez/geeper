/**
 * Propuestas de cambio a geeper.json: validar, aplicar los pasos y resumir las diferencias, sin guardar.
 * La usan `scripts/proponer.ts` y el servidor MCP (`src/lib/mcp.ts`); guardar sigue siendo
 * `guardarProyecto` (la misma ruta que la UI).
 *
 * Una propuesta es una lista de ediciones (src/lib/ediciones.ts, con referencias entre pasos de
 * src/lib/encadenar.ts) o un geeper.json completo.
 */
import { aplicarPasos, type Paso } from "./encadenar";
import { validarProyecto, type Proyecto } from "./esquema";
import { escenasEnLinea, todosLosGrupos } from "./linea";

export function resumen(p: Proyecto) {
  return {
    "formato/plantilla": `${p.formato} · ${p.plantilla}`,
    voz: `${p.voz.voz} a ${p.voz.velocidad}`,
    mostrar: p.mostrar.map((m) => `${m.de}=${m.a}`).join(", ") || "—",
    destino: `uso comercial ${p.comercial ? "sí" : "no"} · plataformas ${p.plataformas.join(", ") || "—"} · máster ${p.entrega.master ? "sí" : "no"} · marca arriba ${p.marca ? "sí" : "no"}`,
    textos: p.textos.map((t) => `${t.id} ${t.inicio.toFixed(1)}+${t.duracion.toFixed(1)} s ${t.estilo}/${t.posicion}: ${t.texto}`),
    escenas: escenasEnLinea(p).map((e) => `${e.escena.id} ${e.duracion.toFixed(2)} s [${p.assets[e.visual.asset]!.ruta}] ${e.escena.texto.slice(0, 50)}`),
    subtitulos: todosLosGrupos(p).map((g) => `${g.inicio.toFixed(2)} ${g.texto}`),
  };
}

export function diferenciasDeListas(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const sa = new Set(a);
  const sb = new Set(b);
  for (const x of a) if (!sb.has(x)) out.push(`- ${x}`);
  for (const x of b) if (!sa.has(x)) out.push(`+ ${x}`);
  return out;
}

export interface Evaluacion {
  /** El proyecto resultante, o null si la propuesta no es válida. */
  nuevo: Proyecto | null;
  pasos: Paso[];
  /** Por sección del resumen, líneas «- quitada» / «+ agregada». */
  diferencias: Record<string, string[]>;
  /** Primer paso que falló (las listas de ediciones). */
  fallo: Paso | null;
  /** Error de validación (geeper.json completo). */
  error: string | null;
}

/** Evalúa una propuesta sobre el proyecto actual (función pura: no guarda nada). */
export function evaluarPropuesta(actual: Proyecto, entrada: unknown): Evaluacion {
  let nuevo: Proyecto | null = null;
  let pasos: Paso[] = [];
  let error: string | null = null;
  if (Array.isArray(entrada)) ({ nuevo, pasos } = aplicarPasos(actual, entrada));
  else {
    try {
      nuevo = validarProyecto(entrada);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const diferencias: Record<string, string[]> = {};
  if (nuevo) {
    const a = resumen(actual);
    const b = resumen(nuevo);
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      const d = diferenciasDeListas(([] as string[]).concat(a[k]), ([] as string[]).concat(b[k]));
      if (d.length) diferencias[k] = d;
    }
  }
  return { nuevo, pasos, diferencias, fallo: pasos.find((x) => x.estado === "error") ?? null, error };
}
