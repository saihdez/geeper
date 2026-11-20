/**
 * Trazas con OpenTelemetry (C1 de docs/STACK-AGENTICO.md): cada trabajo de la cola como un árbol de
 * *spans* con su tiempo: el trabajo, cada paso con manifiesto (`pasos.ts`), la espera de `gpu-lock` y
 * cada llamada al modelo local (con las convenciones GenAI de OTel).
 *
 * Por defecto se escriben en `~/geeper-data/trazas/AAAA-MM-DD.jsonl` (una línea por *span*, se borran
 * a los 14 días). Sin servicios. Si existe `GEEPER_OTLP_URL` (p. ej. `http://localhost:6006/v1/traces`
 * de Phoenix en Docker), además se mandan por OTLP/HTTP. `GEEPER_TRAZAS=0` las apaga.
 *
 * Todo texto de los atributos pasa por `tapar()`: ningún token llega a una traza.
 */
import fs from "node:fs";
import path from "node:path";
import { context, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor, SimpleSpanProcessor, TracerProvider, type ReadableSpan, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace";
import { tapar } from "./redes/secretos";
import { dirDatos } from "./rutas";

export const DIAS_TRAZAS = 14;

/** Una línea del JSONL. */
export interface SpanGuardado {
  traza: string;
  span: string;
  padre: string | null;
  nombre: string;
  inicio: string;
  duracionMs: number;
  estado: "ok" | "error" | "sin-estado";
  error?: string;
  atributos: Record<string, unknown>;
  servicio: string;
}

export const dirTrazas = () => path.join(dirDatos(), "trazas");
const hrAMs = (t: [number, number]) => t[0] * 1000 + t[1] / 1e6;

function limpiarAtributos(a: Attributes): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) salida[k] = typeof v === "string" ? tapar(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? tapar(x) : x)) : v;
  return salida;
}

export function aGuardado(s: ReadableSpan, servicio: string): SpanGuardado {
  const ctx = s.spanContext();
  return {
    traza: ctx.traceId,
    span: ctx.spanId,
    padre: s.parentSpanContext?.spanId ?? null,
    nombre: s.name,
    inicio: new Date(hrAMs(s.startTime)).toISOString(),
    duracionMs: Math.round(hrAMs(s.duration) * 10) / 10,
    estado: s.status.code === SpanStatusCode.ERROR ? "error" : s.status.code === SpanStatusCode.OK ? "ok" : "sin-estado",
    ...(s.status.message ? { error: tapar(s.status.message).slice(0, 500) } : {}),
    atributos: limpiarAtributos(s.attributes),
    servicio,
  };
}

/** Exportador a JSONL por día. Escribe en el momento (pocos *spans*: uno por paso). */
export class ExportadorJsonl implements SpanExporter {
  constructor(
    private readonly servicio: string,
    private readonly dir = dirTrazas(),
  ) {}

  export(spans: ReadableSpan[], listo: (r: { code: number; error?: Error }) => void): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const porDia = new Map<string, string[]>();
      for (const s of spans) {
        const g = aGuardado(s, this.servicio);
        const dia = g.inicio.slice(0, 10);
        porDia.set(dia, [...(porDia.get(dia) ?? []), JSON.stringify(g)]);
      }
      for (const [dia, lineas] of porDia) fs.appendFileSync(path.join(this.dir, `${dia}.jsonl`), `${lineas.join("\n")}\n`);
      listo({ code: 0 });
    } catch (e) {
      listo({ code: 1, error: e as Error });
    }
  }

  async shutdown(): Promise<void> {}
}

/** Borra los JSONL de más de `dias` días (por el nombre del archivo). */
export function rotarTrazas(dir = dirTrazas(), dias = DIAS_TRAZAS, hoy = new Date()): string[] {
  const limite = new Date(hoy.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
  const borrados: string[] = [];
  let archivos: string[] = [];
  try {
    archivos = fs.readdirSync(dir);
  } catch {
    return borrados;
  }
  for (const a of archivos) {
    const m = a.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (m && m[1]! < limite) {
      fs.rmSync(path.join(dir, a), { force: true });
      borrados.push(a);
    }
  }
  return borrados;
}

const global_ = globalThis as unknown as { __geeperTrazas?: TracerProvider | null };

/**
 * Prepara las trazas una vez por proceso (worker, web o MCP). Sin llamarla, `enSpan` no registra nada
 * y no cuesta nada (la API de OTel sin proveedor es un no-op).
 */
export function iniciarTrazas(servicio: string): void {
  if (global_.__geeperTrazas !== undefined || process.env.GEEPER_TRAZAS === "0") return;
  rotarTrazas();
  const procesadores: SpanProcessor[] = [new SimpleSpanProcessor({ exporter: new ExportadorJsonl(servicio) })];
  if (process.env.GEEPER_OTLP_URL) procesadores.push(new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: process.env.GEEPER_OTLP_URL }) }));
  const proveedor = new TracerProvider({ spanProcessors: procesadores });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(proveedor);
  global_.__geeperTrazas = proveedor;
}

