/**
 * «Abrir en Blender» (pedido del dueño, 2026-11-27): todo lo que Geeper hace con Blender (escenas 3D,
 * personajes, gráficos, «Todo en 3D», la cámara 3D sobre las fotos) deja su archivo `.blend` con las fotos y
 * la luz adentro. Desde la app se abre en Blender, en esta PC, para cambiarlo a mano; al guardarlo ahí,
 * «Poner mis cambios» lo vuelve a dibujar (trabajo de GPU con el candado) y reemplaza el resultado.
 *
 * Dónde queda cada `.blend`:
 *  - escenas 3D (también las del director): `<datos>/escenas-3d/<id>/escena.blend`;
 *  - cámara 3D: `<proyecto>/blender/camara3d-<escena>-<fecha>.blend`, anotado en el asset
 *    (`regenerar.blend`, relativo a la carpeta de datos).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { binBlender, entornoBlender, versionBlender } from "./blender";
import { db } from "./db";
import { reemplazarVisual } from "./ediciones";
import type { Proyecto } from "./esquema";
import { tomarGpu } from "./gpu";
import { escenasEnLinea } from "./linea";
import { correr, type Registro } from "./proceso";
import { versionDeProyecto } from "./render";
import { dirDatos, dirProyecto, FFMPEG, RAIZ_REPO } from "./rutas";

/**
 * Ruta absoluta de un `.blend` anotado como relativo a la carpeta de datos, o null si no es válido
 * (función pura salvo `datos`): nada fuera de esa carpeta ni otra extensión.
 */
export function rutaBlendSegura(relativa: unknown, datos = dirDatos()): string | null {
  if (typeof relativa !== "string" || !/\.blend$/i.test(relativa) || path.isAbsolute(relativa)) return null;
  const raiz = path.resolve(datos);
  const abs = path.resolve(raiz, relativa);
  return abs.startsWith(raiz + path.sep) ? abs : null;
}

/** Relativa a la carpeta de datos, con «/» (para guardarla en el asset). */
export const relativaADatos = (abs: string) => path.relative(dirDatos(), abs).split(path.sep).join("/");

/** El `.blend` del visual de una escena (si lo hizo Blender y el archivo sigue ahí). */
export function blendDeEscena(p: Proyecto, escena: string): { abs: string; numero: number } | null {
  const es = escenasEnLinea(p).find((e) => e.escena.id === escena || String(e.indice + 1) === escena);
  if (!es) return null;
  const a = p.assets[es.visual.asset];
  const r = a?.regenerar as Record<string, unknown> | undefined;
  const rel = r?.blend ?? (typeof r?.escena3d === "string" ? `escenas-3d/${r.escena3d}/escena.blend` : null);
  const abs = rutaBlendSegura(rel);
  return abs && existsSync(abs) ? { abs, numero: es.indice + 1 } : null;
}

/** Abre el archivo en Blender con su ventana, en esta PC, sin esperar a que se cierre. */
export async function abrirEnBlender(abs: string): Promise<void> {
  if (!(await versionBlender())) throw new Error("Falta Blender: instálalo con un clic en Sistema.");
  if (!existsSync(abs)) throw new Error("Ese archivo de Blender ya no está (quizás se borró la escena).");
  const hijo = spawn(binBlender(), [abs], { detached: true, stdio: "ignore", windowsHide: false, env: { ...process.env, ...entornoBlender() }, cwd: path.dirname(abs) });
  await new Promise<void>((ok, mal) => {
    hijo.once("error", (e) => mal(new Error(`No se pudo abrir Blender: ${e.message}`)));
    hijo.once("spawn", () => ok());
  });
  hijo.unref();
}

/**
 * Dibuja un `.blend` tal como quedó (py/blender/render_blend.py) y deja los PNG en `cuadros`. Toma el
 * candado de la GPU. `imagen`: sólo el cuadro en el que quedó el archivo.
 */
