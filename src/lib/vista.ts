/** Datos que la UI muestra de un proyecto (derivados de geeper.json + la base). */
import { descripcionClip, origenClip } from "./clips";
import { db } from "./db";
import { resumirConfianza, UMBRAL_DUDOSA } from "./confianza";
import { pistasLibres, validarProyecto, type Proyecto } from "./esquema";
import { encuadreDe, faltaAuto } from "./caras";
import { caracteresPorLinea, metricas } from "./formatos";
import { dirProyecto } from "./rutas";
import { duracionEscenas, escenasEnLinea, gruposDeEscena, opcionesDe, todosLosGrupos } from "./linea";
import { obtenerPlantilla } from "./plantillas";
import { cpsDeGrupos, escenasConSubtitulosRapidos, OBJETIVO } from "./qc";
import { lineas } from "./subtitulos";
import { KOKORO, listarGuardadas } from "./voces";

/** UX-12: la voz con que se generó un audio, sin el prefijo del motor («kokoro:ef_dora» = «ef_dora»). */
export function idDeVoz(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/^kokoro:/, "") : null;
}

/** Nombre para la persona: el de Kokoro, el de una voz diseñada, o null si no se conoce. */
export function nombreDeVoz(id: string, guardadas: { id: string; nombre: string }[] = []): string | null {
  for (const vs of Object.values(KOKORO)) {
    const k = vs.find((x) => x.voz === id);
    if (k) return k.nombre;
  }
  return guardadas.find((g) => g.id === id)?.nombre ?? null;
}

/**
 * Topes de lo que viaja en cada sondeo de la vista (SRV-05): las listas crecen con el uso y la vista se
 * pide cada pocos segundos. La UI muestra el historial más reciente; lo viejo sigue en la base.
 */
export const TOPES_VISTA = { versiones: 200, renders: 30, publicaciones: 50 } as const;