export async function cerrarTrazas(): Promise<void> {
  await global_.__geeperTrazas?.shutdown().catch(() => undefined);
}

const tracer = () => trace.getTracer("geeper");

export interface OpcionesSpan {
  /** Errores que no cuentan como fallo del span (p. ej. `Espera`: vuelve a la cola). */
  noEsError?: (e: unknown) => boolean;
}

/** Corre `fn` dentro de un *span* hijo del actual; marca error si lanza. */
export async function enSpan<T>(nombre: string, atributos: Attributes, fn: (span: Span) => Promise<T>, op: OpcionesSpan = {}): Promise<T> {
  return tracer().startActiveSpan(nombre, { attributes: atributos }, async (span) => {
    try {
      const r = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return r;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (op.noEsError?.(e)) span.setAttribute("geeper.resultado", tapar(mensaje).slice(0, 200));
      else span.setStatus({ code: SpanStatusCode.ERROR, message: tapar(mensaje).slice(0, 500) });
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Agrega atributos al *span* activo (si hay uno). */
export function anotar(atributos: Attributes): void {
  trace.getActiveSpan()?.setAttributes(atributos);
}

/** Los *spans* de la traza de un trabajo (función de lectura para la UI y el MCP). */
export function spansDeTrabajo(trabajoId: string, dir = dirTrazas()): SpanGuardado[] {
  let archivos: string[] = [];
  try {
    archivos = fs.readdirSync(dir).filter((a) => a.endsWith(".jsonl")).sort().reverse();
  } catch {
    return [];
  }
  const todos: SpanGuardado[] = [];
  for (const a of archivos) {
    for (const linea of fs.readFileSync(path.join(dir, a), "utf8").split("\n")) {
      if (!linea.trim()) continue;
      try {
        todos.push(JSON.parse(linea) as SpanGuardado);
      } catch {
        /* línea cortada */
      }
    }
  }
  // Un trabajo relanzado tiene una traza por intento: se toman todas.
  const trazas = new Set(todos.filter((s) => s.atributos["geeper.trabajo.id"] === trabajoId && s.padre === null).map((s) => s.traza));
  return enOrdenDeArbol(todos.filter((s) => trazas.has(s.traza)));
}

/** Padre antes que hijos y hermanos por hora de inicio (dos *spans* pueden empezar en el mismo milisegundo). */
function enOrdenDeArbol(spans: SpanGuardado[]): SpanGuardado[] {
  const ids = new Set(spans.map((s) => s.span));
  const hijos = new Map<string | null, SpanGuardado[]>();
  for (const s of spans) {
    const padre = s.padre && ids.has(s.padre) ? s.padre : null;
    hijos.set(padre, [...(hijos.get(padre) ?? []), s]);
  }
  const salida: SpanGuardado[] = [];
  const visitar = (padre: string | null) => {
    for (const s of (hijos.get(padre) ?? []).sort((a, b) => a.inicio.localeCompare(b.inicio))) {
      salida.push(s);
      visitar(s.span);
    }
  };
  visitar(null);
  return salida;
}

/** Una fila de la tabla «Pasos» de un trabajo. */
export interface FilaPaso {
  nombre: string;
  nivel: number;
  duracionMs: number;
  estado: SpanGuardado["estado"];
  detalle: string;
}

/** Los *spans* de un trabajo como tabla: en orden, con sangría por nivel y lo importante de cada uno (función pura). */
export function filasDePasos(spans: SpanGuardado[]): FilaPaso[] {
  const porId = new Map(spans.map((s) => [s.span, s]));
  const nivel = (s: SpanGuardado): number => {
    let n = 0;
    for (let p = s.padre && porId.get(s.padre); p; p = p.padre ? porId.get(p.padre) : undefined) n++;
    return n;
  };
  return spans.map((s) => {
    const a = s.atributos;
    const detalle: string[] = [];
    if (a["geeper.paso.saltado"] === true) detalle.push("ya hecho, se saltó");
    if (typeof a["geeper.gpu.espera_ms"] === "number" && a["geeper.gpu.espera_ms"] >= 1000) detalle.push(`esperó la GPU ${(a["geeper.gpu.espera_ms"] / 1000).toFixed(0)} s${a["geeper.gpu.ocupada_por"] ? ` (la tenía ${a["geeper.gpu.ocupada_por"]})` : ""}`);
    if (a["geeper.gpu.obtenida"] === false) detalle.push("GPU ocupada: no esperó");
    if (typeof a["gen_ai.usage.output_tokens"] === "number") detalle.push(`${a["gen_ai.usage.input_tokens"] ?? "?"} → ${a["gen_ai.usage.output_tokens"]} tokens`);
    if (typeof a["geeper.resultado"] === "string") detalle.push(a["geeper.resultado"]);
    if (s.error) detalle.push(s.error);
    return { nombre: s.nombre, nivel: nivel(s), duracionMs: s.duracionMs, estado: s.estado, detalle: detalle.join(" · ") };
  });
}
