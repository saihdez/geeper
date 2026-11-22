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
import { lineas } from "./subtitulos";

export async function vistaProyecto(id: string) {
  const fila = await db.proyecto.findUnique({
    where: { id },
    include: {
      versiones: { orderBy: { numero: "desc" }, select: { numero: true, nota: true, creado: true, hash: true } },
      renders: { orderBy: { creado: "desc" } },
      // Sin payload (la sesión de subida de una publicación no debe salir), resultado ni log.
      trabajos: { orderBy: { creado: "desc" }, take: 30, select: { id: true, tipo: true, estado: true, etapa: true, progreso: true, error: true, creado: true, iniciado: true, terminado: true } },
      lote: { select: { id: true, nombre: true } },
      publicaciones: {
        orderBy: { creado: "desc" },
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
  if (p) {
    const proyecto = p;
    const plantilla = await obtenerPlantilla(proyecto.plantilla).catch(() => null);
    const cpl = caracteresPorLinea(proyecto.formato, opcionesDe(proyecto));
    const { W, H } = metricas(proyecto.formato, opcionesDe(proyecto));
    const es = escenasEnLinea(proyecto);
    const todos = todosLosGrupos(proyecto);
    total = duracionEscenas(proyecto) + (plantilla?.datos.tarjetaFinal.duracion ?? 0);
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
        voz: { asset: vozA.id, source: vozA.source, ruta: vozA.ruta, inicio: e.voz.rango.inicio },
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
  // Proyectos importados antes del reencuadre por cara: la UI pide analizarlos una vez al abrir.
  const carasPendientes = p ? await faltaAuto(dirProyecto(fila.slug)) : false;
  // La vista viaja cada pocos segundos: el informe de QC sólo del último render (el que se muestra) y
  // del proyecto sólo lo liviano; lo pesado (assets, pistas, escenas) ya va digerido en `escenas`/`extras`.
  const renders = fila.renders.map((r, i) => (i === 0 ? r : { ...r, informeQc: null }));
  return { fila: { ...fila, renders }, p: p ? proyectoLiviano(p) : null, escenas, total, extras, carasPendientes };
}

/** El proyecto sin lo pesado (assets, pistas, escenas, marcadores ni el guion entero). */
export function proyectoLiviano(p: Proyecto) {
  const { assets: _a, pistas: _pi, escenas: _e, marcadores: _m, guion: _g, ...resto } = p;
  return resto;
}
