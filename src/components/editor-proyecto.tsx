"use client";
import { useEffect, useRef, useState } from "react";
import { Aviso, Estado, archivo, pedir, postJson, segundos, useSondeo } from "./comun";
import { ACCEPT_IMAGEN, esVector } from "@/lib/formatos-vector";
import { explicar, resumirQc } from "@/lib/qc-explicado";
import { VistaEnVivo } from "./vista-en-vivo";
import { ListaTrabajos } from "./lista-trabajos";
import { ListaPublicaciones, PanelPublicar, type PublicacionV } from "./panel-publicar";
import { PanelAnimar, type OpcionesAnimar } from "./panel-animar";
import { PanelPortada } from "./panel-portada";
import { ElegirVoz, type MotorVoz } from "./elegir-voz";
import { PanelPresentador } from "./panel-presentador";
import { PanelRehacer } from "./panel-rehacer";
import { PanelAvatarEscena, PanelAvatarVideo } from "./panel-avatar";
import { PanelEscena3d } from "./panel-escena3d";
import { SelectorEncuadre, type EncuadreV } from "./selector-encuadre";
import { PanelOtroEditor } from "./panel-otro-editor";
import { useAccionesProyecto } from "./acciones-proyecto";
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
  voz: { asset: string; source: string; ruta: string };
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
  informeQc: { aprobado: boolean; reglas: Regla[]; hojaContacto?: string; fotogramas: { t: number; ruta: string; nota: string }[]; master?: string } | null;
}
interface Vista {
  fila: {
    id: string; slug: string; nombre: string; tema: string; formato: string; plantilla: string; estado: string; versionActual: number;
    versiones: { numero: number; nota: string; creado: string }[];
    renders: Render[];
    trabajos: { tipo: string; estado: string }[];
    lote: { nombre: string } | null;
    publicaciones: PublicacionV[];
  };
  p: { voz: { motor: string; voz: string; velocidad: number; idioma: string }; mostrar: { de: string; a: string }[]; formato: string; plantilla: string } | null;
  escenas: EscenaV[];
  total: number;
  extras: ExtrasV | null;
  /** Importado antes del reencuadre por cara: se analiza una vez al abrirlo. */
  carasPendientes: boolean;
}

/** Mensaje de una subida: el de éxito más lo que VectorCraft avisó al convertir (p. ej. una fuente que faltaba). */
const conAvisos = (r: { avisos?: string[] }, ok: string) => (r.avisos?.length ? `${ok} Ojo: ${r.avisos.join(" · ")}` : ok);