export async function vistaProyecto(id: string) {
  const fila = await db.proyecto.findUnique({
    where: { id },
    include: {
      versiones: { orderBy: { numero: "desc" }, take: TOPES_VISTA.versiones, select: { numero: true, nota: true, creado: true, hash: true } },
      renders: { orderBy: { creado: "desc" }, take: TOPES_VISTA.renders },
      // Sin payload (la sesión de subida de una publicación no debe salir), resultado ni log.
      trabajos: { orderBy: { creado: "desc" }, take: 30, select: { id: true, tipo: true, estado: true, etapa: true, progreso: true, error: true, creado: true, iniciado: true, terminado: true } },
      lote: { select: { id: true, nombre: true } },
      publicaciones: {
        orderBy: { creado: "desc" },
        take: TOPES_VISTA.publicaciones,
        include: { cuenta: { select: { id: true, red: true, usuario: true, alias: true } } },
      },
    },
  });
  if (!fila) return null;
  let p: Proyecto | null = null;
  if (fila.versionActual > 0) {
    const v = await db.version.findUniqueOrThrow({ where: { proyectoId_numero: { proyectoId: id, numero: fila.versionActual } } });
    p = validarProyecto(JSON.parse(v.json));
  }
  let escenas: unknown[] = [];
  let total = 0;
  /** REN-04: escenas con subtítulos de más de 17 car./s, sabido antes de renderizar. */
  let subtitulosRapidos: { limite: number; bloquea: boolean; escenas: { id: string; indice: number; cps: number }[] } | null = null;
  if (p) {
    const proyecto = p;
    const plantilla = await obtenerPlantilla(proyecto.plantilla).catch(() => null);
    const cpl = caracteresPorLinea(proyecto.formato, opcionesDe(proyecto));
    const { W, H } = metricas(proyecto.formato, opcionesDe(proyecto));
    const es = escenasEnLinea(proyecto);
    const todos = todosLosGrupos(proyecto);
    const finSubs = duracionEscenas(proyecto);
    total = finSubs + (plantilla?.datos.tarjetaFinal.duracion ?? 0);
    // Mismas funciones puras que la regla «subtitulos» del QC (finSubs = inicio de la tarjeta final).
    const ritmo = cpsDeGrupos(todos, finSubs);
    const cpsDe = new Map(todos.map((g, i) => [g, ritmo[i]!]));
    const rapidas = escenasConSubtitulosRapidos(todos, finSubs);
    subtitulosRapidos = {
      limite: OBJETIVO.maxCps,
      // En clips de material ajeno el ritmo sólo avisa (la voz original no se puede frenar).
      bloquea: origenClip(proyecto) === null,
      escenas: rapidas.map((r) => ({ id: r.escena, indice: es.find((e) => e.escena.id === r.escena)?.indice ?? -1, cps: r.cps })),
    };
    escenas = es.map((e) => {
      const a = proyecto.assets[e.visual.asset]!;
      const vozA = proyecto.assets[e.voz.asset]!;
      const v = e.visual;
      return {
        id: e.escena.id,
        indice: e.indice,
        inicio: e.inicio,
        duracion: e.duracion,
        /** Duración sin los recortes de la edición por texto. */
        duracionOriginal: e.voz.rango.duracion,
        texto: e.escena.texto,
        palabras: e.escena.palabras.map((w) => w.texto),
        // Para la edición por texto: cada palabra con su confianza y si está recortada (y por qué).
        detalle: e.escena.palabras.map((w) => {
          const medio = (w.inicio + w.fin) / 2;
          const r = e.escena.recortes.find((x) => medio >= x.inicio && medio <= x.fin);
          return { texto: w.texto, inicio: w.inicio, fin: w.fin, confianza: w.confianza ?? null, dudosa: w.confianza !== undefined && w.confianza < UMBRAL_DUDOSA, recorte: r?.motivo ?? null };
        }),
        recortes: e.escena.recortes,
        correcciones: e.escena.correcciones,
        efectos: { transicion: v.transicion ?? null, movimiento: v.movimiento ?? null, velocidad: v.velocidad ?? 1, color: v.color ?? null, efectos: v.efectos ?? null },
        visual: { asset: a.id, ruta: a.ruta, source: a.source, licencia: a.licencia, tipo: a.tipo, inicio: e.visual.rango.inicio, ajuste: e.visual.ajuste ?? "auto", ancla: e.visual.ancla ?? "centro", prompt: a.regenerar.prompt ?? null, encuadre: encuadreDe(e.visual, a, W, H), aspecto: a.ancho && a.alto ? a.ancho / a.alto : null },
        // UX-12: con qué voz suena hoy la escena (null en clips o audios propios), para avisar de mezclas.
        voz: { asset: vozA.id, source: vozA.source, ruta: vozA.ruta, inicio: e.voz.rango.inicio, voz: vozA.source === "archivo" ? null : idDeVoz(vozA.regenerar.voz) },
        grupos: gruposDeEscena(proyecto, e, todos).map((g) => {
          // Si el grupo cruza al corte siguiente, aquí se edita la parte de esta escena.
          const propias = g.fichas.filter((f) => f.escena === e.escena.id);
          const desde = Math.min(...propias.map((f) => f.origen[0]));
          const hasta = Math.max(...propias.map((f) => f.origen[1]));
          return {
            texto: g.texto,
            inicio: g.inicio,
            fin: g.fin,
            desde,
            hasta,
            oido: e.escena.palabras.slice(desde, hasta).map((w) => w.texto).join(" "),
            lineas: lineas(g.texto, cpl).length,
            cruza: propias.length < g.fichas.length,
            mostradoPropio: propias.map((f) => f.texto).join(" "),
            cps: Number((cpsDe.get(g) ?? 0).toFixed(1)),
          };
        }),
      };
    });
  }
  const extras = p
    ? {
        estilo: { efectos: p.estilo?.efectos ?? null, transicion: p.estilo?.transicion ?? null, curva: p.estilo?.curva ?? null },
        destino: { comercial: p.comercial, plataformas: p.plataformas, master: p.entrega.master, marca: p.marca },
        textos: p.textos,
        libres: pistasLibres(p).map((pi) => ({
          id: pi.id,
          tipo: pi.tipo,
          clips: pi.clips.map((c) => ({
            id: c.id, asset: c.asset, ruta: p.assets[c.asset]?.ruta ?? "", inicio: c.inicio ?? 0, duracion: c.rango.duracion / (c.velocidad ?? 1),
            desde: c.rango.inicio, tipoAsset: p.assets[c.asset]?.tipo ?? "video",
            fusion: c.fusion ?? null, efectos: c.efectos ?? null, transicion: c.transicion ?? null, opacidad: c.opacidad ?? 1,
          })),
        })),
        musica: p.pistas.some((x) => x.id === "musica")
          ? { inicio: p.pistas.find((x) => x.id === "musica")!.clips[0]?.rango.inicio ?? 0, pulsos: p.marcadores.filter((m) => m.tipo === "pulso").length }
          : null,
        confianza: resumirConfianza(Object.values(p.escenas).map((e) => ({ id: e.id, palabras: e.palabras }))),
        clip: (() => {
          const o = origenClip(p);
          return o ? { ...o, descripcion: descripcionClip(o) } : null;
        })(),
      }
    : null;
  // UX-12: nombres de la voz elegida y de las que suenan (las diseñadas sólo se leen si hacen falta).
  const voces = p ? await (async () => {
    const elegida = idDeVoz(p.voz.voz);
    const ids = [...new Set([elegida, ...(escenas as { voz: { voz: string | null } }[]).map((e) => e.voz.voz)].filter((x): x is string => !!x))];
    let guardadas: { id: string; nombre: string }[] = [];
    if (ids.some((x) => !nombreDeVoz(x))) guardadas = await listarGuardadas().catch(() => []);
    return { elegida, nombres: Object.fromEntries(ids.map((x) => [x, nombreDeVoz(x, guardadas) ?? x])) as Record<string, string> };
  })() : null;
  // Proyectos importados antes del reencuadre por cara: la UI pide analizarlos una vez al abrir.
  const carasPendientes = p ? await faltaAuto(dirProyecto(fila.slug)) : false;
  // La vista viaja cada pocos segundos: el informe de QC sólo del último render (el que se muestra) y
  // del proyecto sólo lo liviano; lo pesado (assets, pistas, escenas) ya va digerido en `escenas`/`extras`.
  const renders = fila.renders.map((r, i) => (i === 0 ? r : { ...r, informeQc: null }));
  return { fila: { ...fila, renders }, p: p ? proyectoLiviano(p) : null, escenas, total, extras, carasPendientes, subtitulosRapidos, voces };
}

/** El proyecto sin lo pesado (assets, pistas, escenas, marcadores ni el guion entero). */
export function proyectoLiviano(p: Proyecto) {
  const { assets: _a, pistas: _pi, escenas: _e, marcadores: _m, guion: _g, ...resto } = p;
  return resto;
}
