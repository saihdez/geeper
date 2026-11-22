/**
 * Correr un workflow de ComfyUI (trabajo `workflow.correr`, usa toda la GPU). Pasos: bajar los modelos
 * que falten → copiar los archivos de la persona a `ComfyUI/input/` → poner sus textos → arrancar
 * ComfyUI → convertir con su editor → `/prompt` → esperar en `/history` → copiar lo que salió a
 * `~/geeper-data/workflows/<corrida>/` → apagar ComfyUI. Lógica de ComfyUI en comfyui.ts.
 */
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import {
  aFormatoApi, aplicarCambios, arrancarComfyui, COMFYUI_DIR, dirResultados, estadoModelos, leerCatalogo, leerWorkflowJson, modelosDeWorkflow, PUERTO_TRABAJOS, salidasDeHistorial, textosDeWorkflow,
  type Workflow,
} from "./comfyui";
import { tomarGpu } from "./gpu";
import { resolverArchivo } from "./hub-comfy";
import { argsNodos, fijadoDe, infoNodos, instalarNodo } from "./nodos-comfy";
import type { Contexto } from "./pasos";
import { GPU_SOLO_BIN } from "./rutas";

export { entradasSinArchivo, hayEjemplo, REINTENTABLES, textoFaltaArchivo, trabajoPorCorrida, tuArchivo } from "./workflows-texto";

export const PedidoWorkflow = z.object({
  workflow: z.string().regex(/^[\w.-]+$/),
  textos: z.array(z.object({ nodo: z.string().max(80), indice: z.number().int().min(0).max(200), valor: z.string().max(5000) })).max(20).default([]),
  /** Archivos ya subidos a la carpeta de la corrida: nodo de carga → nombre del archivo. */
  archivos: z.array(z.object({ nodo: z.union([z.number(), z.string()]), nombre: z.string().regex(/^[\w.-]+$/) })).max(10).default([]),
});
export type PedidoWorkflow = z.infer<typeof PedidoWorkflow>;

export const Corrida = z.object({
  id: z.string(),
  workflow: z.string(),
  titulo: z.string(),
  creada: z.string(),
  estado: z.enum(["preparada", "hecha", "fallida"]),
  salidas: z.array(z.object({ archivo: z.string(), tipo: z.enum(["imagen", "video", "audio", "otro"]) })).default([]),
  segundos: z.number().optional(),
  error: z.string().optional(),
});
export type Corrida = z.infer<typeof Corrida>;

export const dirCorrida = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Corrida inválida");
  return path.join(dirResultados(), id);
};

export function nuevaCorrida(workflow: string) {
  return `${new Date().toISOString().slice(0, 10)}-${workflow.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${randomBytes(3).toString("hex")}`;
}

export function tipoDeArchivo(nombre: string): Corrida["salidas"][number]["tipo"] {
  const e = path.extname(nombre).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(e)) return "imagen";
  if ([".mp4", ".webm", ".mov", ".mkv"].includes(e)) return "video";
  if ([".wav", ".mp3", ".flac", ".ogg", ".m4a"].includes(e)) return "audio";
  return "otro";
}

/** Por qué no se puede correr aquí (null si se puede). */
export function bloqueo(w: Workflow): string | null {
  if (!w.local) return "Usa servicios de pago de la nube de Comfy: está bloqueado (Geeper funciona gratis, en esta PC).";
  const malos = w.complementos.map((c) => ({ c, ...fijadoDe(c) })).filter((x) => !x.fijado);
  if (malos.length) return `Usa código de la comunidad que Geeper no instala por seguridad: ${malos.map((m) => `${m.c} (${m.motivo?.replace(/\.$/, "").toLowerCase()})`).join("; ")}.`;
  return null;
}

/**
 * Aviso para recetas que corren pero no conviene usar en serio (función pura). MiniMax H3: licencia propia
 * por revisar y pensado para mucha más memoria que 16 GB (decisión del dueño: sólo experimental).
 */
