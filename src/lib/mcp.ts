/**
 * Servidor MCP de Geeper (B1 de docs/STACK-AGENTICO.md): herramientas tipadas para el director (Claude
 * Code u otro *harness*). Se sirve por stdio desde `mcp/servidor.ts` con el SDK v2, que implementa la
 * revisión 2026-07-28 (sin estado) y atiende también a los clientes de 2025.
 *
 * Cada herramienta llama a `src/lib`; no reimplementa nada. Las que cambian algo (`aplicar_cambio`,
 * `encolar`, `momentos_buscar`) no son de sólo lectura y las dos primeras van con `destructiveHint`, así
 * el *harness* pide permiso. No hay herramientas para cuentas de redes ni para publicar: eso sigue siendo
 * sólo desde la UI. Sin Sampling, Roots ni Logging (obsoletos en 2026-07-28).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { guardarProyecto } from "./almacen";
import { dentroDe } from "./archivos";
import { encolar, type Payload } from "./cola";
import { CONTRATOS, jsonSchema } from "./contratos";
import { db } from "./db";
import { correr } from "./proceso";
import { evaluarPropuesta } from "./propuestas";
import type { InformeQc } from "./qc";
import { versionDeProyecto } from "./render";
import { dirDatos, dirProyecto, FFMPEG } from "./rutas";

const VERSION = "0.1.0";

/** Trabajos que un agente puede encolar. Ni generar con MPT (GPU cara, pide permiso en la UI) ni publicar. */
export const TRABAJOS_AGENTE = ["render.entregar", "voz.regenerar", "visual.reencuadrar"] as const;

type Contenido = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const texto = (datos: unknown): { content: Contenido[]; structuredContent?: Record<string, unknown> } => ({
  content: [{ type: "text", text: typeof datos === "string" ? datos : JSON.stringify(datos, null, 2) }],
});
const error = (mensaje: string) => ({ content: [{ type: "text" as const, text: mensaje }], isError: true });

async function proyectoPorSlug(slug: string) {
  const fila = await db.proyecto.findUnique({ where: { slug } });
  if (!fila) throw new Error(`No hay un proyecto «${slug}». Usa proyectos_listar para ver los slugs.`);
  return fila;
}

function resumenQc(informe: unknown) {
  const i = informe as InformeQc | null;
  if (!i) return null;
  return {
    aprobado: i.aprobado,
    fallan: i.reglas.filter((r) => !r.ok).map((r) => ({ id: r.id, nombre: r.nombre, aviso: Boolean(r.aviso), objetivo: r.objetivo, detalle: r.detalle ?? null })),
    hojaContacto: i.hojaContacto ?? null,
  };
}

/** Una vuelta por herramienta: los errores esperables vuelven como `isError` con el motivo en palabras. */
function seguro<A>(fn: (a: A) => Promise<{ content: Contenido[]; isError?: boolean }>) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e));
    }
  };
}

const Propuesta = z
  .union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())])
  .describe("Lista de ediciones (ver la skill geeper y src/lib/ediciones.ts) o un geeper.json completo.");

