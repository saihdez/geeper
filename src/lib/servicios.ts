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
export async function crearProyecto(n: NuevoProyecto) {
  const p = await crearFila(n);
  const base = n.avatar ? CADENA_CON_AVATAR : CADENA_FABRICA;
  // Con un estilo, las escenas pasan a video antes del render (después del avatar): con Wan o, si el estilo no
  // anima («Rápido»), con la cámara 3D de Blender (animar-escenas.ts).
  const setupElegido = n.estilo ? (n.setup ?? ESTILOS_GENERACION[n.estilo].setup) : null;
  const anima = !!setupElegido && (necesitaPasoAnimar(setupElegido) || setupElegido.modelo === "zoom");
  const cadena: TipoTrabajo[] = anima ? [...base.slice(0, -1), "escenas.animar", base[base.length - 1]!] : base;
  if (n.avatar) await guardarAvatarDelVideo(p.slug, { avatar: n.avatar, cuerpo: n.cuerpo ?? "medio" });
  if (anima) await guardarEstiloGeneracion(p.slug, n.estilo!, n.setup);
  await encolar(p.id, "mpt.generar", n.guion?.trim() ? { cadena, guion: n.guion.trim() } : { cadena });
  return p;
}

/** Un tema por línea. Cada tema es un proyecto con su cadena; los terminados no se repiten. */
export async function crearLote(temas: string[], formato: Formato, plantilla: string, nombre?: string, avatar?: string, estilo?: EstiloGeneracion, cuerpo?: CuerpoAvatar, setup?: SetupVideo) {
  const limpios = temas.map((t) => t.trim()).filter(Boolean);
  if (!limpios.length) throw new Error("El lote no tiene temas");
  const lote = await db.lote.create({
    data: { nombre: nombre ?? `Lote de ${limpios.length} temas`, formato, plantilla, temas: limpios },
  });
  const proyectos = [];
  for (const [i, tema] of limpios.entries()) proyectos.push(await crearProyecto({ tema, formato, plantilla, loteId: lote.id, orden: i, avatar, estilo, cuerpo, setup }));
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
  campania?: Record<string, unknown>;
  /** false: sólo importar (para revisar antes de renderizar). */
  renderizar?: boolean;
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