export function aviso(w: Workflow): string | null {
  if (w.modelos.some((m) => /minimax\s*h3/i.test(m)) || /minimax\s*h3/i.test(w.titulo)) {
    return "Experimental: la licencia de MiniMax H3 está por revisar y pide mucha más memoria que esta tarjeta. No lo uses en videos que vayas a publicar o vender.";
  }
  return null;
}

export async function escribirCorrida(c: Corrida) {
  const dir = dirCorrida(c.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "corrida.json"), JSON.stringify(Corrida.parse(c), null, 2));
}

export async function leerCorrida(id: string): Promise<Corrida | null> {
  try {
    return Corrida.parse(JSON.parse(await fs.readFile(path.join(dirCorrida(id), "corrida.json"), "utf8")));
  } catch {
    return null;
  }
}

export async function listarCorridas(): Promise<Corrida[]> {
  let ids: string[] = [];
  try {
    ids = await fs.readdir(dirResultados());
  } catch {
    return [];
  }
  const out: Corrida[] = [];
  for (const id of ids) {
    const c = await leerCorrida(id).catch(() => null);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.creada.localeCompare(a.creada));
}

export interface AvanceWorkflow {
  etapa: string;
  avance: number;
}

/** Baja un archivo a `destino` (vía .part, para no dejar uno a medias con el nombre bueno). */
async function bajarModelo(url: string, destino: string, alAvanzar: (bajado: number, total: number) => void, signal?: AbortSignal) {
  await fs.mkdir(path.dirname(destino), { recursive: true });
  const parte = `${destino}.part`;
  const r = await fetch(url, { signal, redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`No se pudo bajar ${path.basename(destino)} (${r.status}). Si es un modelo que pide aceptar términos en Hugging Face, ábrelo en el editor de ComfyUI.`);
  const total = Number(r.headers.get("content-length") ?? 0);
  let bajado = 0;
  let ultimo = 0;
  const flujo = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
  flujo.on("data", (d: Buffer) => {
    bajado += d.length;
    if (bajado - ultimo > 50 * 1024 ** 2) {
      ultimo = bajado;
      alAvanzar(bajado, total);
    }
  });
  await pipeline(flujo, createWriteStream(parte), { signal });
  await fs.rename(parte, destino);
}

/** Pasos del muestreo en la salida de ComfyUI (barras de tqdm: « 12/20 [00:10<…»). */
export function pasoDeLinea(l: string): { paso: number; pasos: number } | null {
  const m = l.match(/\|\s*(\d+)\/(\d+)\s*\[/);
  return m ? { paso: Number(m[1]), pasos: Number(m[2]) } : null;
}

/** Explica un rechazo de `/prompt` en palabras simples. */
export function explicarRechazo(cuerpo: unknown): string {
  const c = cuerpo as { error?: { message?: string; type?: string }; node_errors?: Record<string, { errors?: { message?: string; details?: string }[]; class_type?: string }> };
  const tipos = Object.values(c.node_errors ?? {});
  const errores = tipos.flatMap((n) => n.errors ?? []);
  const falta = errores.find((e) => /not found|does not exist|invalid/i.test(`${e.message} ${e.details}`)) ?? errores[0];
  if (/missing_node_type|not found/i.test(c.error?.type ?? "") || /does not exist/i.test(c.error?.message ?? "")) {
    return `Este workflow usa piezas que no vienen con ComfyUI (${c.error?.message ?? "nodo desconocido"}). Puede que el paquete de la comunidad haya cambiado de nombre: avísalo para revisarlo.`;
  }
  if (falta) return `ComfyUI no aceptó el workflow: ${falta.message}${falta.details ? ` (${falta.details})` : ""}.`;
  return `ComfyUI no aceptó el workflow: ${c.error?.message ?? JSON.stringify(cuerpo).slice(0, 300)}`;
}

export interface ContextoWorkflow extends Contexto {
  signal?: AbortSignal;
  avanzar?: (a: AvanceWorkflow) => void;
}

/** Corre un workflow y devuelve la corrida con sus resultados. */
export async function correrWorkflow(ctx: ContextoWorkflow, id: string, pedido: PedidoWorkflow): Promise<Corrida> {
  const t0 = Date.now();
  const { workflows, archivos: delCatalogo } = await leerCatalogo();
  const wf = workflows.find((x) => x.id === pedido.workflow);
  if (!wf) throw new Error("Ese workflow no está en esta versión de ComfyUI.");
  const motivo = bloqueo(wf);
  if (motivo) throw new Error(motivo);
  const dir = dirCorrida(id);
  const base = (await leerCorrida(id)) ?? { id, workflow: wf.id, titulo: wf.titulo, creada: new Date().toISOString(), estado: "preparada" as const, salidas: [] };
  const avanzar = (etapa: string, avance: number) => ctx.avanzar?.({ etapa, avance });
  try {
    const grafo = await leerWorkflowJson(wf.id);
    // 0. Nodos extra (sólo los que la persona permitió, en su versión fijada).
    const nodos = await infoNodos(wf.complementos);
    const sinPermiso = nodos.filter((n) => !n.permitido);
    if (sinPermiso.length) throw new Error(`Falta tu permiso para instalar el código de la comunidad que usa este workflow (${sinPermiso.map((n) => n.fijado?.nombre ?? n.id).join(", ")}).`);
    for (const [k, n] of nodos.filter((x) => !x.instalado).entries()) {
      avanzar(`Instalando código de la comunidad: ${n.fijado!.nombre} (${k + 1})`, 0.01);
      await instalarNodo(n.id, { log: ctx.log, signal: ctx.signal });
    }
    // 1. Modelos que falten.
    const faltan = estadoModelos(modelosDeWorkflow(grafo)).filter((m) => !m.listo);
    for (const [k, m] of faltan.entries()) {
      ctx.log(`Bajando ${m.nombre} (${m.carpeta})`);
      await bajarModelo(m.url, m.ruta, (b, t) => avanzar(`Bajando modelos (${k + 1} de ${faltan.length}): ${(b / 1024 ** 3).toFixed(1)}${t ? ` de ${(t / 1024 ** 3).toFixed(1)}` : ""} GB`, 0.02 + 0.3 * ((k + (t ? b / t : 0)) / faltan.length)), ctx.signal);
    }
    // 2. Archivos de la persona → ComfyUI/input/ (con un prefijo de la corrida).
    const archivos = [];
    for (const a of pedido.archivos) {
      const origen = path.join(dir, "entradas", a.nombre);
      if (!existsSync(origen)) throw new Error(`No encuentro tu archivo ${a.nombre}`);
      const nombre = `geeper-${id}-${a.nombre}`;
      await fs.mkdir(path.join(COMFYUI_DIR, "input"), { recursive: true });
      await fs.copyFile(origen, path.join(COMFYUI_DIR, "input", nombre));
      archivos.push({ nodo: a.nodo, nombre });
    }
    // Sin archivo propio, la receta usa su ejemplo: ComfyUI lo busca en su carpeta input/.
    for (const e of wf.entradas) {
      if (!e.archivo || pedido.archivos.some((a) => String(a.nodo) === String(e.nodo))) continue;
      const destino = path.join(COMFYUI_DIR, "input", e.archivo);
      const ejemplo = delCatalogo[e.archivo];
      if (existsSync(destino) || !ejemplo) continue;
      avanzar("Preparando el ejemplo de la receta", 0.32);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.copyFile(await resolverArchivo(COMFYUI_DIR, ejemplo), destino);
    }
    const permitidos = new Set(textosDeWorkflow(grafo).map((t) => `${t.nodo}/${t.indice}`));
    const textos = pedido.textos.filter((t) => permitidos.has(`${t.nodo}/${t.indice}`));
    const final = aplicarCambios(grafo, { textos, archivos });
    // 3. ComfyUI, conversión y ejecución.
    avanzar("Arrancando ComfyUI (pausa la IA de MPT mientras trabaja)", 0.33);
    let ultimo = "";
    // Sin gpu-solo (Windows, macOS, la app), el turno de la tarjeta lo da el candado de gpu.ts (GPU-08).
    const candado = existsSync(GPU_SOLO_BIN)
      ? null
      : await tomarGpu(`comfyui ${wf.id}`, {
          esperar: true,
          signal: ctx.signal,
          alEsperar: (quien) => avanzar(`Esperando la tarjeta (la tiene: ${quien.slice(0, 80)})`, 0.33),
        });
    const srv = await arrancarComfyui({
      puerto: PUERTO_TRABAJOS,
      signal: ctx.signal,
      nodos: argsNodos(wf.complementos),
      log: (l) => {
        ctx.log(l);
        const p = pasoDeLinea(l);
        if (p) {
          const e = `Generando: paso ${p.paso} de ${p.pasos}`;
          if (e !== ultimo) avanzar((ultimo = e), 0.4 + 0.55 * (p.paso / Math.max(1, p.pasos)));
        } else if (/Requested to load|loaded completely|Loading/.test(l) && ultimo !== "Cargando el modelo") avanzar((ultimo = "Cargando el modelo"), 0.38);
      },
    }).catch((e: unknown) => {
      candado?.liberar();
      throw e;
    });
    const cancelar = () => void srv.detener();
    ctx.signal?.addEventListener("abort", cancelar, { once: true });
    try {
      avanzar("Preparando el workflow", 0.36);
      const api = await aFormatoApi(srv.url, final);
      const r = await fetch(`${srv.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: api, client_id: `geeper-${id}` }) });
      const cuerpo = (await r.json().catch(() => ({}))) as { prompt_id?: string };
      if (!r.ok || !cuerpo.prompt_id) throw new Error(explicarRechazo(cuerpo));
      ctx.log(`ComfyUI aceptó el workflow (prompt ${cuerpo.prompt_id})`);
      let historial: unknown = null;
      while (!historial) {
        if (ctx.signal?.aborted) throw new Error("Cancelado");
        if (srv.hijo.exitCode !== null) throw new Error("ComfyUI se cerró en medio del trabajo (¿sin memoria?). Mira el registro.");
        await new Promise((ok) => setTimeout(ok, 2000));
        const h = (await (await fetch(`${srv.url}/history/${cuerpo.prompt_id}`)).json().catch(() => ({}))) as Record<string, { status?: { status_str?: string; messages?: [string, { exception_message?: string }][] } }>;
        const e = h[cuerpo.prompt_id];
        if (e?.status?.status_str === "error") {
          const ex = e.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message ?? "error";
          throw new Error(/out of memory|OutOfMemory/i.test(ex) ? "La tarjeta de video se quedó sin memoria con este workflow." : `ComfyUI falló: ${ex.trim().split("\n").at(-1)}`);
        }
        if (e && (e.status?.status_str === "success" || (e as { outputs?: unknown }).outputs)) historial = e;
      }
      // 4. Resultados.
      avanzar("Guardando lo que salió", 0.97);
      const salidas = [];
      for (const s of salidasDeHistorial(historial)) {
        const origen = path.join(COMFYUI_DIR, s.carpeta, s.subcarpeta, s.archivo);
        if (!existsSync(origen)) continue;
        const nombre = path.basename(s.archivo);
        await fs.copyFile(origen, path.join(dir, nombre));
        salidas.push({ archivo: nombre, tipo: tipoDeArchivo(nombre) });
      }
      if (!salidas.length) throw new Error("El workflow terminó pero no dejó ningún archivo.");
      const c: Corrida = { ...base, estado: "hecha", salidas, segundos: Math.round((Date.now() - t0) / 1000) };
      await escribirCorrida(c);
      return c;
    } finally {
      ctx.signal?.removeEventListener("abort", cancelar);
      await srv.detener();
      candado?.liberar();
    }
  } catch (e) {
    await escribirCorrida({ ...base, estado: "fallida", error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) }).catch(() => {});
    throw e;
  }
}