export function crearServidor(): McpServer {
  const s = new McpServer({ name: "geeper", version: VERSION }, { capabilities: { tools: {} } });

  s.registerTool(
    "proyectos_listar",
    {
      title: "Listar proyectos",
      description: "Proyectos de Geeper con su slug, estado, versión actual y último render (aprobado o no por el QC).",
      inputSchema: z.object({ buscar: z.string().optional().describe("Filtra por nombre o slug.") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    seguro(async ({ buscar }) => {
      const filas = await db.proyecto.findMany({
        where: buscar ? { OR: [{ nombre: { contains: buscar } }, { slug: { contains: buscar } }] } : undefined,
        orderBy: { actualizado: "desc" },
        take: 100,
        include: { renders: { orderBy: { creado: "desc" }, take: 1 } },
      });
      return texto(
        filas.map((p) => ({
          slug: p.slug,
          nombre: p.nombre,
          estado: p.estado,
          flujo: p.flujo,
          formato: p.formato,
          version: p.versionActual,
          ultimoRender: p.renders[0] ? { id: p.renders[0].id, version: p.renders[0].versionNumero, estado: p.renders[0].estado, creado: p.renders[0].creado } : null,
        })),
      );
    }),
  );

  s.registerTool(
    "proyecto_leer",
    {
      title: "Leer un proyecto",
      description: "El geeper.json de la versión actual (o la pedida), las versiones con su nota y el resultado del último QC.",
      inputSchema: z.object({ slug: z.string(), version: z.number().int().positive().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    seguro(async ({ slug, version }) => {
      const fila = await proyectoPorSlug(slug);
      const { p, numero } = await versionDeProyecto(fila.id, version);
      const versiones = await db.version.findMany({ where: { proyectoId: fila.id }, orderBy: { numero: "desc" }, take: 30, select: { numero: true, nota: true, creado: true } });
      const render = await db.render.findFirst({ where: { proyectoId: fila.id }, orderBy: { creado: "desc" } });
      return texto({
        slug,
        version: numero,
        versiones,
        ultimoRender: render ? { id: render.id, version: render.versionNumero, perfil: render.perfil, estado: render.estado, qc: resumenQc(render.informeQc) } : null,
        geeper: p,
      });
    }),
  );

  s.registerTool(
    "esquema",
    {
      title: "Esquema de un contrato",
      description: "JSON Schema 2020-12 de geeper.json u otro contrato (propuesta-anuncio, ganchos, titulos, director). La validación real es Zod.",
      inputSchema: z.object({ nombre: z.enum(CONTRATOS.map((c) => c.nombre) as [string, ...string[]]).default("geeper") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    seguro(async ({ nombre }) => texto(jsonSchema(CONTRATOS.find((c) => c.nombre === nombre)!))),
  );

  s.registerTool(
    "proponer_cambio",
    {
      title: "Proponer un cambio (sin guardar)",
      description:
        "Valida una propuesta sobre la versión actual y devuelve las diferencias (escenas, subtítulos, textos, destino…) y el estado de cada paso. No guarda nada: para guardar, aplicar_cambio con la misma propuesta y la versión que devolvió ésta.",
      inputSchema: z.object({ slug: z.string(), propuesta: Propuesta }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    seguro(async ({ slug, propuesta }) => {
      const fila = await proyectoPorSlug(slug);
      const { p, numero } = await versionDeProyecto(fila.id);
      const ev = evaluarPropuesta(p, propuesta);
      return texto({ slug, version: numero, valida: !!ev.nuevo, error: ev.error, pasos: ev.pasos, diferencias: ev.diferencias });
    }),
  );

  s.registerTool(
    "aplicar_cambio",
    {
      title: "Aplicar un cambio",
      description:
        "Guarda la propuesta como versión nueva del proyecto (la misma ruta que la UI). Sólo con el visto bueno de la persona. `versionBase` es la versión que devolvió proponer_cambio: si el proyecto cambió desde entonces, no se aplica.",
      inputSchema: z.object({
        slug: z.string(),
        propuesta: Propuesta,
        versionBase: z.number().int().nonnegative(),
        nota: z.string().max(200).default("Propuesta aplicada por un agente (MCP)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    seguro(async ({ slug, propuesta, versionBase, nota }) => {
      const fila = await proyectoPorSlug(slug);
      if (fila.versionActual !== versionBase) {
        return error(`El proyecto cambió: va por la versión ${fila.versionActual} y la propuesta se revisó sobre la ${versionBase}. Vuelve a proponer_cambio.`);
      }
      const { p } = await versionDeProyecto(fila.id);
      const ev = evaluarPropuesta(p, propuesta);
      if (!ev.nuevo) return error(ev.error ?? `La propuesta falla en el paso ${ev.fallo?.n} (${ev.fallo?.tipo}): ${ev.fallo?.error}. No se aplicó nada.`);
      const numero = await guardarProyecto(fila.id, ev.nuevo, nota);
      return texto({ slug, aplicada: numero, diferencias: ev.diferencias });
    }),
  );

  s.registerTool(
    "encolar",
    {
      title: "Encolar un trabajo",
      description:
        "Encola render.entregar (render + QC de la versión actual), voz.regenerar ({escena?}, luego render) o visual.reencuadrar. Renderizar usa la GPU: pide permiso a la persona antes. Devuelve el id del trabajo para trabajo_estado.",
      inputSchema: z.object({
        slug: z.string(),
        tipo: z.enum(TRABAJOS_AGENTE),
        payload: z.record(z.string(), z.unknown()).default({}).describe("Datos extra del trabajo (p. ej. {escena: \"e03\"} para voz.regenerar)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    seguro(async ({ slug, tipo, payload }) => {
      const fila = await proyectoPorSlug(slug);
      // `cadena` la fija Geeper, nunca el agente: si no, podría encadenar una publicación.
      const { cadena: _ignorada, ...extra } = payload;
      const base: Payload =
        tipo === "render.entregar" ? { version: fila.versionActual } : tipo === "voz.regenerar" ? { cadena: ["render.entregar"] } : { cadena: [] };
      const t = await encolar(fila.id, tipo, { ...extra, ...base });
      return texto({ trabajo: t.id, tipo: t.tipo, estado: t.estado });
    }),
  );

  s.registerTool(
    "trabajo_estado",
    {
      title: "Estado de un trabajo",
      description: "Estado, etapa, avance, error y las últimas líneas del log de un trabajo de la cola.",
      inputSchema: z.object({ id: z.string(), lineas: z.number().int().min(0).max(200).default(30) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    seguro(async ({ id, lineas }) => {
      const t = await db.trabajo.findUnique({ where: { id } });
      if (!t) return error(`No hay un trabajo ${id}.`);
      let log = "";
      if (t.log && lineas) {
        log = await fs
          .readFile(dentroDe(dirDatos(), t.log), "utf8")
          .then((x) => x.trimEnd().split("\n").slice(-lineas).join("\n"))
          .catch(() => "(no se pudo leer el log)");
      }
      return texto({ id: t.id, tipo: t.tipo, estado: t.estado, etapa: t.etapa, progreso: t.progreso, error: t.error, resultado: t.resultado, log });
    }),
  );

  s.registerTool(
    "fotograma",
    {
      title: "Ver un fotograma del render",
      description: "PNG (540 px de ancho) de un instante del último render del proyecto, para mirar cómo quedó.",
      inputSchema: z.object({ slug: z.string(), segundo: z.number().min(0), renderId: z.string().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    seguro(async ({ slug, segundo, renderId }) => {
      const fila = await proyectoPorSlug(slug);
      const render = renderId
        ? await db.render.findFirst({ where: { id: renderId, proyectoId: fila.id } })
        : await db.render.findFirst({ where: { proyectoId: fila.id }, orderBy: { creado: "desc" } });
      if (!render) return error("Este proyecto todavía no tiene render.");
      const video = dentroDe(dirProyecto(slug), render.ruta);
      if (render.duracion && segundo > render.duracion) return error(`El render dura ${render.duracion.toFixed(1)} s.`);
      const tmp = path.join(os.tmpdir(), `geeper-fotograma-${process.pid}-${Date.now()}.png`);
      let png: Buffer;
      try {
        await correr(FFMPEG, ["-v", "error", "-y", "-ss", String(segundo), "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", tmp], { timeout: 30_000 });
        png = await fs.readFile(tmp);
      } catch {
        return error("ffmpeg no devolvió imagen en ese segundo.");
      } finally {
        await fs.rm(tmp, { force: true });
      }
      return {
        content: [
          { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
          { type: "text" as const, text: `${path.basename(render.ruta)} en ${segundo} s (render ${render.id}, ${render.estado}).` },
        ],
      };
    }),
  );

  s.registerTool(
    "momentos_buscar",
    {
      title: "Buscar momentos en material largo",
      description:
        "Encola la búsqueda de momentos fuertes de un VOD, video o grabación (URL o archivo local; nunca un directo en vivo). Deja candidatos en ~/geeper-data/_fuentes/<id>/candidatos.md; sigue el avance con trabajo_estado.",
      inputSchema: z.object({
        src: z.string().min(1).describe("URL o ruta de archivo."),
        top: z.number().int().min(1).max(20).default(8),
        min: z.number().min(3).max(120).optional(),
        max: z.number().min(3).max(180).optional(),
        idioma: z.string().min(2).max(5).default("es"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    seguro(async (d) => {
      const t = await encolar(null, "clip.momentos", d);
      return texto({ trabajo: t.id, estado: t.estado });
    }),
  );

  return s;
}
