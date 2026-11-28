/**
 * Cámara 3D sobre la foto de una escena (decisión del dueño, 2026-11-25): la profundidad de la foto
 * (profundidad.ts, CPU) + Blender (py/blender/camara3d.py, Cycles en la GPU con el candado) → un plano donde
 * la cámara se mueve de verdad, con paralaje, desenfoque de lente y de movimiento. El primer cuadro es la foto
 * tal cual; no inventa nada (a diferencia de Wan).
 *
 * - En «Rápido» reemplaza el zoom plano de cada escena de MPT (animar-escenas.ts).
 * - En «Equilibrado» y «Lo más real posible» es el plan B si Wan falla en una escena.
 * - En el editor, «Cámara 3D» en cada escena (trabajo `camara3d.generar`).
 *
 * Entra como el clip visual de la escena en una versión nueva (se deshace desde «Historial»), igual que plano.ts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "./almacen";
import { sha256Archivo } from "./archivos";
import { binBlender, entornoBlender, versionBlender } from "./blender";
import { INTENSIDADES_CAMARA3D, MOVIMIENTOS_CAMARA3D, movimientoAuto, type IntensidadCamara3d, type MovimientoCamara3d } from "./camara3d-catalogo";
import { reemplazarVisual } from "./ediciones";
import { pista, validarProyecto, type Proyecto } from "./esquema";
import { leerCuadro } from "./escenas3d";
import { tomarGpu } from "./gpu";
import { escenasEnLinea, type EscenaEnLinea } from "./linea";
import type { Contexto } from "./pasos";
import { correr } from "./proceso";
import { estimarProfundidad, DEPTH_ANYTHING } from "./profundidad";
import { FFMPEG, RAIZ_REPO } from "./rutas";
import { relativaADatos } from "./blender-editar";
import { existsSync } from "node:fs";

export interface OpcionesCamara3d {
  movimiento?: MovimientoCamara3d;
  intensidad?: IntensidadCamara3d;
  calidad?: "rapida" | "normal" | "alta";
  nota?: string;
}

export interface PlanCamara3d {
  escena: string;
  numero: number;
  /** Segundos que tiene que durar el plano (la escena; la primera incluye lo que hay antes de que empiece). */
  largo: number;
  movimiento: MovimientoCamara3d;
  intensidad: number;
  conCara: boolean;
}

function buscarEscena(p: Proyecto, escena: string): EscenaEnLinea {
  const escenas = escenasEnLinea(p);
  const es = /^\d+$/.test(escena) ? escenas[Number(escena) - 1] : escenas.find((x) => x.escena.id === escena);
  if (!es) throw new Error(`No hay escena ${escena} (hay ${escenas.length})`);
  return es;
}

/** Qué se va a hacer, sin tocar nada (función pura). */
export function planearCamara3d(p: Proyecto, escena: string, op: OpcionesCamara3d = {}): PlanCamara3d {
  const es = buscarEscena(p, escena);
  const a = p.assets[es.visual.asset];
  if (!a || (a.tipo !== "imagen" && a.tipo !== "video")) throw new Error(`La escena ${es.indice + 1} no tiene una foto ni un video para mover la cámara`);
  if (/\.svg$/i.test(a.ruta)) throw new Error(`La escena ${es.indice + 1} es un dibujo (SVG): la cámara 3D necesita una foto`);
  // Un video de verdad no se congela en una foto; los de MPT sí (son un zoom sobre la foto generada).
  if (a.tipo === "video" && a.source !== "mpt") throw new Error(`La escena ${es.indice + 1} ya es un video: la cámara 3D es para fotos`);
  const conCara = !!a.foco;
  return {
    escena: es.escena.id,
    numero: es.indice + 1,
    largo: Math.max(1, es.duracion + (es.indice === 0 ? es.inicio : 0)),
    movimiento: op.movimiento ?? movimientoAuto(es.indice, conCara),
    intensidad: INTENSIDADES_CAMARA3D.find((x) => x.id === (op.intensidad ?? "normal"))!.valor,
    conCara,
  };
}

/** ¿Se puede usar aquí? null si sí; si no, por qué (en palabras simples). */
export async function faltaCamara3d(): Promise<string | null> {
  return (await versionBlender()) ? null : "Falta Blender: instálalo con un clic en Sistema o en «Escenas 3D».";
}

export interface ContextoCamara3d extends Contexto {
  signal?: AbortSignal;
  avanzar?: (etapa: string, avance: number) => void;
  /** Ya se tiene el candado de la GPU (un lote de escenas lo toma una vez). */
  conCandado?: boolean;
}

const dirCorrida = (dir: string, escena: string) => path.join(dir, "build", "camara3d", `${escena}-${new Date().toISOString().replace(/[:.]/g, "-")}`);

