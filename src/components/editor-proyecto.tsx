"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aviso, Barra, BotonReintentar, Estado, archivo, fecha, haceCuanto, numero, pedir, postJson, segundos, useSondeo } from "./comun";
import { ACCEPT_IMAGEN, esVector } from "@/lib/formatos-vector";
import { explicarError } from "@/lib/textos";
import { avisoSubtitulosRapidos, explicarRegla, LIMITES_SUBTITULOS, porQueFalla, resumirQc, type FraseQc, type SubtitulosRapidos } from "@/lib/qc-explicado";
import { VistaEnVivo, type IrA } from "./vista-en-vivo";
import { ListaTrabajos } from "./lista-trabajos";
import { ListaPublicaciones, PanelPublicar, type PublicacionV } from "./panel-publicar";
import { PanelAnimar, type OpcionesAnimar } from "./panel-animar";
import { PanelPortada } from "./panel-portada";
import { InformeTraduccion, PanelTraducir, type InformeTraduccionV } from "./panel-traducir";
import { ElegirVoz, type MotorVoz } from "./elegir-voz";
import { PanelEfectosSonido } from "./panel-efectos-sonido";
import { PanelCreditos } from "./panel-creditos";
import { PanelMusica } from "./panel-musica";
import { PanelPresentador } from "./panel-presentador";
import { PanelRehacer } from "./panel-rehacer";
import { PanelAvatarEscena, PanelAvatarVideo } from "./panel-avatar";
import { PanelEscena3d } from "./panel-escena3d";
import { PanelAsistente } from "./panel-asistente";
import { PanelCamara3d } from "./panel-camara3d";
import { SelectorEncuadre, type EncuadreV } from "./selector-encuadre";
import { PanelOtroEditor } from "./panel-otro-editor";
import { useAccionesProyecto } from "./acciones-proyecto";
import { FranjaAviso, type MensajeEditor } from "./franja-aviso";
import { AvisoRevisionVieja, NOTA_CONTINUACION, NOTA_EDITA_COMPLETO, NOTA_SUBTITULO_REPARTIDO, repartoDeGrupos } from "./aviso-revision-vieja";
import { avisoGuardado, escenaDeEdicion, PASOS_EDITOR, siguientePaso, falloReciente, textoFalloCreacion, renderFallido, avisoRitmo, correccionesVacias, enLista, mensajeSinCambios, opcionesRitmo, versionParaDeshacer, errorSubtitulo, escenasConOtraVoz, estaActivo, idsConOtraVoz, estadoCreacion, mismoContenido, pasoRender, preguntaVozEscena, renderEnCurso, verTrabajos, TEXTO_RITMO_GUARDADO, type TrabajoV, type VocesV } from "./editor-estado";
import { Plegable } from "./plegable";
import { avisoMezclaVoces } from "@/lib/ediciones";
import { FORMAS, nombreForma } from "@/lib/glosario";
import { EdicionPorTexto, EfectosEscena, PanelAvanzado, PanelEstilo, type EfectosV, type EstiloV, type ExtrasV, type PalabraV } from "./edicion-avanzada";

/** Miniatura de una escena (la misma que su tarjeta). */
const miniatura = (slug: string, e: { visual: { ruta: string; inicio: number } }) =>
  `/api/miniatura?p=${slug}&ruta=${encodeURIComponent(e.visual.ruta)}&t=${(e.visual.inicio + 0.5).toFixed(1)}`;

interface Grupo {
  texto: string;
  inicio: number;
  fin: number;
  desde: number;
  hasta: number;
  oido: string;
  lineas: number;
  cruza: boolean;
  mostradoPropio: string;
  /** Letras por segundo con que pasa (la misma cuenta que la regla del QC). */
  cps: number;
}
interface EscenaV {
  id: string;
  indice: number;
  inicio: number;
  duracion: number;
  duracionOriginal: number;
  texto: string;
  detalle: PalabraV[];
  efectos: EfectosV;
  correcciones: { desde: number; hasta: number; texto: string }[];
  visual: { asset: string; ruta: string; source: string; licencia: string; tipo: string; inicio: number; ajuste: string; ancla: string; prompt: unknown; encuadre: EncuadreV };
  voz: { asset: string; source: string; ruta: string; voz?: string | null };
  grupos: Grupo[];
}
interface Regla { id: string; nombre: string; ok: boolean; aviso?: boolean; medido: unknown; objetivo: string; detalle?: string }
interface Render {
  id: string;
  versionNumero: number;
  perfil: string;
  ruta: string;
  estado: string;
  duracion: number | null;
  segundos: number | null;
  creado: string;
  /** UX-28: si existe su .srt (sólo se sabe del último render). */
  srt?: boolean;
  informeQc: { aprobado: boolean; reglas: Regla[]; hojaContacto?: string; fotogramas: { t: number; ruta: string; nota: string }[]; master?: string } | null;
}
interface Vista {
  fila: {
    id: string; slug: string; nombre: string; tema: string; formato: string; plantilla: string; estado: string; versionActual: number;
    versiones: { numero: number; nota: string; creado: string; hash?: string | null }[];
    renders: Render[];
    trabajos: TrabajoV[];
    lote: { nombre: string } | null;
    publicaciones: PublicacionV[];
  };
  p: { voz: { motor: string; voz: string; velocidad: number; idioma: string }; origen?: { traduccion?: InformeTraduccionV }; mostrar: { de: string; a: string }[]; formato: string; plantilla: string } | null;
  escenas: EscenaV[];
  total: number;
  extras: ExtrasV | null;
  /** Importado antes del reencuadre por cara: se analiza una vez al abrirlo. */
  carasPendientes: boolean;
  /** REN-04: escenas con subtítulos rápidos, sabido antes de renderizar. */
  subtitulosRapidos: SubtitulosRapidos | null;
  /** UX-12: la voz elegida y los nombres de las que suenan. */
  voces?: VocesV | null;
}

/** UX-26: lo que se pregunta tras elegir una voz (todavía no suena en el video). */
export const preguntaUsarVoz = (nombre: string) =>
  `Elegiste «${nombre}». ¿La ponemos ya en el video? Se vuelve a decir todo el guion (unos 2 minutos) y se acomodan los subtítulos.`;

/** Mensaje de una subida: el de éxito más lo que VectorCraft avisó al convertir (p. ej. una fuente que faltaba). */
const conAvisos = (r: { avisos?: string[] }, ok: string) => (r.avisos?.length ? `${ok} Ojo: ${r.avisos.join(" · ")}` : ok);

/** A11-07: enlace para saltar, oculto hasta que llega el foco del teclado. */
const SALTO = "sr-only focus:not-sr-only focus:rounded focus:bg-panel focus:px-3 focus:py-2 focus:text-sm";

const t2 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function medido(v: unknown): string {
  if (typeof v === "number") return numero(v, 2);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `${v.length} elementos`;
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x !== "object").map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  return String(v);
}

/** Imágenes borrosas que la regla de nitidez propone vectorizar (ver `reglaAmpliacion`). */
function vectorizables(g: Regla): { asset: string; donde: string }[] {
  const m = g.medido as { vectorizables?: { asset: string; donde: string }[] } | null;
  return g.id === "ampliacion" && !g.ok && Array.isArray(m?.vectorizables) ? m.vectorizables : [];
}

interface Vectorizar {
  hacer: (asset: string, donde: string) => void;
  /** La imagen sigue en el proyecto (el QC es del último render; puede haberse cambiado ya). */
  sigue: (asset: string) => boolean;
  ocupado: boolean;
}

type EscenaFrases = { id: string; indice: number; grupos: { texto: string; inicio?: number; fin?: number }[] };

