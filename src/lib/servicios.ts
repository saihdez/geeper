/** Operaciones de alto nivel que usan la web y los scripts. */
import { randomBytes } from "node:crypto";
import { guardarAvatarDelVideo, type CuerpoAvatar } from "./actuar";
import { guardarEstiloGeneracion } from "./animar-escenas";
import { ESTILOS_GENERACION, type EstiloGeneracion } from "./estilos-generacion";
import { necesitaPasoAnimar, type SetupVideo } from "./setup-video";
import { crearCarpetas } from "./almacen";
import { encolar, type TipoTrabajo } from "./cola";
import { db } from "./db";
import type { Formato } from "./esquema";
import { apiViva } from "./mpt";
import { guardarPedido } from "./pedido-video";
import type { FilaVideo } from "./tabla-videos";

/** Lo que ve la persona si el generador de videos (MPT, en Docker) está apagado (UX-07). */
export const GENERADOR_APAGADO = "El generador de videos está apagado. Abre Docker Desktop, espera un minuto y vuelve a intentar.";

/** Antes de crear nada: con el generador apagado cada tema dejaría un proyecto fallido (UX-07). */
export async function exigirGenerador(): Promise<void> {
  if (!(await apiViva())) throw new Error(GENERADOR_APAGADO);
}

export function slugDe(texto: string): string {
  const base = texto
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `${base || "proyecto"}-${randomBytes(3).toString("hex")}`;
}

export interface NuevoProyecto {
  tema: string;
  nombre?: string;
  formato: Formato;
  plantilla: string;
  loteId?: string;
  orden?: number;
  /** Guion exacto (lo que se dice). Si falta, MPT escribe uno a partir del tema. */
  guion?: string;
  /** Avatar de la biblioteca: Geeper lo pone en las escenas que más ganan con él (actuar.ts). */
  avatar?: string;
  /** De la cintura para arriba o de cuerpo entero (actuar.ts). */
  cuerpo?: CuerpoAvatar;
  /** Cuánto se trabaja cada escena (estilos-generacion.ts); sin él, «Rápido». */
  estilo?: EstiloGeneracion;
  /** El setup del preset, personalizado en «Nuevo» (setup-video.ts); sin él, el del preset. */
  setup?: SetupVideo;
  /** Frase del final de este video, en vez de la del estilo (p. ej. de una fila de la tabla). */
  cta?: string;
}

async function crearFila(n: NuevoProyecto) {
  const plantilla = await db.plantilla.findUnique({ where: { slug: n.plantilla } });
  if (!plantilla) throw new Error(`No existe la plantilla «${n.plantilla}»`);
  const slug = slugDe(n.nombre ?? n.tema);
  await crearCarpetas(slug);
  return db.proyecto.create({
    data: {
      slug,
      nombre: (n.nombre ?? n.tema).slice(0, 120),
      tema: n.tema,
      formato: n.formato,
      plantilla: n.plantilla,
      loteId: n.loteId,
      orden: n.orden ?? 0,
      estado: "generando",
    },
  });
}

const CADENA_FABRICA: TipoTrabajo[] = ["proyecto.importar", "render.entregar"];
/** Con avatar: después de importar, el avatar entra en las escenas propuestas y recién ahí se renderiza. */
const CADENA_CON_AVATAR: TipoTrabajo[] = ["proyecto.importar", "avatar.escenas", "render.entregar"];

/** Fábrica: MPT genera → se importa a geeper.json → render con la plantilla → QC. */
export async function crearProyecto(n: NuevoProyecto, op: { yaComprobado?: boolean } = {}) {
  if (!op.yaComprobado) await exigirGenerador();
  const p = await crearFila(n);
  const base = n.avatar ? CADENA_CON_AVATAR : CADENA_FABRICA;
  // Con un estilo, las escenas pasan a video antes del render (después del avatar): con Wan o, si el estilo no
  // anima («Rápido»), con la cámara 3D de Blender (animar-escenas.ts).
  const setupElegido = n.estilo ? (n.setup ?? ESTILOS_GENERACION[n.estilo].setup) : null;
  const anima = !!setupElegido && (necesitaPasoAnimar(setupElegido) || setupElegido.modelo === "zoom");
  const cadena: TipoTrabajo[] = anima ? [...base.slice(0, -1), "escenas.animar", base[base.length - 1]!] : base;
  if (n.avatar) await guardarAvatarDelVideo(p.slug, { avatar: n.avatar, cuerpo: n.cuerpo ?? "medio" });
  if (anima) await guardarEstiloGeneracion(p.slug, n.estilo!, n.setup);
  if (n.cta?.trim()) await guardarPedido(p.slug, { cta: n.cta.trim() });
  await encolar(p.id, "mpt.generar", n.guion?.trim() ? { cadena, guion: n.guion.trim() } : { cadena });
  return p;
}

/**
 * Un tema por línea, o una fila de tabla por video (tema y, si se quiere, título, guion y frase final:
 * tabla-videos.ts). Cada uno es un proyecto con su cadena; los terminados no se repiten.
 */