const t2 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function medido(v: unknown): string {
  if (typeof v === "number") return String(Number(v.toFixed(2)));
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

function InformeQc({ r, slug, vectorizar }: { r: Render; slug: string; vectorizar?: Vectorizar }) {
  const inf = r.informeQc;
  if (!inf) return null;
  const res = resumirQc(inf.reglas);
  const color = res.estado === "listo" ? "text-emerald-300" : res.estado === "con-avisos" ? "text-amber-200" : "text-red-300";
  return (
    <div className="space-y-3">
      <p className={`text-base font-medium ${color}`}>{res.estado === "listo" ? "✓ " : res.estado === "con-avisos" ? "! " : "✗ "}{res.titulo}</p>
      {[...res.bloquean.map((x) => ({ ...x, bloquea: true })), ...res.avisos.map((x) => ({ ...x, bloquea: false }))].map((x) => {
        const e = explicar(x.id);
        return (
          <div key={x.id} className={`rounded-lg border p-3 text-sm ${x.bloquea ? "border-red-900 bg-red-950/30" : "border-amber-900 bg-amber-950/20"}`}>
            <p className="font-medium">{x.bloquea ? "Hay que arreglarlo: " : "Para mirar: "}{e.que}</p>
            <p className="mt-1 text-tenue">Qué hacer: {e.hacer}</p>
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
          <img src={archivo(`${slug}/${inf.hojaContacto}`)} alt="Hoja de contacto: fotogramas clave del render" className="w-full rounded border border-borde" />
          <figcaption className="mt-1 text-xs text-tenue">Hoja de contacto: {inf.fotogramas.map((f) => `${f.nota} (${f.t.toFixed(1)} s)`).join(" · ")}</figcaption>
        </figure>
      )}
    </div>
  );
}

function EditorGrupo({ g, onGuardar, onQuitar, corregido }: { g: Grupo; corregido: boolean; onGuardar: (texto: string) => Promise<void>; onQuitar: () => Promise<void> }) {
  const [texto, setTexto] = useState(g.mostradoPropio);
  const [guardando, setGuardando] = useState(false);
  const cambiado = texto.trim() !== g.mostradoPropio;
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 font-mono text-xs text-tenue">{g.inicio.toFixed(2)} s</span>
      <input aria-label={`Subtítulo en ${g.inicio.toFixed(2)} s`} className="campo min-w-0 flex-1 py-1" value={texto} onChange={(e) => setTexto(e.target.value)} />
      {cambiado && (
        <button type="button" className="boton boton-primario py-1" disabled={guardando}
          onClick={async () => { setGuardando(true); try { await onGuardar(texto); } finally { setGuardando(false); } }}>Guardar</button>
      )}
      {corregido && !cambiado && <button type="button" className="boton py-1" onClick={() => void onQuitar()} title={`Se oye: «${g.oido}»`}>Deshacer</button>}
      {g.cruza && <span className="text-xs text-tenue">sigue en la escena siguiente</span>}
      {g.oido !== g.mostradoPropio && <span className="w-full pl-[4.5rem] text-xs text-tenue">Se oye: «{g.oido}»</span>}
    </li>
  );
}

/** «2», «2 y 5», «2, 4 y 5». */
function lista(n: number[]): string {
  return n.length <= 1 ? String(n[0] ?? "") : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

function TarjetaEscena({ e, anterior, slug, proyectoId, total, formato, estilo, editar, subirClip, regenerarVoz, reencuadrar, animar, ocupado }: {
  e: EscenaV; anterior?: EscenaV; slug: string; proyectoId: string; total: number; ocupado: boolean; formato: string; estilo: EstiloV | null;
  editar: (ed: object) => Promise<void>;
  subirClip: (escena: string, f: File) => Promise<void>;
  regenerarVoz: (escena: string) => Promise<void>;
  reencuadrar: (escena: string, layout: string) => Promise<void>;
  animar: (escena: string, opciones: OpcionesAnimar) => Promise<void>;
}) {
  return (
    <li id={`escena-${e.id}`} className="tarjeta flex scroll-mt-4 flex-col gap-3 p-3 md:flex-row">
      <div className="shrink-0">
        <SelectorEncuadre escena={e.id} numero={e.indice + 1} encuadre={e.visual.encuadre} ocupado={ocupado}
          src={`/api/miniatura?p=${slug}&ruta=${encodeURIComponent(e.visual.ruta)}&t=${(e.visual.inicio + 0.5).toFixed(1)}`}
          elegir={(ajuste, ancla) => void editar({ tipo: "ajusteVisual", escena: e.id, ajuste, ancla })} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">Escena {e.indice + 1}</h3>
          <span className="font-mono text-xs text-tenue">{t2(e.inicio)} – {t2(e.inicio + e.duracion)} ({e.duracion.toFixed(2)} s)</span>
          <span className="text-xs text-tenue">clip: {e.visual.source}{e.visual.source === "archivo" ? " (propio)" : ""} · voz: {e.voz.source}</span>
        </div>
        <EdicionPorTexto escena={e.id} audio={archivo(`${slug}/${e.voz.ruta}`)} palabras={e.detalle} duracion={e.duracion} duracionOriginal={e.duracionOriginal} editar={editar} ocupado={ocupado} />
        <ul className="space-y-1.5">
          {e.grupos.map((g) => (
            <EditorGrupo key={`${g.desde}-${g.hasta}-${g.mostradoPropio}`} g={g}
              corregido={e.correcciones.some((c) => c.desde >= g.desde && c.hasta <= g.hasta)}
              onGuardar={(texto) => editar({ tipo: "corregirSubtitulo", escena: e.id, desde: g.desde, hasta: g.hasta, texto })}
              onQuitar={async () => { for (const c of e.correcciones.filter((c) => c.desde >= g.desde && c.hasta <= g.hasta)) await editar({ tipo: "quitarCorreccion", escena: e.id, desde: c.desde }); }} />
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="boton" disabled={ocupado || e.indice === 0} onClick={() => void editar({ tipo: "moverEscena", escena: e.id, a: e.indice - 1 })} aria-label={`Subir escena ${e.indice + 1}`}>↑ Subir</button>
          <button type="button" className="boton" disabled={ocupado || e.indice === total - 1} onClick={() => void editar({ tipo: "moverEscena", escena: e.id, a: e.indice + 1 })} aria-label={`Bajar escena ${e.indice + 1}`}>↓ Bajar</button>
          <label className="boton cursor-pointer">
            Reemplazar clip…
            <input type="file" accept={`video/*,${ACCEPT_IMAGEN}`} className="sr-only" disabled={ocupado}
              onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void subirClip(e.id, f); ev.target.value = ""; }} />
          </label>
          {e.visual.tipo === "video" && (
            <select aria-label="Pantalla dividida para clips de directos" className="campo w-auto py-1" value="" disabled={ocupado}
              onChange={(ev) => { const l = ev.target.value; ev.target.value = ""; if (l) void reencuadrar(e.id, l); }}>
              <option value="">Pantalla dividida (directos)…</option>
              <option value="react">React: cara arriba, juego abajo</option>
              <option value="cara">Cara a toda la altura</option>
            </select>
          )}
          {e.voz.source !== "archivo" && (
            <button type="button" className="boton" disabled={ocupado} onClick={() => void regenerarVoz(e.id)}>Regenerar voz de la escena</button>
          )}
          <button type="button" className="boton boton-peligro" disabled={ocupado || total <= 1}
            onClick={() => { if (confirm(`¿Quitar la escena ${e.indice + 1}? Se quita también lo que se oye en ella. Puedes volver atrás en el historial.`)) void editar({ tipo: "quitarEscena", escena: e.id }); }}>Quitar</button>
        </div>
        <EfectosEscena escena={e.id} indice={e.indice} efectos={e.efectos} estilo={estilo} formato={formato}
          imgA={anterior ? miniatura(slug, anterior) : undefined} imgB={miniatura(slug, e)} editar={editar} ocupado={ocupado} />
        <PanelAnimar proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} animar={animar} />
        <PanelAvatarEscena proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} />
        <PanelEscena3d proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} formato={formato} duracion={e.duracion} />
        {e.visual.tipo === "video" && <PanelRehacer proyectoId={proyectoId} escena={e.id} numero={e.indice + 1} ocupado={ocupado} miniatura={miniatura(slug, e)} />}
      </div>
    </li>
  );
}

export function EditorProyecto({ id }: { id: string }) {
  const { datos: v, error, recargar } = useSondeo<Vista>(`/api/proyectos/${id}`, 3000);
  const { datos: pl } = useSondeo<{ plantillas: { slug: string; nombre: string }[] }>("/api/plantillas", 60_000);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
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

  /** Si `fn` devuelve un texto, ése es el mensaje de éxito (p. ej. con avisos); si no, `ok`. */
  async function hacer(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tipo: "ok", texto: typeof r === "string" ? r : ok });
      await recargar();
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }
  const editar = (ed: object) => hacer(() => postJson(`/api/proyectos/${id}/editar`, { edicion: ed }), "Guardado como versión nueva. Ya se ve en «En vivo»; renderiza para el QC y la descarga.");
  const editarVarias = (eds: object[]) => hacer(() => postJson(`/api/proyectos/${id}/editar`, { ediciones: eds }), "Guardado como versión nueva. Ya se ve en «En vivo»; renderiza para el QC y la descarga.");
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
    "Voz en cola (Kokoro y whisper en CPU). Al terminar se realinean los subtítulos y se vuelve a renderizar.");
  /** Cambia la voz del proyecto y ofrece ponerla ya en el video (regenerar el guion completo). */
  const usarVoz = async (motor: MotorVoz, voz: string, nombre: string) => {
    await editar({ tipo: "cambiarVoz", motor, voz });
    if (confirm(`Listo: la voz del video ahora es «${nombre}». ¿La ponemos ya? Se vuelve a decir todo el guion con esa voz, se acomodan los subtítulos y se renderiza (unos minutos).`)) await regenerarVoz(null);
  };
  const renderizar = () => hacer(() => postJson(`/api/proyectos/${id}/render`, {}), "Render en cola: sólo compila y renderiza, no genera nada con la GPU.");
  const alinearMusica = () => hacer(async () => {
    const r = await postJson<{ cambio: boolean; motivo?: string }>(`/api/proyectos/${id}/musica`, {});
    if (!r.cambio) throw new Error(r.motivo ?? "No se pudo alinear la música");
  }, "Música alineada: los pulsos quedan marcados y el QC mide cuántos cortes caen en pulso.");
  const vectorizarImagen = (asset: string, donde: string) => hacer(async () =>
    conAvisos(await postJson(`/api/proyectos/${id}/vectorizar`, { asset }), `${donde}: vectorizada (SVG nítido). Vuelve a renderizar para verla en el QC; si no te gusta, vuelve a la versión anterior en Historial.`),
  "Vectorizada.");
  const subirLibre = (f: File, pista: string, inicio: number, licencia: string) => hacer(async () => {
    const fd = new FormData();
    fd.set("pista", pista);
    fd.set("inicio", String(inicio));
    fd.set("licencia", licencia);
    fd.set("archivo", f);
    return conAvisos(await pedir(`/api/proyectos/${id}/clip`, { method: "POST", body: fd }), `«${f.name}» agregado en ${inicio.toFixed(1)} s${esVector(f.name) ? " (convertido a SVG)" : ""}.`);
  }, `«${f.name}» agregado en ${inicio.toFixed(1)} s.`);

  useAccionesProyecto(v?.p ? {
    id, slug: v.fila.slug, formato: v.p.formato, plantilla: v.p.plantilla, plantillas: pl?.plantillas ?? [],
    renderAprobado: v.fila.renders[0]?.estado === "aprobado" ? v.fila.renders[0].ruta : null,
    hayMusica: !!v.extras?.musica, dudosas: v.extras?.confianza.dudosas ?? 0,
    versionAnterior: v.fila.versiones.find((x) => x.numero < v.fila.versionActual)?.numero ?? null,
    ocupado, editar, renderizar, alinearMusica, regenerarVoz,
    volverA: (numero) => hacer(() => postJson(`/api/proyectos/${id}/version`, { numero }), `Volviste a la versión ${numero} (guardada como versión nueva).`),
  } : null);

  if (error && !v) return <Aviso tipo="error">{error}</Aviso>;
  if (!v) return <p className="text-tenue">Cargando…</p>;
  const { fila, p, escenas } = v;
  const render = fila.renders[0];
  // Por defecto: el render si está al día; si hay cambios sin renderizar, la vista en vivo.
  const modo = pestana ?? (render && render.versionNumero === fila.versionActual ? "render" : "vivo");
  const activos = fila.trabajos.filter((t) => t.estado === "pendiente" || t.estado === "corriendo");
  const textoMostrar = mostrarTxt ?? (p?.mostrar ?? []).map((m) => `${m.de}=${m.a}`).join("\n");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
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
          <Estado valor={fila.estado} />
          <button type="button" className="boton boton-primario" disabled={ocupado || !p} onClick={() => void renderizar()}>Renderizar (sin GPU para generar)</button>
        </div>
      </header>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {caras?.fase === "buscando" && <p className="text-sm text-tenue" role="status">Revisando los clips para encuadrar mejor las caras…</p>}
      {caras?.fase === "listo" && (
        <Aviso tipo="ok">
          <p>
            Encontramos caras en {caras.escenas.length === 1 ? "la escena" : "las escenas"} {lista(caras.escenas.map((e) => e.numero))} y
            {caras.escenas.length === 1 ? " la encuadramos" : " las encuadramos"} para que la persona se vea a pantalla completa, en vez de achicada con fondo borroso.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="boton" href={`#escena-${caras.escenas[0]!.id}`}>Ver {caras.escenas.length === 1 ? "la escena" : `la escena ${caras.escenas[0]!.numero}`}</a>
            <button type="button" className="boton" disabled={ocupado} onClick={() => void dejarComoEstaba(caras.escenas.map((e) => e.id))}>Dejar como estaba</button>
            <button type="button" className="boton" onClick={() => setCaras(null)}>Entendido</button>
          </div>
        </Aviso>
      )}
      {activos.length > 0 && <Aviso tipo="info">Hay {activos.length} trabajo(s) en curso para este proyecto; abajo ves su avance y su log.</Aviso>}
      {!p && <Aviso tipo="info">Todavía no hay geeper.json: el proyecto se está generando o importando.</Aviso>}

      {p && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="tarjeta space-y-3 p-4">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Vista previa</h2>
              <div className="ml-auto flex gap-1 text-sm" role="tablist" aria-label="Qué ver">
                {(["vivo", "render"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={modo === m}
                    className={`rounded px-2 py-1 ${modo === m ? "bg-white/15" : "text-tenue hover:bg-white/5"}`}
                    onClick={() => setPestana(m)}>
                    {m === "vivo" ? "En vivo" : "Último render"}
                  </button>
                ))}
              </div>
            </div>
            {modo === "vivo" ? <VistaEnVivo proyectoId={id} version={fila.versionActual} /> : render ? (
              <>
                <video key={render.id} src={archivo(`${fila.slug}/${render.ruta}`)} controls preload="metadata"
                  className={`mx-auto max-h-[70vh] w-full rounded bg-black ${render.perfil === "shorts-9x16" ? "max-w-sm" : ""}`} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Estado valor={render.estado} />
                  <span className="text-tenue">v{render.versionNumero} · {render.perfil} · {segundos(render.duracion)} · render en {segundos(render.segundos)}</span>
                  {render.versionNumero !== fila.versionActual && <span className="text-amber-300">Hay cambios sin renderizar</span>}
                  {render.estado === "aprobado"
                    ? <>
                        <a className="boton ml-auto" href={archivo(`${fila.slug}/${render.ruta}`, true)}>Descargar MP4</a>
                        <a className="boton" title="Para subirlos junto al video (accesibilidad y búsqueda)"
                          href={archivo(`${fila.slug}/${render.ruta.replace(/\.mp4$/, ".srt")}`, true)}>Subtítulos (.srt)</a>
                        {render.informeQc?.master && <a className="boton" href={archivo(`${fila.slug}/${render.informeQc.master}`, true)}>Máster (.mov)</a>}
                      </>
                    : <span className="ml-auto text-xs text-red-300">No se descarga: no pasó el QC</span>}
                </div>
              </>
            ) : <p className="text-sm text-tenue">Sin render todavía.</p>}
          </div>
          <div className="tarjeta space-y-4 p-4">
            <h2 className="font-medium">Ajustes (sólo cambian geeper.json)</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="etiqueta" htmlFor="formato">Formato</label>
                <select id="formato" className="campo" value={p.formato} disabled={ocupado} onChange={(e) => void editar({ tipo: "cambiarFormato", formato: e.target.value })}>
                  <option value="9:16">9:16 (Shorts)</option><option value="16:9">16:9 (YouTube)</option><option value="1:1">1:1 (cuadrado)</option>
                </select>
              </div>
              <div>
                <label className="etiqueta" htmlFor="plant">Plantilla</label>
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
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-borde pt-3">
              <div>
                <label className="etiqueta" htmlFor="vel">Velocidad de la voz (para la próxima regeneración)</label>
                <select id="vel" className="campo w-auto" value={String(p.voz.velocidad)} disabled={ocupado}
                  onChange={(e) => void editar({ tipo: "cambiarVoz", velocidad: Number(e.target.value) })}>
                  {[0.85, 0.9, 0.95, 1, 1.05].map((x) => <option key={x} value={String(x)}>{x}</option>)}
                </select>
              </div>
              <button type="button" className="boton" disabled={ocupado || Boolean(v.extras?.clip)} title={v.extras?.clip ? "Es un clip: la voz es la del creador" : undefined} onClick={() => { if (confirm("¿Regenerar la voz de todo el guion? Se realinean los subtítulos y se vuelve a renderizar. No usa la GPU.")) void regenerarVoz(null); }}>
                Regenerar voz del guion completo
              </button>
            </div>
          </div>
        </section>
      )}

      {p && v.extras && (
        <>
          <PanelEstilo estilo={v.extras.estilo} escenas={escenas} formato={p.formato} imgs={escenas.slice(0, 2).map((e) => miniatura(fila.slug, e))}
            editar={editar} editarVarias={editarVarias} ocupado={ocupado} />
          <PanelAvanzado extras={v.extras} formato={p.formato} total={v.total} editar={editar} alinearMusica={alinearMusica} subirLibre={subirLibre} ocupado={ocupado} slug={fila.slug} />
        </>
      )}

      {p && <PanelAvatarVideo proyectoId={id} ocupado={ocupado} />}

      {p && !v.extras?.clip && <PanelPresentador proyectoId={id} escenas={escenas.map((e) => ({ id: e.id, numero: e.indice + 1, texto: e.texto }))} ocupado={ocupado} alCambiar={() => void recargar()} usarVoz={usarVoz} />}

      {p && <PanelPortada proyectoId={id} nombre={fila.nombre} version={fila.versionActual} vertical={fila.formato === "9:16"} />}

      {render?.estado === "aprobado" ? (
        <PanelPublicar proyectoId={id} render={render} nombre={fila.nombre} tema={v.extras?.clip?.descripcion || fila.tema} publicaciones={fila.publicaciones} alCambiar={() => void recargar()} />
      ) : fila.publicaciones.length > 0 && (
        <section className="tarjeta space-y-2 p-4">
          <h2 className="font-medium">Publicaciones de este proyecto</h2>
          <p className="text-xs text-tenue">El último render no está aprobado: para publicar otra vez, renderiza y pasa el QC.</p>
          <ListaPublicaciones publicaciones={fila.publicaciones} alCambiar={() => void recargar()} />
        </section>
      )}

      {p && <PanelOtroEditor proyectoId={id} version={fila.versionActual} />}

      {render?.informeQc && (
        <section className="tarjeta p-4">
          <h2 className="mb-3 font-medium">¿Está listo para publicar?</h2>
          <InformeQc r={render} slug={fila.slug} vectorizar={{ hacer: vectorizarImagen, sigue: (a) => !!v && (v.escenas.some((e) => e.visual.asset === a) || !!v.extras?.libres.some((pi) => pi.clips.some((c) => c.asset === a))), ocupado }} />
        </section>
      )}

      {escenas.length > 0 && (
        <section>
          <h2 className="mb-3 font-medium">Escenas</h2>
          <ol className="space-y-3">
            {escenas.map((e, i) => (
              <TarjetaEscena key={e.id} e={e} anterior={escenas[i - 1]} slug={fila.slug} total={escenas.length} formato={p?.formato ?? fila.formato}
                estilo={v.extras?.estilo ?? null} editar={editar} subirClip={subirClip} regenerarVoz={regenerarVoz} reencuadrar={reencuadrar} animar={animar} proyectoId={id} ocupado={ocupado} />
            ))}
          </ol>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="tarjeta p-4">
          <h2 className="mb-2 font-medium">Historial</h2>
          <ul className="max-h-80 space-y-1 overflow-auto text-sm">
            {fila.versiones.map((x) => (
              <li key={x.numero} className="flex items-center gap-2">
                <span className="w-10 font-mono text-tenue">v{x.numero}</span>
                <span className="flex-1">{x.nota}</span>
                <span className="text-xs text-tenue">{new Date(x.creado).toLocaleString("es-MX")}</span>
                {x.numero !== fila.versionActual && (
                  <button type="button" className="boton py-0.5 text-xs" disabled={ocupado}
                    onClick={() => void hacer(() => postJson(`/api/proyectos/${id}/version`, { numero: x.numero }), `Volviste a la versión ${x.numero} (guardada como versión nueva).`)}>Volver a esta</button>
                )}
              </li>
            ))}
          </ul>
          {fila.renders.length > 1 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-medium">Renders anteriores</h3>
              <ul className="space-y-1 text-sm">
                {fila.renders.slice(1).map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <Estado valor={r.estado} /><span className="text-tenue">v{r.versionNumero} · {r.perfil}</span>
                    <a className="ml-auto text-acento hover:underline" href={archivo(`${fila.slug}/${r.ruta}`)}>Ver</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h2 className="mb-2 font-medium">Trabajos de este proyecto</h2>
          <ListaTrabajos proyectoId={id} />
        </div>
      </section>
    </div>
  );
}