/**
 * Escena donde está hoy una frase que marcó el QC (el informe puede ser de una versión anterior). Se busca
 * por texto; si la frase se repite en varias escenas, gana la que la tiene más cerca del segundo `t` del informe.
 */
export function escenaDeFrase(f: Pick<FraseQc, "texto"> & { t?: number }, escenas: EscenaFrases[]) {
  const lejos = (g: EscenaFrases["grupos"][number]) => {
    if (f.t === undefined || g.inicio === undefined) return 0;
    const fin = g.fin ?? g.inicio;
    return f.t < g.inicio ? g.inicio - f.t : f.t > fin ? f.t - fin : 0;
  };
  let mejor: { e: EscenaFrases; d: number } | null = null;
  for (const e of escenas) {
    for (const g of e.grupos) {
      if (g.texto !== f.texto) continue;
      const d = lejos(g);
      if (!mejor || d < mejor.d) mejor = { e, d };
    }
  }
  return mejor?.e ?? null;
}

export function InformeQc({ r, slug, vectorizar, escenas = [] }: { r: Render; slug: string; vectorizar?: Vectorizar; escenas?: EscenaFrases[] }) {
  const inf = r.informeQc;
  if (!inf) return null;
  const res = resumirQc(inf.reglas);
  const color = res.estado === "listo" ? "text-emerald-300" : res.estado === "con-avisos" ? "text-amber-200" : "text-red-300";
  return (
    <div className="space-y-3">
      <p className={`text-base font-medium ${color}`}>{res.estado === "listo" ? "✓ " : res.estado === "con-avisos" ? "! " : "✗ "}{res.titulo}</p>
      {[...res.bloquean.map((x) => ({ ...x, bloquea: true })), ...res.avisos.map((x) => ({ ...x, bloquea: false }))].map((x) => {
        const e = explicarRegla(x);
        return (
          <div key={x.id} className={`rounded-lg border p-3 text-sm ${x.bloquea ? "border-red-900 bg-red-950/30" : "border-amber-900 bg-amber-950/20"}`}>
            <p className="font-medium">{x.bloquea ? "Hay que arreglarlo: " : "Para mirar: "}{e.que}</p>
            <p className="mt-1 text-tenue">Qué hacer: {e.hacer}</p>
            {e.frases.length > 0 && (
              <ul className="mt-2 space-y-1">
                {e.frases.map((f) => {
                  const esc = escenaDeFrase(f, escenas);
                  return (
                    <li key={`${f.t}-${f.texto}`}>
                      «{f.texto}» {porQueFalla(f)}.{" "}
                      {esc
                        ? <a className="text-acento underline" href={`#escena-${esc.id}`}>Ir a la escena {esc.indice + 1}</a>
                        : <span className="text-tenue">(ya cambió desde que se hizo este video)</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <details>
        <summary className="cursor-pointer text-xs text-tenue">Ver el detalle técnico (todas las revisiones)</summary>
      <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-0 table-fixed text-left text-xs">
        <thead className="text-tenue"><tr><th className="py-1 pr-2">Regla</th><th className="pr-2">Medido</th><th>Objetivo</th></tr></thead>
        <tbody>
          {inf.reglas.map((g) => (
            <tr key={g.id} className="border-t border-borde align-top">
              <td className="py-1 pr-2"><span aria-hidden>{g.ok ? "✓" : g.aviso ? "!" : "✗"}</span> <span className={g.ok ? "" : g.aviso ? "text-amber-300" : "text-red-300"}>{g.nombre}</span>
                {g.detalle && !g.ok && <pre className="mt-1 whitespace-pre-wrap text-[11px] text-tenue">{g.detalle}</pre>}
                {vectorizar && vectorizables(g).filter((x) => vectorizar.sigue(x.asset)).map((x) => (
                  <button key={x.asset} type="button" className="boton mt-1 mr-1 py-0.5 text-[11px]" disabled={vectorizar.ocupado}
                    title="Convierte la imagen en trazos nítidos con VectorCraft. Sirve para logos e íconos planos, no para fotos. Se deshace desde Historial."
                    onClick={() => vectorizar.hacer(x.asset, x.donde)}>
                    Vectorizar {x.donde.toLowerCase()} (si es un logo)
                  </button>
                ))}</td>
              <td className="pr-2 break-words">{medido(g.medido)}</td>
              <td className="break-all text-tenue">{g.objetivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      </details>
      {inf.hojaContacto && (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={archivo(`${slug}/${inf.hojaContacto}`)} alt="Hoja de contacto: fotogramas clave del video" className="w-full rounded border border-borde" />
          <figcaption className="mt-1 text-xs text-tenue">Hoja de contacto: {inf.fotogramas.map((f) => `${f.nota} (${numero(f.t, 1)} s)`).join(" · ")}</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * UX-12: en la revisión final, si el video suena con más de una voz se avisa (no bloquea: puede ser a
 * propósito). La cuenta es la de ediciones.ts, la misma que usa la vista.
 */
export function AvisoVocesMezcladas({ escenas, voces }: { escenas: { indice: number; voz: { voz?: string | null } }[]; voces: VocesV | null }) {
  const aviso = avisoMezclaVoces(escenas, voces);
  if (!aviso) return null;
  return (
    <div className="mb-3 rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-sm" role="note">
      <p className="font-medium">Para mirar: {aviso}</p>
      <p className="mt-1 text-tenue">Qué hacer: si no lo hiciste a propósito, en «3. Voz y estilo» pon la misma voz en todo el video.</p>
    </div>
  );
}

export function EditorGrupo({ g, onGuardar, onQuitar, corregido, repartido = false, completo, continuacion = false }: {
  g: Grupo; corregido: boolean;
  /** UX-16: el texto corregido quedó en dos subtítulos (éste es el primero). */
  repartido?: boolean;
  /** UX-16: el texto completo de la corrección repartida; la casilla edita ése, no sólo su parte. */
  completo?: string;
  /** UX-16: parte de una corrección repartida que se corrige en la casilla de arriba (sin casilla propia). */
  continuacion?: boolean;
  onGuardar: (texto: string) => Promise<boolean>; onQuitar: () => Promise<void>;
}) {
  // UX-02: lo escrito es un borrador sobre lo guardado; al guardar bien (o con Esc) el campo vuelve a
  // mostrar lo que quedó en la fila, así «Guardar» no queda pegado.
  const [borrador, setBorrador] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const base = completo ?? g.mostradoPropio;
  const texto = borrador ?? base;
  const cambiado = borrador !== null && borrador.trim() !== base;
  const error = cambiado ? errorSubtitulo(texto) : null;
  const guardar = async () => {
    if (!cambiado || error || guardando) return;
    setGuardando(true);
    try {
      if (await onGuardar(texto.trim())) setBorrador(null);
    } finally {
      setGuardando(false);
    }
  };
  const idError = `error-sub-${g.desde}-${g.hasta}`;
  if (continuacion) return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 font-mono text-xs text-tenue">{numero(g.inicio, 2)} s</span>
      <span className="min-w-0 flex-1 px-3 py-1">{g.mostradoPropio}</span>
      <span className="w-full pl-[4.5rem] text-xs text-tenue">{NOTA_CONTINUACION}</span>
    </li>
  );
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 font-mono text-xs text-tenue">{numero(g.inicio, 2)} s</span>
      <input aria-label={`Subtítulo en ${numero(g.inicio, 2)} s`} className="campo min-w-0 flex-1 py-1" value={texto}
        aria-invalid={error ? true : undefined} aria-describedby={error ? idError : undefined}
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void guardar(); }
          if (e.key === "Escape") setBorrador(null);
        }} />
      {cambiado && (
        <button type="button" className="boton boton-primario py-1" disabled={guardando || !!error} title="También con Enter; Esc lo deja como estaba"
          onClick={() => void guardar()}>{guardando ? "Guardando…" : "Guardar"}</button>
      )}
      {corregido && !cambiado && <button type="button" className="boton py-1" onClick={() => void onQuitar()} title={`Se oye: «${g.oido}»`}>Deshacer</button>}
      {g.cruza && <span className="text-xs text-tenue">sigue en la escena siguiente</span>}
      {error && <span id={idError} className="w-full pl-[4.5rem] text-xs text-red-300">{error}</span>}
      {!cambiado && g.cps > LIMITES_SUBTITULOS.maxCps && (
        <span className="w-full pl-[4.5rem] text-xs text-amber-200">Pasa muy rápido ({numero(g.cps, 1)} letras por segundo): acórtalo un poco para que dé tiempo a leerlo.</span>
      )}
      {repartido && !cambiado && <span className="w-full pl-[4.5rem] text-xs text-tenue">{NOTA_SUBTITULO_REPARTIDO}{completo !== undefined ? ` ${NOTA_EDITA_COMPLETO}` : ""}</span>}
      {g.oido !== base && <span className="w-full pl-[4.5rem] text-xs text-tenue">Se oye: «{g.oido}»</span>}
    </li>
  );
}

function TarjetaEscena({ e, anterior, slug, proyectoId, total, formato, estilo, editar, editarOk, subirClip, regenerarVoz, reencuadrar, animar, ocupado, vozReal, preguntaVoz }: {
  e: EscenaV; anterior?: EscenaV;
  /** UX-12: si regenerar sólo esta escena deja el video con dos voces, qué preguntar antes. */
  preguntaVoz: string | null; slug: string; proyectoId: string; total: number; ocupado: boolean; formato: string; estilo: EstiloV | null;
  /** Clip de material largo: la voz es la del creador (la revisión de dudosas corrige texto). */
  vozReal: boolean;
  editar: (ed: object) => Promise<void>;
  /** Como `editar`, pero dice si se guardó (el campo del subtítulo sólo se limpia si salió bien). */
  editarOk: (ed: object) => Promise<boolean>;
  subirClip: (escena: string, f: File) => Promise<void>;
  regenerarVoz: (escena: string | null) => Promise<void>;
  reencuadrar: (escena: string, layout: string) => Promise<void>;
  animar: (escena: string, opciones: OpcionesAnimar) => Promise<void>;
}) {
  const [preguntando, setPreguntando] = useState(false);
  const reparto = repartoDeGrupos(e.grupos, e.correcciones);
  return (
    <li id={`escena-${e.id}`} className="tarjeta flex scroll-mt-28 flex-col gap-3 p-3 md:flex-row">
      <div className="shrink-0">
        <SelectorEncuadre escena={e.id} numero={e.indice + 1} encuadre={e.visual.encuadre} ocupado={ocupado}
          src={`/api/miniatura?p=${slug}&ruta=${encodeURIComponent(e.visual.ruta)}&t=${(e.visual.inicio + 0.5).toFixed(1)}`}
          elegir={(ajuste, ancla) => void editar({ tipo: "ajusteVisual", escena: e.id, ajuste, ancla })} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Escena {e.indice + 1}</h3>
          <span className="font-mono text-xs text-tenue">{t2(e.inicio)} – {t2(e.inicio + e.duracion)} ({numero(e.duracion, 2)} s)</span>
          <span className="text-xs text-tenue">clip: {e.visual.source}{e.visual.source === "archivo" ? " (propio)" : ""} · voz: {e.voz.source}</span>
        </div>
        <EdicionPorTexto escena={e.id} audio={archivo(`${slug}/${e.voz.ruta}`)} palabras={e.detalle} duracion={e.duracion} duracionOriginal={e.duracionOriginal} editar={editar} ocupado={ocupado}
          vozReal={vozReal} correcciones={e.correcciones} />
        <ul className="space-y-1.5">
          {e.grupos.map((g, i) => (
            <EditorGrupo key={`${g.desde}-${g.hasta}-${g.mostradoPropio}`} g={g} repartido={reparto.get(i)?.primero ?? false}
              completo={reparto.get(i)?.completo} continuacion={reparto.get(i)?.primero === false}
              corregido={e.correcciones.some((c) => c.desde >= g.desde && c.hasta <= g.hasta)}
              onGuardar={(texto) => editarOk({ tipo: "corregirSubtitulo", escena: e.id, desde: g.desde, hasta: g.hasta, texto })}
              onQuitar={async () => { for (const c of e.correcciones.filter((c) => c.desde >= g.desde && c.hasta <= g.hasta)) await editar({ tipo: "quitarCorreccion", escena: e.id, desde: c.desde }); }} />
          ))}
        </ul>
        {correccionesVacias(e.detalle, e.correcciones).map((c) => (
          <p key={c.desde} className="flex flex-wrap items-center gap-2 text-xs text-amber-200">
            Se oye «{c.oido}» y no tiene subtítulo.
            <button type="button" className="boton py-0.5 text-xs" disabled={ocupado} onClick={() => void editar({ tipo: "quitarCorreccion", escena: e.id, desde: c.desde })}>Volver a mostrarlo</button>
          </p>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="boton" disabled={ocupado || e.indice === 0} onClick={() => void editar({ tipo: "moverEscena", escena: e.id, a: e.indice - 1 })} aria-label={`Subir escena ${e.indice + 1}`}>↑ Subir</button>
          <button type="button" className="boton" disabled={ocupado || e.indice === total - 1} onClick={() => void editar({ tipo: "moverEscena", escena: e.id, a: e.indice + 1 })} aria-label={`Bajar escena ${e.indice + 1}`}>↓ Bajar</button>
          <label className="boton cursor-pointer">
            Reemplazar clip…
            <input type="file" accept={`video/*,${ACCEPT_IMAGEN}`} className="sr-only" disabled={ocupado}
              onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void subirClip(e.id, f); ev.target.value = ""; }} />
          </label>
          {e.visual.tipo === "video" && (
            // A11-09: dos botones (antes, un menú que ya encolaba el trabajo al moverse con las flechas).
            <span role="group" aria-label="Pantalla dividida para clips de directos" className="flex flex-wrap gap-2">
              <button type="button" className="boton" disabled={ocupado} onClick={() => void reencuadrar(e.id, "react")}>Cara arriba y juego abajo</button>
              <button type="button" className="boton" disabled={ocupado} onClick={() => void reencuadrar(e.id, "cara")}>Cara a toda la altura</button>
            </span>
          )}
          {e.voz.source !== "archivo" && (
            <button type="button" className="boton" disabled={ocupado} onClick={() => { if (preguntaVoz) setPreguntando(true); else void regenerarVoz(e.id); }}>Regenerar voz de la escena</button>
          )}
          <button type="button" className="boton boton-peligro" disabled={ocupado || total <= 1}
            onClick={() => { if (confirm(`¿Quitar la escena ${e.indice + 1}? Se quita también lo que se oye en ella. Puedes volver atrás en el historial.`)) void editar({ tipo: "quitarEscena", escena: e.id }); }}>Quitar</button>
        </div>
        {preguntando && preguntaVoz && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm" role="group" aria-label="¿Cambiar la voz de todo el video?">
            <p>{preguntaVoz} ¿Cambias la voz de todo el video para que suene igual?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="boton boton-primario py-1" disabled={ocupado} onClick={() => { setPreguntando(false); void regenerarVoz(null); }}>Cambiar todas</button>
              <button type="button" className="boton py-1" disabled={ocupado} onClick={() => { setPreguntando(false); void regenerarVoz(e.id); }}>Sólo ésta</button>
              <button type="button" className="boton py-1" onClick={() => setPreguntando(false)}>Cancelar</button>
            </div>
          </div>
        )}
        <EfectosEscena escena={e.id} indice={e.indice} efectos={e.efectos} estilo={estilo} formato={formato}
          imgA={anterior ? miniatura(slug, anterior) : undefined} imgB={miniatura(slug, e)} editar={editar} ocupado={ocupado} />
        <PanelAnimar proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} animar={animar} />
        {(e.visual.tipo === "imagen" || e.visual.source === "mpt") && <PanelCamara3d proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} />}
        <PanelAvatarEscena proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} />
        <PanelEscena3d proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} formato={formato} duracion={e.duracion} />
        {e.visual.tipo === "video" && <PanelRehacer proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} miniatura={miniatura(slug, e)} />}
      </div>
    </li>
  );
}

export function EditorProyecto({ id }: { id: string }) {
  const { datos: v, error, recargar } = useSondeo<Vista>(`/api/proyectos/${id}`, 3000, [`proyecto:${id}`, `trabajos:${id}`]);
  const { datos: pl } = useSondeo<{ plantillas: { slug: string; nombre: string }[] }>("/api/plantillas", 60_000);
  const [msg, setMsg] = useState<MensajeEditor | null>(null);
  const cerrarMsg = useCallback(() => setMsg(null), []);
  const [ocupado, setOcupado] = useState(false);
  // Reencuadre por cara en proyectos viejos: se pide una sola vez al abrir; el aviso deja deshacerlo.
  const [caras, setCaras] = useState<{ fase: "buscando" } | { fase: "listo"; escenas: { id: string; numero: number }[] } | null>(null);
  const pedidoCaras = useRef(false);
  const pendientes = v?.carasPendientes ?? false;
  useEffect(() => {
    if (!pendientes || pedidoCaras.current) return;
    pedidoCaras.current = true;
    setCaras({ fase: "buscando" });
    postJson<{ escenas: { id: string; numero: number }[] }>(`/api/proyectos/${id}/caras`, { accion: "auto" })
      .then((r) => { setCaras(r.escenas.length ? { fase: "listo", escenas: r.escenas } : null); return recargar(); })
      .catch(() => setCaras(null)); // sin caras o sin OpenCV: el encuadre queda como estaba, sin molestar
  }, [pendientes, id, recargar]);
  const dejarComoEstaba = (escenas: string[]) => hacer(async () => {
    await postJson(`/api/proyectos/${id}/caras`, { accion: "deshacer", escenas });
    setCaras(null);
  }, "Listo: esas escenas quedaron encuadradas como antes. Puedes cambiar cada una en «¿Qué se ve?».");
  const [mostrarTxt, setMostrarTxt] = useState<string | null>(null);
  const [pestana, setPestana] = useState<"vivo" | "render" | null>(null);
  /** null: la persona no la tocó (se abre sola mientras hay algo en marcha). */
  const [trabajosAbiertos, setTrabajosAbiertos] = useState<boolean | null>(null);
  /** UX-08: el historial va plegado; el botón «Historial» de arriba lo abre. */
  const [historialAbierto, setHistorialAbierto] = useState(false);
  /** La vista más reciente, para lo que se pulsa desde un aviso armado antes (UX-19). */
  const vistaAlDia = useRef<Vista | null>(null);
  useEffect(() => { vistaAlDia.current = v ?? null; }, [v]);
  // UX-37: tras guardar un cambio de una escena, la vista en vivo salta a esa escena y la muestra 3 s.
  // El segundo se toma de la vista ya recargada (al mover una escena cambia dónde empieza).
  const [salto, setSalto] = useState<{ escena: string; vez: number } | null>(null);
  const inicioSalto = salto ? v?.escenas.find((e) => e.id === salto.escena)?.inicio : undefined;
  const irA = useMemo<IrA | undefined>(() => (salto && inicioSalto !== undefined ? { segundo: inicioSalto, vez: salto.vez } : undefined), [salto, inicioSalto]);

  /**
   * Si `fn` devuelve un texto, ése es el mensaje de éxito (p. ej. con avisos); si no, `ok`. Devuelve si
   * salió bien, para que quien llama no siga como si hubiera guardado (UX-02, UX-26).
   */
  async function intentar(fn: () => Promise<unknown>, ok: string | Omit<MensajeEditor, "tipo">): Promise<boolean> {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tipo: "ok", ...(typeof r === "string" ? { texto: r } : typeof ok === "string" ? { texto: ok } : ok) });
      await recargar();
      return true;
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setOcupado(false);
    }
  }
  const hacer = async (fn: () => Promise<unknown>, ok: string | Omit<MensajeEditor, "tipo">) => { await intentar(fn, ok); };
  // UX-19: el aviso sale abajo, junto a lo que se edita, con el paso siguiente al lado.
  // Se arma al guardar: si ya se está creando un video, no se ofrece pedir otro encima.
  const guardado = (): Omit<MensajeEditor, "tipo"> => {
    const a = avisoGuardado(v?.fila.trabajos ?? []);
    return a.ofrecerCrear ? { texto: a.texto, accion: { texto: "Crear el video", hacer: () => void renderizar() } } : { texto: a.texto };
  };
  /** Guarda una edición y dice si salió bien. */
  // UX-18: si nada cambió, se dice eso (sin «Guardado» ni «Crear el video»).
  const guardar = async (eds: object[]) => {
    const r = await postJson(`/api/proyectos/${id}/editar`, eds.length === 1 ? { edicion: eds[0] } : { ediciones: eds });
    const nada = mensajeSinCambios(eds as { tipo?: unknown }[], r);
    return nada ?? r; // un texto reemplaza al «Guardado» (y a su «Crear el video»)
  };
  const editarOk = async (ed: object, ok: string | Omit<MensajeEditor, "tipo"> = guardado()) => {
    const bien = await intentar(() => guardar([ed]), ok);
    const escena = escenaDeEdicion(ed);
    if (bien && escena) setSalto((s) => ({ escena, vez: (s?.vez ?? 0) + 1 }));
    return bien;
  };
  const editar = async (ed: object) => { await editarOk(ed); };
  const editarVarias = (eds: object[]) => hacer(() => guardar(eds), guardado());
  const subirClip = (escena: string, f: File) => hacer(async () => {
    const fd = new FormData();
    fd.set("escena", escena);
    fd.set("archivo", f);
    return conAvisos(await pedir(`/api/proyectos/${id}/clip`, { method: "POST", body: fd }), `Clip reemplazado por «${f.name}»${esVector(f.name) ? " (convertido a SVG)" : ""}.`);
  }, `Clip reemplazado por «${f.name}».`);
  const reencuadrar = (escena: string, layout: string) => hacer(() => postJson(`/api/proyectos/${id}/reencuadre`, { escena, layout }),
    "Reencuadre en cola (detección de cara en CPU). Al terminar queda como versión nueva; si no encuentra una cara estable, lo dice en Trabajos.");
  const animar = (escena: string, opciones: OpcionesAnimar) => hacer(() => postJson(`/api/proyectos/${id}/plano`, { escena, opciones }),
    "Animación en cola. Verás el avance en la escena y en «Trabajos»; al terminar queda como versión nueva (ya se ve en «En vivo»).");
  const regenerarVoz = (escena: string | null) => hacer(() => postJson(`/api/proyectos/${id}/voz`, { escena }),
    "Voz en cola. Con una voz diseñada espera su turno en la tarjeta de video. Al terminar se realinean los subtítulos y se vuelve a crear el video.");
  /** GPU-07: varias escenas en UN solo trabajo de voz y un solo video al final. */
  const rehacerVoces = (ids: string[], numeros: number[]) => hacer(() => postJson(`/api/proyectos/${id}/voz`, { escenas: ids }),
    `Voz en cola para ${numeros.length === 1 ? "la escena" : "las escenas"} ${enLista(numeros)}: se dicen todas juntas y al final se crea el video una sola vez.`);
  /** Cambia la voz del proyecto y ofrece ponerla ya en el video (regenerar el guion completo). */
  const usarVoz = async (motor: MotorVoz, voz: string, nombre: string) => {
    // UX-26: si no se pudo guardar la voz elegida, no se ofrece decir el guion (saldría con la anterior).
    if (!(await editarOk({ tipo: "cambiarVoz", motor, voz }))) return;
    if (confirm(preguntaUsarVoz(nombre))) await regenerarVoz(null);
  };
  const renderizar = async () => {
    // UX-19: el botón de la franja puede pulsarse después de que empezó otro render (la vista es la del aviso).
    if (renderEnCurso(vistaAlDia.current?.fila.trabajos ?? [])) {
      setMsg({ tipo: "ok", texto: "Ya se está creando el video. Arriba ves cómo va." });
      return;
    }
    // REN-04: si el QC lo va a rechazar por subtítulos rápidos, se pregunta antes de esperar el render.
    const aviso = avisoSubtitulosRapidos(v?.subtitulosRapidos);
    if (aviso?.confirmar && !confirm(aviso.confirmar)) return;
    await hacer(() => postJson(`/api/proyectos/${id}/render`, {}), "Quedó en cola: sólo arma el video, no usa la tarjeta de video.");
  };
  const alinearMusica = () => hacer(async () => {
    const r = await postJson<{ cambio: boolean; motivo?: string }>(`/api/proyectos/${id}/musica`, {});
    if (!r.cambio) throw new Error(r.motivo ?? "No se pudo alinear la música");
  }, "Música alineada: los pulsos quedan marcados y la revisión mide cuántos cortes caen en pulso.");
  const vectorizarImagen = (asset: string, donde: string) => hacer(async () =>
    conAvisos(await postJson(`/api/proyectos/${id}/vectorizar`, { asset }), `${donde}: vectorizada (SVG nítido). Vuelve a crear el video para verla en la revisión; si no te gusta, vuelve a la versión anterior en Historial.`),
  "Vectorizada.");
  const subirLibre = (f: File, pista: string, inicio: number, licencia: string) => hacer(async () => {
    const fd = new FormData();
    fd.set("pista", pista);
    fd.set("inicio", String(inicio));
    fd.set("licencia", licencia);
    fd.set("archivo", f);
    return conAvisos(await pedir(`/api/proyectos/${id}/clip`, { method: "POST", body: fd }), `«${f.name}» agregado en ${numero(inicio, 1)} s${esVector(f.name) ? " (convertido a SVG)" : ""}.`);
  }, `«${f.name}» agregado en ${numero(inicio, 1)} s.`);

  useAccionesProyecto(v?.p ? {
    id, slug: v.fila.slug, formato: v.p.formato, plantilla: v.p.plantilla, plantillas: pl?.plantillas ?? [],
    renderAprobado: v.fila.renders[0]?.estado === "aprobado" ? v.fila.renders[0].ruta : null,
    hayMusica: !!v.extras?.musica, dudosas: v.extras?.confianza.dudosas ?? 0,
    versionAnterior: versionParaDeshacer(v.fila.versiones, v.fila.versionActual)?.numero ?? null,
    ocupado, editar, renderizar, alinearMusica, regenerarVoz,
    volverA: (numero) => hacer(() => postJson(`/api/proyectos/${id}/version`, { numero }), `Volviste a la versión ${numero} (guardada como versión nueva).`),
  } : null);

  if (error && !v) return <Aviso tipo="error">{error}</Aviso>;
  if (!v) return <p className="text-tenue">Cargando…</p>;
  const { fila, p, escenas } = v;
  const render = fila.renders[0];
  // UX-21: «al día» por contenido (hash), no por número de versión.
  const alDia = (numero: number) => mismoContenido(fila.versiones, numero, fila.versionActual);
  const renderAlDia = !!render && alDia(render.versionNumero);
  // Por defecto: el render si está al día; si hay cambios sin renderizar, la vista en vivo.
  const modo = pestana ?? (renderAlDia ? "render" : "vivo");
  const activos = fila.trabajos.filter(estaActivo);
  const enCurso = renderEnCurso(fila.trabajos);
  const fallo = enCurso ? null : renderFallido(fila.trabajos, render);
  /** Otro trabajo en marcha que no es el render (ése ya tiene su franja). */
  const otroActivo = activos.find((t) => t !== enCurso) ?? null;
  const deshacer = versionParaDeshacer(fila.versiones, fila.versionActual);
  const notaActual = fila.versiones.find((x) => x.numero === fila.versionActual)?.nota ?? "el último cambio";
  const volverA = (numero: number, pregunta: string) => {
    if (confirm(pregunta)) void hacer(() => postJson(`/api/proyectos/${id}/version`, { numero }), `Volviste a la versión ${numero} (guardada como versión nueva).`);
  };
  const otraVoz = v.extras?.clip ? [] : escenasConOtraVoz(escenas, v.voces?.elegida ?? null);
  const qc = render?.informeQc ? resumirQc(render.informeQc.reglas) : null;
  const avisoRapidos = avisoSubtitulosRapidos(v.subtitulosRapidos);
  const textoMostrar = mostrarTxt ?? (p?.mostrar ?? []).map((m) => `${m.de}=${m.a}`).join("\n");
  const paso = siguientePaso({ creando: !!enCurso, fallo: !!fallo, hayVideo: !!render, alDia: renderAlDia, qc: qc?.estado ?? null, aprobado: render?.estado === "aprobado" });

  return (
    <div className={`space-y-6 ${msg ? "pb-24" : ""}`}>
      <FranjaAviso msg={msg} cerrar={cerrarMsg} />
      {/* A11-07: con teclado, saltar las decenas de controles de arriba. Se ven sólo al llegar con Tab. */}
      <nav aria-label="Saltar a" className="flex gap-2">
        {escenas.length > 0 && <a href="#escenas" className={SALTO}>Ir a las escenas</a>}
        <a href="#historial" className={SALTO} onClick={() => setHistorialAbierto(true)}>Ir al historial</a>
      </nav>
      <header id="arriba" className="flex scroll-mt-4 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{fila.nombre}</h1>
          <p className="text-sm text-tenue">{fila.tema !== fila.nombre ? `${fila.tema} · ` : ""}versión {fila.versionActual} · {escenas.length} escenas · {segundos(v.total)}{fila.lote ? ` · ${fila.lote.nombre}` : ""}</p>
          {v.extras?.clip && (
            <p className="text-xs text-tenue">
              Clip de <a className="hover:underline" href={v.extras.clip.url} target="_blank" rel="noreferrer">{v.extras.clip.titulo}</a>
              {v.extras.clip.canal ? ` (${v.extras.clip.canal})` : ""} · {Math.floor(v.extras.clip.inicio)}–{Math.ceil(v.extras.clip.fin)} s · encuadre {v.extras.clip.encuadre}
              {v.extras.clip.reencuadre ? ` · ${v.extras.clip.reencuadre}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* UX-38: deshacer a la vista, sin bajar al historial. Con un trabajo en marcha podría pisar su resultado. */}
          {deshacer && (
            <button type="button" className="boton" disabled={ocupado || activos.length > 0}
              title={activos.length > 0 ? "Espera a que termine lo que está en marcha" : `Vuelve a como estaba antes de «${notaActual}»`}
              onClick={() => volverA(deshacer.numero, `¿Deshacer el último cambio («${notaActual}»)? Vuelve a la versión ${deshacer.numero}; se guarda como versión nueva y no se pierde nada.`)}>↶ Deshacer</button>
          )}
          <a className="boton" href="#historial" onClick={() => setHistorialAbierto(true)}>Historial</a>
          {fila.estado === "entregado" && render && !renderAlDia
            ? <span className="inline-block rounded-full bg-amber-800 px-2 py-0.5 text-xs font-medium text-amber-100">Con cambios sin exportar</span>
            : <Estado valor={fila.estado} />}
          <button type="button" className="boton boton-primario" disabled={ocupado || !p || !!enCurso} onClick={() => void renderizar()}>{enCurso ? "Creando el video…" : "Crear el video (sin usar la tarjeta de video)"}</button>
        </div>
      </header>
      {/* UX-10: el avance y el resultado del render, junto al botón (antes, la barra quedaba al final de la página). */}
      {enCurso ? (
        <div className="tarjeta space-y-2 p-3 text-sm" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 font-medium">Creando tu video: {pasoRender(enCurso)}</p>
            <button type="button" className="boton py-1" disabled={ocupado}
              onClick={() => { if (confirm("¿Dejar de crear el video? Lo que editaste no se pierde; puedes crearlo otra vez cuando quieras.")) void hacer(() => postJson(`/api/trabajos/${enCurso.id}`, { accion: "cancelar" }), "Listo: dejé de crear el video."); }}>Cancelar</button>
          </div>
          <Barra valor={enCurso.progreso ?? 0} etiqueta="Avance del video" />
          {render?.segundos ? <p className="text-xs text-tenue">La última vez tardó {segundos(render.segundos)}. Puedes seguir editando o cerrar esta página.</p> : null}
        </div>
      ) : fallo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-900 bg-red-950/30 px-3 py-2 text-sm" role="alert">
          <p className="min-w-0 flex-1">No se pudo crear el video. {explicarError(fallo.error).simple}</p>
          <BotonReintentar className="boton py-1" disabled={ocupado} usaGpu={fallo.usaGpu}
            onClick={() => void hacer(() => postJson(`/api/trabajos/${fallo.id}`, { accion: "relanzar" }), "Listo: lo estamos intentando otra vez.")} />
        </div>
      ) : render && renderAlDia && qc ? (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${qc.estado === "falta" ? "border-red-900 bg-red-950/30" : "border-emerald-800 bg-emerald-950/40"}`}>
          {qc.estado === "falta" ? (
            <>
              <p className="min-w-0 flex-1">{qc.titulo}.</p>
              <a className="boton py-1" href="#listo">Ver qué falta</a>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1">Tu video está listo.</p>
              {render.estado === "aprobado" && <a className="boton py-1" href={archivo(`${fila.slug}/${render.ruta}`, true)}>Descargar</a>}
            </>
          )}
        </div>
      ) : null}
      {avisoRapidos && (
        <Aviso tipo={v.subtitulosRapidos?.bloquea ? "alerta" : "info"}>
          <p>{avisoRapidos.texto}</p>
          <p className="mt-1 flex flex-wrap gap-2">
            {v.subtitulosRapidos!.escenas.filter((e) => e.indice >= 0).map((e) => (
              <a key={e.id} className="text-acento hover:underline" href={`#escena-${e.id}`}>Ir a la escena {e.indice + 1}</a>
            ))}
          </p>
        </Aviso>
      )}
      {caras?.fase === "buscando" && <p className="text-sm text-tenue" role="status">Revisando los clips para encuadrar mejor las caras…</p>}
      {caras?.fase === "listo" && (
        <Aviso tipo="ok">
          <p>
            Encontramos caras en {caras.escenas.length === 1 ? "la escena" : "las escenas"} {enLista(caras.escenas.map((e) => e.numero))} y
            {caras.escenas.length === 1 ? " la encuadramos" : " las encuadramos"} para que la persona se vea a pantalla completa, en vez de achicada con fondo borroso.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="boton" href={`#escena-${caras.escenas[0]!.id}`}>Ver {caras.escenas.length === 1 ? "la escena" : `la escena ${caras.escenas[0]!.numero}`}</a>
            <button type="button" className="boton" disabled={ocupado} onClick={() => void dejarComoEstaba(caras.escenas.map((e) => e.id))}>Dejar como estaba</button>
            <button type="button" className="boton" onClick={() => setCaras(null)}>Entendido</button>
          </div>
        </Aviso>
      )}
      {p && otroActivo && (
        <Aviso tipo="info">Geeper está trabajando en este video{otroActivo.etapa ? `: ${otroActivo.etapa}` : ""}. Abajo, en «Trabajos de este proyecto», ves el avance.</Aviso>
      )}
      {!p && (() => {
        // UX-29: sin jerga, con cuánto tarda, y si falló no se dice que «se está generando».
        const c = estadoCreacion(fila.trabajos);
        if (c.fase === "fallo") return (
          <Aviso tipo={c.trabajo?.estado === "cancelado" ? "info" : "error"}>
            <p>{textoFalloCreacion(c.trabajo)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <BotonReintentar className="boton py-1" disabled={ocupado} usaGpu={c.trabajo?.usaGpu} onClick={() => void hacer(() => postJson(`/api/trabajos/${c.trabajo!.id}`, { accion: "relanzar" }), "Listo: lo estamos intentando otra vez.")} />
              {c.trabajo?.error && <details className="text-xs"><summary className="cursor-pointer text-tenue">Ver el error</summary><p className="mt-1 whitespace-pre-wrap break-words">{c.trabajo.error}</p></details>}
            </div>
          </Aviso>
        );
        if (activos.some((t) => t.tipo === "proyecto.traducir")) return <Aviso tipo="info">Geeper está haciendo esta versión en otro idioma: traduce el guion, graba la voz nueva, acomoda los subtítulos y crea el video. Tarda unos minutos; puedes cerrar esta página y volver después. Abajo ves en qué paso va.</Aviso>;
        return (
          <Aviso tipo="info">
            Estamos haciendo tu video{c.trabajo?.etapa && c.fase === "en-curso" ? ` (ahora: ${c.trabajo.etapa})` : ""}. Tarda unos minutos; puedes cerrar esta página y volver. Abajo ves en qué paso va.
          </Aviso>
        );
      })()}
      {p && <PanelAsistente proyectoId={id} version={fila.versionActual} ocupado={ocupado} editarVarias={editarVarias} renderizar={renderizar} alinearMusica={alinearMusica}
        volverA={(numero) => hacer(() => postJson(`/api/proyectos/${id}/version`, { numero }), `Volviste a como estaba antes (versión ${numero}, guardada como versión nueva).`)} />}
      {p?.origen?.traduccion && <InformeTraduccion informe={p.origen.traduccion} escenas={escenas.map((e) => ({ id: e.id, numero: e.indice + 1 }))} />}

      {/* UX-08: índice fijo con los 4 pasos y el siguiente paso, para no perderse en una página larga. */}
      {p && (
        <nav aria-label="Pasos del video" className="sticky top-0 z-30 -mx-4 space-y-1 border-b border-borde bg-[#0b0d12]/95 px-4 py-2 backdrop-blur">
          <ol className="flex gap-1 overflow-x-auto text-sm">
            {PASOS_EDITOR.map((x, i) => (
              <li key={x.id} className="shrink-0"><a className="block whitespace-nowrap rounded px-2 py-1 hover:bg-white/10" href={`#${x.id}`}>{i + 1}. {x.titulo}</a></li>
            ))}
          </ol>
          <p className="text-xs" role="status"><span className="text-tenue">Siguiente paso:</span> <a className="text-acento underline" href={paso.ir}>{paso.texto}</a></p>
        </nav>
      )}

      {p && (
        <section id="paso-1" aria-labelledby="titulo-paso-1" className="scroll-mt-28 space-y-3">
          <h2 id="titulo-paso-1" className="text-lg font-semibold">1. Mira tu video</h2>
          <div className={`grid gap-4 ${render?.informeQc ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : ""}`}>
            <div className="tarjeta space-y-3 p-4">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Vista previa</h3>
                <div className="ml-auto flex gap-1 text-sm" role="tablist" aria-label="Qué ver">
                  {(["vivo", "render"] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={modo === m}
                      className={`rounded px-2 py-1 ${modo === m ? "bg-white/15" : "text-tenue hover:bg-white/5"}`}
                      onClick={() => setPestana(m)}>
                      {m === "vivo" ? "En vivo" : "Último video"}
                    </button>
                  ))}
                </div>
              </div>
              {modo === "vivo" ? (
                <>
                  <VistaEnVivo proyectoId={id} version={fila.versionActual} irA={irA} />
                  {/* UX-28: con cambios sin exportar se abre «En vivo»; la descarga del último video queda a mano. */}
                  {render?.estado === "aprobado" && (
                    <p className="text-sm">
                      <a className="text-acento hover:underline" href={archivo(`${fila.slug}/${render.ruta}`, true)}>Descargar el último video (versión {render.versionNumero})</a>
                      {!renderAlDia && <span className="text-tenue"> · no tiene los últimos cambios</span>}
                    </p>
                  )}
                </>
              ) : null}
              {modo !== "vivo" && render && (
                <>
                  <video key={render.id} src={archivo(`${fila.slug}/${render.ruta}`)} controls preload="metadata" aria-label={`Video creado (versión ${render.versionNumero})`}
                    className={`mx-auto max-h-[70vh] w-full rounded bg-black ${render.perfil === "shorts-9x16" ? "max-w-sm" : ""}`} />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Estado valor={render.estado} />
                    <span className="text-tenue">v{render.versionNumero} · {nombreForma(render.perfil)} · {segundos(render.duracion)} · se hizo en {segundos(render.segundos)}</span>
                    {!renderAlDia && <span className="text-amber-300">Hay cambios sin crear el video</span>}
                    {render.estado === "aprobado"
                      ? <>
                          <a className="boton ml-auto" href={archivo(`${fila.slug}/${render.ruta}`, true)}>Descargar MP4</a>
                          {render.srt && <a className="boton" title="Un archivo con los subtítulos, para subirlo junto al video (ayuda a quien no oye y a que te encuentren)"
                            href={archivo(`${fila.slug}/${render.ruta.replace(/\.mp4$/, ".srt")}`, true)}>Subtítulos aparte</a>}
                          {render.informeQc?.master && <a className="boton" href={archivo(`${fila.slug}/${render.informeQc.master}`, true)}>Máster (.mov)</a>}
                        </>
                      : <span className="ml-auto text-xs text-red-300">No se descarga: no pasó la revisión</span>}
                  </div>
                </>
              )}
              {modo !== "vivo" && !render && <p className="text-sm text-tenue">Todavía no creaste el video.</p>}
            </div>
            {render?.informeQc && (
              <section id="listo" className="tarjeta scroll-mt-28 p-4">
                <h3 className="mb-3 font-medium">¿Está listo para publicar?</h3>
                {/* UX-16: si cambió algo después de este video, la revisión es de antes (al día por contenido, UX-21). */}
                <AvisoRevisionVieja versionRevisada={render.versionNumero} versionActual={renderAlDia ? render.versionNumero : fila.versionActual}
                  ocupado={ocupado || !!enCurso} alCrear={() => void renderizar()} />
                <AvisoVocesMezcladas escenas={escenas} voces={v.voces ?? null} />
                <InformeQc r={render} slug={fila.slug} escenas={escenas} vectorizar={{ hacer: vectorizarImagen, sigue: (a) => !!v && (v.escenas.some((e) => e.visual.asset === a) || !!v.extras?.libres.some((pi) => pi.clips.some((c) => c.asset === a))), ocupado }} />
              </section>
            )}
          </div>
        </section>
      )}

      {escenas.length > 0 && (
        <section id="paso-2" aria-labelledby="titulo-paso-2" className="scroll-mt-28">
          <h2 id="titulo-paso-2" className="mb-1 text-lg font-semibold">2. Corrige lo que se dice y se ve</h2>
          <p className="mb-3 text-sm text-tenue">Cada escena con sus subtítulos, su imagen y su voz.</p>
          <ol id="escenas" className="scroll-mt-28 space-y-3" aria-label="Escenas">
            {escenas.map((e, i) => (
              <TarjetaEscena key={e.id} e={e} anterior={escenas[i - 1]} slug={fila.slug} total={escenas.length} formato={p?.formato ?? fila.formato}
                estilo={v.extras?.estilo ?? null} editar={editar} editarOk={editarOk} subirClip={subirClip} regenerarVoz={regenerarVoz} reencuadrar={reencuadrar} animar={animar} proyectoId={id} ocupado={ocupado}
                vozReal={Boolean(v.extras?.clip)} preguntaVoz={preguntaVozEscena(e.id, escenas, v.voces ?? null)} />
            ))}
          </ol>
        </section>
      )}

      {p && (
        <section id="paso-3" aria-labelledby="titulo-paso-3" className="scroll-mt-28 space-y-4">
          <h2 id="titulo-paso-3" className="text-lg font-semibold">3. Voz y estilo</h2>
          <div className="tarjeta space-y-4 p-4">
            <h3 className="font-medium">Forma del video y voz</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="etiqueta" htmlFor="formato">Forma del video</label>
                <select id="formato" className="campo" value={p.formato} disabled={ocupado} onChange={(e) => void editar({ tipo: "cambiarFormato", formato: e.target.value })}>
                  {(Object.keys(FORMAS) as (keyof typeof FORMAS)[]).map((f) => <option key={f} value={f}>{nombreForma(f)} · {FORMAS[f].para}</option>)}
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="plant">Estilo del canal</label>
                <select id="plant" className="campo" value={p.plantilla} disabled={ocupado} onChange={(e) => void editar({ tipo: "cambiarPlantilla", plantilla: e.target.value })}>
                  {pl?.plantillas.map((x) => <option key={x.slug} value={x.slug}>{x.nombre}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="etiqueta" htmlFor="mostrar">Mostrar en pantalla otra cosa que la que se oye (una regla por línea: <code>GTA seis=GTA VI</code>)</label>
              <textarea id="mostrar" className="campo min-h-16 font-mono" value={textoMostrar} onChange={(e) => setMostrarTxt(e.target.value)} />
              {mostrarTxt !== null && (
                <button type="button" className="boton mt-2" disabled={ocupado} onClick={() => void editar({
                  tipo: "cambiarMostrar",
                  mostrar: mostrarTxt.split("\n").map((l) => l.split("=")).filter((x) => x.length === 2 && x[0]!.trim() && x[1]!.trim()).map(([de, a]) => ({ de: de!.trim(), a: a!.trim() })),
                }).then(() => setMostrarTxt(null))}>Guardar reglas</button>
              )}
            </div>
            {!v.extras?.clip && (
              <div className="border-t border-borde pt-3">
                <ElegirVoz actual={p.voz} idioma={p.voz.idioma} usar={usarVoz} ocupado={ocupado} />
                {otraVoz.length > 0 && v.voces?.elegida && (
                  // UX-12: mientras la voz elegida no sea la que suena, se dice y se ofrece ponerla.
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm" role="status">
                    <p className="min-w-0 flex-1">
                      Elegiste la voz {v.voces.nombres[v.voces.elegida] ?? v.voces.elegida}, pero {otraVoz.length === escenas.length ? "el video todavía suena" : `${otraVoz.length === 1 ? "la escena" : "las escenas"} ${enLista(otraVoz)} todavía ${otraVoz.length === 1 ? "suena" : "suenan"}`} con otra voz.
                    </p>
                    <button type="button" className="boton py-1" disabled={ocupado || !!otroActivo}
                      onClick={() => { if (confirm("Se vuelve a decir todo el guion con la voz elegida, se acomodan los subtítulos y se crea el video (unos minutos).")) void regenerarVoz(null); }}>Ponerla en todo el video</button>
                    {otraVoz.length < escenas.length && (
                      <button type="button" className="boton py-1" disabled={ocupado || !!otroActivo}
                        onClick={() => void rehacerVoces(idsConOtraVoz(escenas, v.voces?.elegida ?? null), otraVoz)}>Rehacer la voz de las escenas cambiadas</button>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* UX-27: en un clip la voz es la del creador: ni ritmo ni regenerar. */}
            {!v.extras?.clip && (
              <div className="flex flex-wrap items-end gap-2 border-t border-borde pt-3">
                <div>
                  <label className="etiqueta" htmlFor="vel">Ritmo de la voz (cuenta la próxima vez que se diga el guion)</label>
                  <select id="vel" className="campo w-auto" value={String(p.voz.velocidad)} disabled={ocupado} aria-describedby={avisoRitmo(p.voz.velocidad) ? "aviso-ritmo" : undefined}
                    onChange={(e) => void editarOk({ tipo: "cambiarVoz", velocidad: Number(e.target.value) }, TEXTO_RITMO_GUARDADO)}>
                    {opcionesRitmo(p.voz.velocidad).map((x) => <option key={x.valor} value={String(x.valor)}>{x.nombre}</option>)}
                  </select>
                </div>
                <button type="button" className="boton" disabled={ocupado} onClick={() => { if (confirm("¿Regenerar la voz de todo el guion? Se realinean los subtítulos y se vuelve a crear el video. Con una voz diseñada espera su turno en la tarjeta de video.")) void regenerarVoz(null); }}>
                  Regenerar voz del guion completo
                </button>
                {avisoRitmo(p.voz.velocidad) && <p id="aviso-ritmo" className="w-full text-xs text-amber-200">{avisoRitmo(p.voz.velocidad)}</p>}
              </div>
            )}
          </div>
          {v.extras && (
            <>
              <PanelEstilo estilo={v.extras.estilo} escenas={escenas} formato={p.formato} imgs={escenas.slice(0, 2).map((e) => miniatura(fila.slug, e))}
                editar={editar} editarVarias={editarVarias} ocupado={ocupado} />
              <PanelMusica proyectoId={id} ocupado={ocupado} alCambiar={() => void recargar()} />
              <PanelEfectosSonido proyectoId={id} escenas={escenas.map((e) => ({ numero: e.indice + 1, inicio: e.inicio }))} total={v.total} ocupado={ocupado} alCambiar={() => void recargar()} />
              <Plegable titulo="Más opciones" detalle="Para qué redes es, silencios y muletillas, música, textos en pantalla y superposiciones.">
                <PanelAvanzado extras={v.extras} formato={p.formato} total={v.total} escenas={escenas.map((e) => ({ numero: e.indice + 1, inicio: e.inicio, duracion: e.duracion }))} editar={editar} alinearMusica={alinearMusica} subirLibre={subirLibre} ocupado={ocupado} slug={fila.slug} />
              </Plegable>
            </>
          )}

          <PanelAvatarVideo proyectoId={id} ocupado={ocupado} />

          {!v.extras?.clip && <PanelPresentador proyectoId={id} escenas={escenas.map((e) => ({ id: e.id, numero: e.indice + 1, texto: e.texto }))} ocupado={ocupado} alCambiar={() => void recargar()} usarVoz={usarVoz} />}
        </section>
      )}

      <section id="paso-4" aria-labelledby="titulo-paso-4" className="scroll-mt-28 space-y-4">
        <h2 id="titulo-paso-4" className="text-lg font-semibold">4. Crea, descarga y publica</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="boton boton-primario" disabled={ocupado || !p || !!enCurso} onClick={() => void renderizar()}>{enCurso ? "Creando el video…" : "Crear el video"}</button>
          {render?.estado === "aprobado" && renderAlDia && <a className="boton" href={archivo(`${fila.slug}/${render.ruta}`, true)}>Descargar</a>}
          <p className="min-w-0 flex-1 text-sm text-tenue">Cuando el video pase la revisión, aquí lo descargas y lo publicas.</p>
        </div>
        {render?.estado === "aprobado" ? (
          <>
            <PanelCreditos proyectoId={id} />
            <PanelPublicar proyectoId={id} render={render} nombre={fila.nombre} tema={v.extras?.clip?.descripcion || fila.tema} publicaciones={fila.publicaciones} alCambiar={() => void recargar()} />
          </>
        ) : fila.publicaciones.length > 0 && (
          <section className="tarjeta space-y-2 p-4">
            <h2 className="font-medium">Publicaciones de este proyecto</h2>
            <p className="text-xs text-tenue">El último video no está aprobado: para publicar otra vez, créalo de nuevo y pasa la revisión.</p>
            <ListaPublicaciones publicaciones={fila.publicaciones} alCambiar={() => void recargar()} />
          </section>
        )}
        {p && (
          <Plegable titulo="Portada" detalle="La imagen que se ve antes de darle a reproducir.">
            <PanelPortada proyectoId={id} nombre={fila.nombre} version={fila.versionActual} vertical={fila.formato === "9:16"} alDia={alDia} />
          </Plegable>
        )}
        {p && !v.extras?.clip && (
          <Plegable titulo="Otro idioma" detalle="Hace una copia del video con la voz y los subtítulos en otro idioma.">
            <PanelTraducir proyectoId={id} idiomaActual={p.voz.idioma} ocupado={ocupado} />
          </Plegable>
        )}
        {p && (
          <Plegable titulo="Terminar en otro editor" detalle="Para seguir el video en otro programa de edición.">
            <PanelOtroEditor proyectoId={id} version={fila.versionActual} />
          </Plegable>
        )}
        <section className="grid items-start gap-4 lg:grid-cols-2">
          <Plegable id="historial" titulo="Historial" detalle="Todas las versiones guardadas; puedes volver a cualquiera."
            abierto={historialAbierto} alCambiar={setHistorialAbierto}>
            <ul className="max-h-80 space-y-1 overflow-auto text-sm">
              {fila.versiones.map((x) => (
                <li key={x.numero} className="flex items-center gap-2">
                  <span className="w-10 font-mono text-tenue">v{x.numero}</span>
                  <span className="flex-1">{x.nota}</span>
                  <span className="text-xs text-tenue" title={fecha(x.creado)}>{haceCuanto(x.creado)}</span>
                  {x.numero !== fila.versionActual && (
                    <button type="button" className="boton py-0.5 text-xs" disabled={ocupado}
                      onClick={() => volverA(x.numero, `¿Volver a la versión ${x.numero} («${x.nota}»)? Se guarda como versión nueva: no se pierde nada.`)}>Volver a esta</button>
                  )}
                </li>
              ))}
            </ul>
            {fila.renders.length > 1 && (
              <>
                <h3 className="mb-1 mt-4 text-sm font-medium">Videos anteriores</h3>
                <ul className="space-y-1 text-sm">
                  {fila.renders.slice(1).map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <Estado valor={r.estado} /><span className="text-tenue">v{r.versionNumero} · {nombreForma(r.perfil)}</span>
                      <a className="ml-auto text-acento hover:underline" href={archivo(`${fila.slug}/${r.ruta}`)}>Ver</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Plegable>
          <Plegable id="trabajos" titulo="Trabajos de este proyecto" detalle="Lo que Geeper hizo o está haciendo con este video, con su registro."
            abierto={verTrabajos(trabajosAbiertos, activos.length > 0, !p, falloReciente(fila.trabajos))} alCambiar={setTrabajosAbiertos}>
            <ListaTrabajos proyectoId={id} />
          </Plegable>
        </section>
      </section>
    </div>
  );
}