export async function crearLote(temas: (string | FilaVideo)[], formato: Formato, plantilla: string, nombre?: string, avatar?: string, estilo?: EstiloGeneracion, cuerpo?: CuerpoAvatar, setup?: SetupVideo) {
  const filas = temas.map((t): FilaVideo => (typeof t === "string" ? { tema: t.trim() } : { ...t, tema: t.tema.trim() })).filter((f) => f.tema);
  const limpios = filas.map((f) => f.tema);
  if (!limpios.length) throw new Error("El lote no tiene temas");
  await exigirGenerador();
  const lote = await db.lote.create({
    data: { nombre: nombre ?? `Lote de ${limpios.length} temas`, formato, plantilla, temas: limpios },
  });
  const proyectos = [];
  for (const [i, f] of filas.entries()) {
    proyectos.push(await crearProyecto({ tema: f.tema, nombre: f.titulo, guion: f.guion, cta: f.cta, formato, plantilla, loteId: lote.id, orden: i, avatar, estilo, cuerpo, setup }, { yaComprobado: true }));
  }
  return { lote, proyectos };
}

/** Trae un short que MPT ya generó (sin usar la GPU): importar → render → QC. */
/**
 * Trae un short que MPT ya generó (sin usar la GPU): importar → render → QC. Con `rehacerVoz`, la voz
 * se vuelve a sintetizar con la de la plantilla (Kokoro de MPT, en CPU) antes del render: sirve para
 * shorts viejos hechos a velocidad 1, que no pasan la regla de ≤ 17 car./s.
 */
export async function importarTareaMpt(taskId: string, n: NuevoProyecto, rehacerVoz = false) {
  if (!/^[0-9a-f-]{36}$/.test(taskId)) throw new Error("task_id de MPT inválido");
  const p = await crearFila(n);
  await db.proyecto.update({ where: { id: p.id }, data: { estado: "ensamblado" } });
  const cadena: TipoTrabajo[] = rehacerVoz ? ["voz.regenerar", "render.entregar"] : ["render.entregar"];
  await encolar(p.id, "proyecto.importar", { taskId, cadena });
  return p;
}

export interface NuevoClip {
  fuenteId: string;
  inicio: number;
  fin: number;
  encuadre: "cubrir" | "contener" | "react" | "cara";
  idioma: string;
  formato: Formato;
  plantilla: string;
  nombre?: string;
  titulo?: string;
  gancho?: string;
  permiso?: string;
  /** Nombres propios para guiar a whisper («GTA VI, Lucia, Vice City»). */
  glosario?: string;
  campania?: Record<string, unknown>;
  /** false: sólo importar (para revisar antes de renderizar). */
  renderizar?: boolean;
  /** «Mejorar la voz» (quita ruido y empareja el volumen). Por defecto, sí. */
  mejorarVoz?: boolean;
}

export interface NuevaDemo {
  url: string;
  formato: "9:16" | "16:9";
  estilo: "3d" | "plano";
  texto: string;
  plantilla: string;
  nombre?: string;
  /** El sitio es de quien crea el proyecto (o tiene permiso). */
  propio?: boolean;
  /** Grabación de pantalla ya subida a `_subidos/` (ruta absoluta): con ella el link es opcional. */
  grabacion?: string;
}

/** Demo de una página web: voz → demo a su medida → proyecto → render y QC. */
export async function crearDemo(d: NuevaDemo) {
  let host: string | null = null;
  try {
    const u = new URL(d.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    host = u.host.replace(/^www\./, "");
  } catch {
    if (!d.grabacion) throw new Error("El link no es válido: cópialo completo desde tu navegador (empieza con https://).");
  }
  const tema = host ? `Demo de ${host}` : "Demo de tu grabación";
  const p = await crearFila({ tema, nombre: d.nombre?.trim() || tema, formato: d.formato, plantilla: d.plantilla });
  await encolar(p.id, "demo.crear", {
    url: host ? d.url : "",
    estilo: d.estilo,
    texto: d.texto,
    propio: d.propio === true,
    ...(d.grabacion ? { grabacion: d.grabacion } : {}),
    cadena: ["render.entregar"],
  });
  return p;
}

/** Clip de material largo (VOD, directo ya publicado, grabación): importar → render → QC. */
export async function crearClip(c: NuevoClip, tituloFuente: string) {
  if (!/^[a-f0-9]{12}$/.test(c.fuenteId)) throw new Error("Fuente inválida");
  if (!(c.fin > c.inicio)) throw new Error("El tramo está vacío");
  const tema = `Clip de «${tituloFuente}» (${Math.floor(c.inicio)}–${Math.ceil(c.fin)} s)`;
  const p = await crearFila({ tema, nombre: c.nombre ?? c.titulo ?? c.gancho ?? tema, formato: c.formato, plantilla: c.plantilla });
  const { renderizar = true, formato: _f, plantilla: _p, nombre: _n, ...payload } = c;
  await encolar(p.id, "clip.importar", { ...payload, cadena: renderizar ? ["render.entregar"] : [] });
  return p;
}