export async function dibujarBlend(abs: string, cuadros: string, ctx: { log: Registro; signal?: AbortSignal; avanzar?: (etapa: string, avance: number) => void; imagen?: boolean }): Promise<string[]> {
  if (!(await versionBlender())) throw new Error("Falta Blender: instálalo con un clic en Sistema.");
  await fs.rm(cuadros, { recursive: true, force: true });
  await fs.mkdir(cuadros, { recursive: true });
  const pedido = path.join(path.dirname(cuadros), `dibujar-${path.basename(cuadros)}.json`);
  const escala = Number(process.env.GEEPER_BLENDER_ESCALA) || undefined;
  await fs.writeFile(pedido, JSON.stringify({ cuadros, dispositivo: process.env.GEEPER_BLENDER_DISPOSITIVO === "cpu" ? "cpu" : "gpu", imagen: !!ctx.imagen, ...(escala ? { escala } : {}) }));
  ctx.avanzar?.("Esperando la tarjeta de video", 0.02);
  const candado = await tomarGpu("dibujar tus cambios de Blender", { esperar: true, signal: ctx.signal, alEsperar: (q) => ctx.avanzar?.(`Esperando la tarjeta de video (la usa ${q})`, 0.02) });
  let error = "";
  try {
    const r = await correr(binBlender(), ["-b", abs, "--python", path.join(RAIZ_REPO, "py", "blender", "render_blend.py"), "--", pedido], {
      env: entornoBlender(), signal: ctx.signal, timeout: 3 * 60 * 60_000, permitirFallo: true,
      log: (l) => {
        const m = /GEEPER_CUADRO (\d+) (\d+)/.exec(l);
        if (m) return ctx.avanzar?.(`Dibujando tus cambios: cuadro ${m[1]} de ${m[2]}`, 0.05 + 0.85 * (Number(m[1]) / Number(m[2])));
        if (l.startsWith("GEEPER_ERROR ")) error = l.slice(13).trim();
        if (/^GEEPER_DISPOSITIVO|Traceback|Error/.test(l)) ctx.log(l);
      },
    });
    if (ctx.signal?.aborted) throw new Error("Cancelado");
    if (error) throw new Error(error);
    if (r.codigo !== 0) throw new Error(`Blender se cerró con un error (código ${r.codigo}). Mira el registro.`);
  } finally {
    candado?.liberar();
    await fs.rm(pedido, { force: true }).catch(() => {});
  }
  const pngs = (await fs.readdir(cuadros)).filter((n) => /^c_\d+\.png$/.test(n)).sort();
  if (!pngs.length) throw new Error("Blender terminó pero no dejó cuadros (¿quedó la cámara sin activar?).");
  return pngs;
}

/**
 * «Poner mis cambios» en una escena de un video: dibuja su `.blend` (editado a mano) y lo pone como el visual
 * de la escena en una versión nueva. Para lo que hizo la cámara 3D o el director, o una escena 3D puesta ahí.
 */
export async function rehacerEscenaDesdeBlend(ctx: { log: Registro; signal?: AbortSignal; avanzar?: (etapa: string, avance: number) => void }, proyectoId: string, escena: string) {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const dir = dirProyecto(fila.slug);
  const { p } = await versionDeProyecto(proyectoId);
  const b = blendDeEscena(p, escena);
  if (!b) throw new Error("Esta escena no tiene un archivo de Blender para dibujar.");
  const t0 = Date.now();
  const trabajo = path.join(dir, "build", `blender-${Date.now()}`);
  const cuadros = path.join(trabajo, "cuadros");
  try {
    const pngs = await dibujarBlend(b.abs, cuadros, ctx);
    ctx.avanzar?.("Guardando el video", 0.95);
    const video = path.join(trabajo, "video.mp4");
    await correr(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "30", "-start_number", String(Number(pngs[0]!.slice(2, -4))), "-i", path.join(cuadros, "c_%04d.png"),
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { log: ctx.log, signal: ctx.signal, timeout: 30 * 60_000 });
    const hash = createHash("sha256").update(await fs.readFile(video)).digest("hex").slice(0, 12);
    const id = `blender-${hash}`;
    const ruta = `assets/${id}.mp4`;
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    await fs.copyFile(video, path.join(dir, ruta));
    const anterior = p.assets[escenasEnLinea(p)[b.numero - 1]!.visual.asset];
    const asset = await describirAsset(dir, ruta, {
      id,
      tipo: "video",
      source: "archivo",
      licencia: `${anterior?.licencia ?? "Hecho en esta PC con Blender"}; con cambios hechos a mano en Blender`,
      regenerar: { motor: "blender-a-mano", blend: relativaADatos(b.abs), segundos: Math.round((Date.now() - t0) / 1000) },
    });
    if (anterior?.foco) asset.foco = anterior.foco;
    const nuevo = reemplazarVisual(p, escenasEnLinea(p)[b.numero - 1]!.escena.id, asset);
    const version = await guardarProyecto(proyectoId, nuevo, `Escena ${b.numero} con tus cambios de Blender`);
    await registrarAssetsEnDb(proyectoId, nuevo);
    return { version, numero: b.numero, segundos: Math.round((Date.now() - t0) / 1000) };
  } finally {
    await fs.rm(trabajo, { recursive: true, force: true }).catch(() => {});
  }
}
