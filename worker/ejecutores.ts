/** Ejecutores por tipo de trabajo. Cada uno devuelve su resultado y, si toca, el siguiente de la cadena. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crearCarpetas, guardarProyecto, registrarAssetsEnDb } from "@/lib/almacen";
import { generarPropuesta, retocarAvatar } from "@/lib/avatares";
import { guardarPayload, type Payload, type TipoTrabajo } from "@/lib/cola";
import { db } from "@/lib/db";
import { Formato } from "@/lib/esquema";
import { tomarGpu } from "@/lib/gpu";
import { importarMpt } from "@/lib/importador";
import { importarDemo } from "@/lib/importador-demo";
import { buscarMomentos } from "@/lib/buscar-momentos";
import { Campania } from "@/lib/clips";
import { ENCUADRES, importarClip, type EncuadreClip } from "@/lib/importador-clip";
import { apiViva, crearVideo, cuerpoVideo, estadoTarea, modeloImagen } from "@/lib/mpt";
import type { Contexto } from "@/lib/pasos";
import { obtenerPlantilla } from "@/lib/plantillas";
import { correr } from "@/lib/proceso";
import { generarPlanoEscena, type OpcionesPlano } from "@/lib/plano";
import { generarPresentador, type OpcionesPresentador } from "@/lib/presentador";
import { PedidoRehacer, rehacerEscena } from "@/lib/rehacer";
import { animarEscenasDelVideo } from "@/lib/animar-escenas";
import { actuarEscena, leerAvatarDelVideo, PedidoActuar, PedidoStreamer, proponerEscenas, streamerAvatar } from "@/lib/actuar";
import { correrWorkflow, PedidoWorkflow } from "@/lib/workflows";
import { regenerarVoz } from "@/lib/regenerar";
import { IdiomaTraduccion, traducirProyecto } from "@/lib/traducir";
import { disenarVoz } from "@/lib/voces";
import { agregarEfecto, describirEnIngles, generarEfecto } from "@/lib/efectos-sonido";
import type { Avance } from "@/lib/wan2gp";
import { reencuadrarEscena } from "@/lib/reencuadre";
import { renderEntregar, versionDeProyecto } from "@/lib/render";
import { publicarSubir } from "@/lib/redes/publicar";
import { dirProyecto } from "@/lib/rutas";

export interface Trabajo {
  id: string;
  tipo: string;
  proyectoId: string | null;
  payload: Payload;
}

export interface Herramientas extends Contexto {
  etapa: (e: string, progreso: number) => Promise<void>;
  signal: AbortSignal;
}

export interface Salida {
  resultado: unknown;
  siguiente?: { tipo: TipoTrabajo; payload: Payload };
}

const dormir = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, mal) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      mal(new Error("Cancelado"));
    });
  });

function siguienteDe(payload: Payload, extra: Payload = {}): Salida["siguiente"] {
  const [tipo, ...resto] = payload.cadena ?? [];
  if (!tipo) return undefined;
  return { tipo, payload: { ...extra, cadena: resto } };
}

/** Telemetría de la GPU cada 5 s en un CSV que sobrevive a un reinicio (fsync en cada línea). */
function telemetria(ruta: string): () => void {
  let activo = true;
  const tick = async () => {
    if (!activo) return;
    try {
      const r = await correr("nvidia-smi", ["--query-gpu=temperature.gpu,power.draw,memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { permitirFallo: true });
      const carga = os.loadavg()[0]!.toFixed(2); // 0 en Windows
      const fh = await fs.open(ruta, "a");
      await fh.write(`${new Date().toISOString()},${r.stdout.trim().replace(/\s/g, "")},${carga}\n`);
      await fh.sync();
      await fh.close();
    } catch {
      /* sin nvidia-smi */
    }
    if (activo) setTimeout(() => void tick(), 5000).unref();
  };
  void fs.writeFile(ruta, "tiempo,temp_c,potencia_w,vram_mib,uso_pct,carga1\n").then(tick);
  return () => {
    activo = false;
  };
}

async function mptGenerar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const proyecto = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId! } });
  const dir = await crearCarpetas(proyecto.slug);
  const plantilla = await obtenerPlantilla(proyecto.plantilla);
  if (!(await apiViva())) throw new Error("La API de MPT (127.0.0.1:8080) no responde. Corre `pnpm run doctor` para ver qué falta.");
  await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "generando" } });

  let taskId = typeof t.payload.mptTaskId === "string" ? t.payload.mptTaskId : undefined;
  if (taskId) {
    const e = await estadoTarea(taskId);
    if (e.estado === "completa") {
      h.log(`La tarea MPT ${taskId} ya había terminado: no se vuelve a generar`);
      return { resultado: { taskId, retomada: true }, siguiente: siguienteDe(t.payload, { taskId }) };
    }
    if (e.estado === "fallida" || e.estado === "perdida") {
      h.log(`La tarea MPT anterior ${taskId} quedó ${e.estado}: se pide una nueva`);
      taskId = undefined;
    } else h.log(`Retomo la espera de la tarea MPT ${taskId} (${e.progreso} %)`);
  }

  await h.etapa("Esperando la GPU", 0.01);
  const candado = await tomarGpu(`mpt ${proyecto.slug}`, {
    esperar: true,
    signal: h.signal,
    alEsperar: (quien) => {
      h.log(`GPU ocupada por: ${quien}. Esperando...`);
      void h.etapa(`Esperando la GPU (la tiene: ${quien.slice(0, 80)})`, 0.01);
    },
  });
  const pararTelemetria = telemetria(path.join(dir, "logs", `${t.id}-telemetria.csv`));
  try {
    if (!taskId) {
      const guion = typeof t.payload.guion === "string" ? t.payload.guion : undefined;
      const cuerpo = cuerpoVideo(proyecto.tema, Formato.parse(proyecto.formato), plantilla.datos.mpt, guion);
      taskId = await crearVideo(cuerpo);
      // Se guarda ANTES de esperar: si el worker muere, al relanzar se retoma esta misma tarea.
      await guardarPayload(t.id, { ...t.payload, mptTaskId: taskId });
      h.log(`MPT aceptó la tarea ${taskId}: ${JSON.stringify(cuerpo)}`);
    }
    const t0 = Date.now();
    for (;;) {
      const e = await estadoTarea(taskId);
      if (e.estado === "completa") break;
      if (e.estado === "fallida" || e.estado === "perdida") throw new Error(`MPT: tarea ${taskId} ${e.estado}. ${e.detalle ?? ""}`);
      await h.etapa(`MPT generando (${e.progreso} %, ${Math.round((Date.now() - t0) / 1000)} s)`, 0.02 + (e.progreso / 100) * 0.95);
      await dormir(5000, h.signal);
    }
    h.log(`MPT terminó la tarea ${taskId} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } finally {
    pararTelemetria();
    candado?.liberar();
  }
  return { resultado: { taskId }, siguiente: siguienteDe(t.payload, { taskId }) };
}

async function proyectoImportar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const proyecto = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId! } });
  const taskId = String(t.payload.taskId ?? "");
  const plantilla = await obtenerPlantilla(proyecto.plantilla);
  await h.etapa("Copiando la tarea de MPT y alineando la voz (whisper, CPU)", 0.1);
  const r = await importarMpt(h, {
    proyectoId: proyecto.id,
    slug: proyecto.slug,
    nombre: proyecto.nombre,
    tema: proyecto.tema,
    formato: Formato.parse(proyecto.formato),
    plantilla,
    taskId,
    modeloImagen: await modeloImagen(),
  });
  await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "ensamblado" } });
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function clipMomentos(t: Trabajo, h: Herramientas): Promise<Salida> {
  const pl = t.payload;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  await h.etapa("Trayendo la fuente y midiendo el sonido", 0.1);
  const r = await buscarMomentos(
    {
      src: String(pl.src ?? ""),
      top: n(pl.top), min: n(pl.min), max: n(pl.max), maxMinutos: n(pl.maxMinutos),
      idioma: typeof pl.idioma === "string" ? pl.idioma : undefined,
    },
    h.log,
    h.signal,
  );
  return { resultado: { fuente: r.fuente, candidatos: r.candidatos.length } };
}

async function clipImportar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const proyecto = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId! } });
  const pl = t.payload;
  const encuadre = String(pl.encuadre ?? "cubrir");
  if (!(ENCUADRES as readonly string[]).includes(encuadre)) throw new Error(`Encuadre desconocido: ${encuadre}`);
  const texto = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  await h.etapa("Cortando el tramo, reencuadrando y transcribiendo (CPU)", 0.1);
  const r = await importarClip(h, {
    proyectoId: proyecto.id,
    slug: proyecto.slug,
    nombre: proyecto.nombre,
    tema: proyecto.tema,
    formato: Formato.parse(proyecto.formato),
    plantilla: await obtenerPlantilla(proyecto.plantilla),
    fuenteId: String(pl.fuenteId ?? ""),
    inicio: Number(pl.inicio),
    fin: Number(pl.fin),
    encuadre: encuadre as EncuadreClip,
    idioma: texto(pl.idioma) ?? "es",
    titulo: texto(pl.titulo),
    gancho: texto(pl.gancho),
    permiso: texto(pl.permiso),
    glosario: texto(pl.glosario),
    campania: pl.campania ? Campania.parse(pl.campania) : undefined,
    mejorarVoz: pl.mejorarVoz !== false,
  });
  await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "ensamblado" } });
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function demoCrear(t: Trabajo, h: Herramientas): Promise<Salida> {
  const proyecto = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId! } });
  const pl = t.payload;
  const formato = proyecto.formato === "16:9" ? "16:9" : "9:16";
  const r = await importarDemo(h, {
    proyectoId: proyecto.id,
    slug: proyecto.slug,
    nombre: proyecto.nombre,
    tema: proyecto.tema,
    formato,
    plantilla: await obtenerPlantilla(proyecto.plantilla),
    url: String(pl.url ?? ""),
    estilo: pl.estilo === "plano" ? "plano" : "3d",
    texto: String(pl.texto ?? ""),
    historia: pl.historia === "clic" || pl.historia === "scroll" ? pl.historia : undefined,
    propio: pl.propio === true,
  });
  await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "ensamblado" } });
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function visualReencuadrar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const escena = String(t.payload.escena ?? "");
  const layout = t.payload.layout === "cara" ? "cara" : "react";
  await h.etapa(`Buscando la cara (${layout}, CPU)`, 0.1);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const r = await reencuadrarEscena(h, t.proyectoId!, p, escena, layout);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function vozRegenerar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const escena = typeof t.payload.escena === "string" ? t.payload.escena : null;
  await h.etapa(escena ? `Voz nueva para ${escena} y subtítulos realineados` : "Voz nueva del guion completo y subtítulos realineados", 0.1);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const r = await regenerarVoz(h, t.proyectoId!, p, escena);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function efectoGenerar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const pl = t.payload;
  let prompt = String(pl.prompt ?? "");
  if (!prompt) {
    await h.etapa("Entendiendo qué sonido quieres (IA local)", 0.05);
    prompt = await describirEnIngles(String(pl.descripcion ?? ""), h);
    h.log(`Descripción para el modelo: ${prompt}`);
  }
  await h.etapa("Creando el sonido (tarjeta gráfica; la primera carga tarda ~1,5 min)", 0.2);
  const e = await generarEfecto(h, { nombre: String(pl.nombre ?? "Efecto"), prompt, segundos: Number(pl.segundos ?? 3) });
  await h.etapa("Agregándolo al video", 0.95);
  const inicio = Number(pl.inicio ?? 0);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const nuevo = await agregarEfecto(h.dir, p, e, inicio);
  const version = await guardarProyecto(t.proyectoId!, nuevo, `Efecto de sonido «${e.nombre}» en ${inicio.toFixed(1)} s`);
  await registrarAssetsEnDb(t.proyectoId!, nuevo);
  return { resultado: { version, efecto: e.id } };
}

async function vozDisenar(t: Trabajo, h: Herramientas): Promise<Salida> {
  await h.etapa("Creando 3 voces que cumplan la descripción (VoxCPM2, tarjeta gráfica)", 0.1);
  const r = await disenarVoz(h, String(t.payload.propuesta ?? ""), String(t.payload.descripcion ?? ""));
  return { resultado: r };
}

async function proyectoTraducir(t: Trabajo, h: Herramientas): Promise<Salida> {
  const idioma = IdiomaTraduccion.parse(t.payload.idioma);
  try {
    const r = await traducirProyecto(h, t.proyectoId!, String(t.payload.origen ?? ""), idioma);
    await db.proyecto.update({ where: { id: t.proyectoId! }, data: { estado: "ensamblado" } });
    return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
  } catch (e) {
    await db.proyecto.update({ where: { id: t.proyectoId! }, data: { estado: "fallido" } });
    throw e;
  }
}

/** Lo que ve la persona en Trabajos mientras se anima una escena. */
export function etapaDePlano(a: Avance): string {
  switch (a.fase) {
    case "descargando":
      return `Bajando el modelo (sólo la primera vez): ${(a.bytes! / 1024 ** 3).toFixed(1)} GB`;
    case "cargando":
      return "Cargando el modelo en la GPU";
    case "codificando":
      return "Preparando la imagen";
    case "generando":
      return a.pasos ? `Animando: paso ${a.paso} de ${a.pasos}` : "Animando";
    case "decodificando":
      return "Armando el video";
    default:
      return "Guardando el plano";
  }
}

async function planoGenerar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const escena = String(t.payload.escena ?? "");
  const opciones = (t.payload.opciones ?? {}) as OpcionesPlano;
  await h.etapa("Esperando la GPU (pausa la IA de MPT mientras anima)", 0.01);
  const { p } = await versionDeProyecto(t.proyectoId!);
  let ultima = "";
  const r = await generarPlanoEscena(
    { ...h, alAvanzar: (a) => {
      const e = etapaDePlano(a);
      if (e !== ultima) void h.etapa((ultima = e), a.avance);
    } },
    t.proyectoId!, p, escena, opciones,
  );
  h.log(`Escena animada en ${r.segundos} s → versión ${r.version}`);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

/** El avance de Wan2GP en palabras, para los trabajos de avatar. */
function conAvance(h: Herramientas, verbo: string) {
  let ultima = "";
  return {
    ...h,
    alAvanzar: (a: Avance) => {
      const e = a.fase === "generando" ? (a.pasos ? `${verbo}: paso ${a.paso} de ${a.pasos}` : verbo) : etapaDePlano(a).replace("Guardando el plano", "Guardando");
      if (e !== ultima) void h.etapa((ultima = e), a.avance);
    },
  };
}

async function avatarProponer(t: Trabajo, h: Herramientas): Promise<Salida> {
  await h.etapa("Esperando la GPU (pausa la IA de MPT mientras dibuja)", 0.01);
  return { resultado: await generarPropuesta(conAvance(h, "Dibujando"), String(t.payload.propuesta ?? "")) };
}

async function avatarRetocar(t: Trabajo, h: Herramientas): Promise<Salida> {
  await h.etapa("Esperando la GPU (pausa la IA de MPT mientras retoca)", 0.01);
  const semilla = typeof t.payload.semilla === "number" ? t.payload.semilla : undefined;
  const a = await retocarAvatar(conAvance(h, "Retocando"), String(t.payload.avatar ?? ""), String(t.payload.instruccion ?? ""), semilla);
  return { resultado: { avatar: a.id, versiones: a.versiones.length } };
}

async function presentadorGenerar(t: Trabajo, h: Herramientas): Promise<Salida> {
  await h.etapa("Esperando la GPU (pausa la IA de MPT mientras el avatar habla)", 0.01);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const r = await generarPresentador(conAvance(h, "Haciendo hablar al avatar"), t.proyectoId!, p, t.payload.opciones as OpcionesPresentador);
  h.log(`Presentador listo en ${r.segundos} s → versión ${r.version}`);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function avatarActuar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const pedido = PedidoActuar.parse(t.payload.pedido);
  await h.etapa("Poniendo a tu avatar en la escena", 0.01);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const r = await actuarEscena(conAvance(h, pedido.tipo === "habla" ? "Haciendo hablar al avatar" : "Animando al avatar"), t.proyectoId!, p, String(t.payload.escena ?? ""), pedido);
  h.log(`Avatar en la escena → versión ${r.version}`);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function avatarStreamer(t: Trabajo, h: Herramientas): Promise<Salida> {
  const pedido = PedidoStreamer.parse(t.payload.pedido);
  await h.etapa("Preparando a tu avatar sobre fondo verde", 0.01);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const r = await streamerAvatar(conAvance(h, "Haciendo hablar al avatar"), t.proyectoId!, p, pedido);
  h.log(`Avatar streamer → versión ${r.version}`);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

/** Video nuevo con avatar: lo pone en las escenas que propone Geeper, una por una (la persona ajusta después). */
async function avatarEscenas(t: Trabajo, h: Herramientas): Promise<Salida> {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId! } });
  const elegido = await leerAvatarDelVideo(fila.slug);
  if (!elegido) return { resultado: { escenas: 0 }, siguiente: siguienteDe(t.payload) };
  let { p } = await versionDeProyecto(t.proyectoId!);
  const propuestas = proponerEscenas(p, elegido.avatar, { producto: elegido.producto });
  const hechas: number[] = [];
  for (const [i, pr] of propuestas.entries()) {
    await h.etapa(`Tu avatar en la escena ${pr.numero} (${i + 1} de ${propuestas.length}): ${pr.porque}`, i / propuestas.length);
    try {
      const r = await actuarEscena(conAvance(h, `Escena ${pr.numero}`), t.proyectoId!, p, pr.escena, pr.pedido);
      hechas.push(pr.numero);
      h.log(`Escena ${pr.numero} con avatar → versión ${r.version}`);
      ({ p } = await versionDeProyecto(t.proyectoId!));
    } catch (e) {
      // Una escena que falla no tumba el video: queda como estaba y se puede reintentar desde el editor.
      if (h.signal?.aborted) throw e;
      h.log(`Escena ${pr.numero}: no se pudo (${e instanceof Error ? e.message.split("\n")[0] : e}); queda como estaba.`);
    }
  }
  return { resultado: { escenas: hechas }, siguiente: siguienteDe(t.payload) };
}

/** Video nuevo «Equilibrado» o «Lo más real posible»: cada escena de MPT pasa a video (animar-escenas.ts). */
async function escenasAnimar(t: Trabajo, h: Herramientas): Promise<Salida> {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId! } });
  const r = await animarEscenasDelVideo(conAvance(h, "Animando"), t.proyectoId!, fila.slug, async (a) => {
    await h.etapa(`Animando la escena ${a.numero} (${a.indice + 1} de ${a.total})`, a.indice / Math.max(1, a.total));
  });
  h.log(r.hechas.length ? `Escenas animadas: ${r.hechas.join(", ")}` : "No había escenas para animar");
  return { resultado: r, siguiente: siguienteDe(t.payload) };
}

async function escenaRehacer(t: Trabajo, h: Herramientas): Promise<Salida> {
  const pedido = PedidoRehacer.parse(t.payload.pedido);
  await h.etapa(pedido.tipo === "persona" ? "Buscando a la persona en cada cuadro" : "Preparando la toma", 0.01);
  const { p } = await versionDeProyecto(t.proyectoId!);
  const r = await rehacerEscena(conAvance(h, pedido.tipo === "persona" ? "Cambiando la persona" : "Moviendo la cámara"), t.proyectoId!, p, String(t.payload.escena ?? ""), pedido);
  h.log(`Toma rehecha en ${r.segundos} s → versión ${r.version}`);
  return { resultado: r, siguiente: siguienteDe(t.payload, { version: r.version }) };
}

async function workflowCorrer(t: Trabajo, h: Herramientas): Promise<Salida> {
  await h.etapa("Esperando la GPU", 0.01);
  let ultima = "";
  const c = await correrWorkflow(
    { ...h, avanzar: (a) => { if (a.etapa !== ultima) void h.etapa((ultima = a.etapa), a.avance); } },
    String(t.payload.corrida ?? ""),
    PedidoWorkflow.parse(t.payload.pedido),
  );
  h.log(`Workflow listo en ${c.segundos} s: ${c.salidas.map((s) => s.archivo).join(", ")}`);
  return { resultado: { corrida: c.id, salidas: c.salidas.length } };
}

async function renderEntregarEj(t: Trabajo, h: Herramientas): Promise<Salida> {
  const version = typeof t.payload.version === "number" ? t.payload.version : undefined;
  const r = await renderEntregar(h, t.proyectoId!, t.id, version);
  if (!r.aprobado) h.log("El render no pasó el QC: revisa el informe en el proyecto.");
  return { resultado: r };
}

async function publicarSubirEj(t: Trabajo, h: Herramientas): Promise<Salida> {
  const resultado = await publicarSubir(t.id, t.payload, {
    log: h.log,
    etapa: h.etapa,
    signal: h.signal,
    guardar: async (payload) => {
      t.payload = payload;
      await guardarPayload(t.id, payload);
    },
  });
  return { resultado };
}

export const EJECUTORES: Record<TipoTrabajo, (t: Trabajo, h: Herramientas) => Promise<Salida>> = {
  "mpt.generar": mptGenerar,
  "proyecto.importar": proyectoImportar,
  "clip.momentos": clipMomentos,
  "clip.importar": clipImportar,
  "visual.reencuadrar": visualReencuadrar,
  "plano.generar": planoGenerar,
  "avatar.proponer": avatarProponer,
  "avatar.retocar": avatarRetocar,
  "presentador.generar": presentadorGenerar,
  "avatar.actuar": avatarActuar,
  "avatar.streamer": avatarStreamer,
  "avatar.escenas": avatarEscenas,
  "escenas.animar": escenasAnimar,
  "escena.rehacer": escenaRehacer,
  "workflow.correr": workflowCorrer,
  "demo.crear": demoCrear,
  "voz.regenerar": vozRegenerar,
  "proyecto.traducir": proyectoTraducir,
  "voz.disenar": vozDisenar,
  "efecto.generar": efectoGenerar,
  "render.entregar": renderEntregarEj,
  "publicar.subir": publicarSubirEj,
};

export async function rutaLog(t: Trabajo): Promise<{ abs: string; rel: string }> {
  if (t.proyectoId) {
    const p = await db.proyecto.findUniqueOrThrow({ where: { id: t.proyectoId } });
    const dir = path.join(dirProyecto(p.slug), "logs");
    await fs.mkdir(dir, { recursive: true });
    return { abs: path.join(dir, `${t.id}.log`), rel: path.join(p.slug, "logs", `${t.id}.log`) };
  }
  const dir = path.join(dirProyecto("sistema"), "logs");
  await fs.mkdir(dir, { recursive: true });
  return { abs: path.join(dir, `${t.id}.log`), rel: path.join("sistema", "logs", `${t.id}.log`) };
}