/** Hace el plano con cámara 3D y lo pone como el clip visual de la escena, en una versión nueva. */
export async function generarCamara3dEscena(ctx: ContextoCamara3d, proyectoId: string, p: Proyecto, escena: string, op: OpcionesCamara3d = {}) {
  const plan = planearCamara3d(p, escena, op);
  const falta = await faltaCamara3d();
  if (falta) throw new Error(falta);
  const avanzar = (e: string, a: number) => ctx.avanzar?.(e, a);
  const es = buscarEscena(p, plan.escena);
  const a = p.assets[es.visual.asset]!;
  const corrida = dirCorrida(ctx.dir, plan.escena);
  await fs.mkdir(corrida, { recursive: true });
  const t0 = Date.now();
  try {
    // 1. La foto: la de la escena o, si es un video (los de MPT son un zoom sobre la foto), su cuadro de inicio.
    let foto = path.join(ctx.dir, a.ruta);
    if (a.tipo === "video") {
      foto = path.join(corrida, "foto.png");
      await correr(FFMPEG, ["-v", "error", "-y", "-ss", String(es.visual.rango.inicio), "-i", path.join(ctx.dir, a.ruta), "-frames:v", "1", foto], { signal: ctx.signal });
    }
    // 2. Profundidad (CPU).
    avanzar("Midiendo la profundidad de la foto", 0.03);
    const profundidad = path.join(corrida, "profundidad.png");
    const info = await estimarProfundidad(foto, profundidad, { log: ctx.log, signal: ctx.signal });
    // Con una cara, se enfoca la cara; si no, lo más cercano y grande de la foto.
    const foco = a.foco ? { x: a.foco.x, y: a.foco.y, profundidad: info.foco.profundidad } : info.foco;
    // Una foto casi plana (texto, captura de pantalla) no gana nada con relieve: sólo se mueve la cámara.
    const intensidad = info.relieve < 0.15 ? 0.3 * plan.intensidad : plan.intensidad;
    const pedido = path.join(corrida, "blender.json");
    const cuadros = path.join(corrida, "cuadros");
    const blend = path.join(ctx.dir, "blender", `${path.basename(corrida)}.blend`);
    await fs.mkdir(path.dirname(blend), { recursive: true });
    const escala = Number(process.env.GEEPER_BLENDER_ESCALA) || undefined;
    await fs.writeFile(pedido, JSON.stringify({
      imagen: foto, profundidad, formato: p.formato, duracion: plan.largo, movimiento: plan.movimiento, sentido: plan.numero % 2 ? 1 : -1,
      foco, intensidad, calidad: op.calidad ?? "normal", dispositivo: process.env.GEEPER_BLENDER_DISPOSITIVO === "cpu" ? "cpu" : "gpu", cuadros,
      ...(escala ? { escala } : {}),
      // El .blend editable de «Abrir en Blender» (blender-editar.ts), con la foto adentro.
      guardar_blend: blend,
    }, null, 2));
    // 3. Blender en la GPU.
    avanzar("Esperando la tarjeta de video", 0.06);
    const candado = ctx.conCandado ? null : await tomarGpu(`cámara 3D escena ${plan.numero}`, { esperar: true, signal: ctx.signal, alEsperar: (q) => avanzar(`Esperando la tarjeta de video (la usa ${q})`, 0.06) });
    let error = "";
    let movimiento: string = plan.movimiento;
    try {
      const r = await correr(binBlender(), ["-b", "--factory-startup", "--python", path.join(RAIZ_REPO, "py", "blender", "camara3d.py"), "--", pedido], {
        env: entornoBlender(), signal: ctx.signal, timeout: 60 * 60_000, permitirFallo: true,
        log: (l) => {
          const q = leerCuadro(l);
          if (q) return avanzar(`Moviendo la cámara: cuadro ${q.n} de ${q.total}`, 0.08 + 0.85 * (q.n / q.total));
          if (l.startsWith("GEEPER_ERROR ")) error = l.slice(13).trim();
          if (l.startsWith("GEEPER_MOVIMIENTO ")) movimiento = l.slice(18).trim();
          if (/^GEEPER_DISPOSITIVO|Traceback|Error/.test(l)) ctx.log(l);
        },
      });
      if (ctx.signal?.aborted) throw new Error("Cancelado");
      if (error) throw new Error(error);
      if (r.codigo !== 0) throw new Error(`Blender se cerró con un error (código ${r.codigo}).`);
    } finally {
      candado?.liberar();
    }
    // 4. Video.
    avanzar("Guardando el plano", 0.95);
    const video = path.join(corrida, "camara3d.mp4");
    await correr(FFMPEG, ["-v", "error", "-y", "-framerate", "30", "-start_number", "1", "-i", path.join(cuadros, "c_%04d.png"),
      "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { signal: ctx.signal, timeout: 20 * 60_000 });
    const hash = await sha256Archivo(video);
    const id = `camara3d-${hash.slice(0, 12)}`;
    const ruta = `assets/${id}.mp4`;
    await fs.copyFile(video, path.join(ctx.dir, ruta));
    const nombre = MOVIMIENTOS_CAMARA3D.find((m) => m.id === movimiento)?.titulo ?? movimiento;
    const asset = await describirAsset(ctx.dir, ruta, {
      id,
      tipo: "video",
      source: "archivo",
      licencia: `${a.licencia ?? "La de la foto original"}; cámara 3D hecha en esta PC con Blender y ${DEPTH_ANYTHING.licencia.split(" (")[0]} (Depth Anything V2 Small)`,
      regenerar: { motor: "blender-camara3d", movimiento, intensidad, imagenDe: a.id, segundos: Math.round((Date.now() - t0) / 1000), ...(existsSync(blend) ? { blend: relativaADatos(blend) } : {}) },
    });
    // El foco de la cara sigue valiendo: el encuadre del video es el mismo que el de la foto al empezar.
    if (a.foco) asset.foco = a.foco;
    const nuevo = structuredClone(reemplazarVisual(p, plan.escena, asset));
    const clip = pista(nuevo, "visual").clips[buscarEscena(nuevo, plan.escena).indice]!;
    clip.rango = { ...clip.rango, inicio: 0 };
    validarProyecto(nuevo);
    const version = await guardarProyecto(proyectoId, nuevo, op.nota ?? `Escena ${plan.numero} con cámara 3D (${nombre.toLowerCase()})`);
    await registrarAssetsEnDb(proyectoId, nuevo);
    return { version, asset: id, escena: plan.escena, movimiento, segundos: Math.round((Date.now() - t0) / 1000) };
  } finally {
    await fs.rm(path.join(corrida, "cuadros"), { recursive: true, force: true }).catch(() => {});
  }
}
