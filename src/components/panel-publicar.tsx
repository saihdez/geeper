"use client";
import Link from "next/link";
import { useState } from "react";
import { Aviso, Estado, archivo, postJson, useSondeo } from "./comun";
import { textoVpn, type CuentaInfo, type DatosCuentas, type RedInfo } from "./cuentas";
import { arreglar, bloquea, LIMITES, revisarTexto, type Problema, type TextoPublicacion } from "@/lib/redes/revision-texto";

export interface PublicacionV {
  id: string;
  estado: string;
  titulo: string;
  privacidad: string;
  programada: string | null;
  urlExterna: string | null;
  error: string | null;
  renderId: string;
  creado: string;
  cuenta: { id: string; red: string; usuario: string; alias: string | null };
}

interface ReglaQc { id: string; nombre: string; ok: boolean; aviso?: boolean; detalle?: string }

interface Campos { titulo: string; descripcion: string; privacidad: string; programada: string; portada: boolean }

/** Portada elegida del proyecto (panel «Portada del video»). */
interface PortadaV { archivo: string; titulo: string; creada: string }

const PRIVACIDAD: Record<string, string> = { publico: "Público", no_listado: "No listado", privado: "Privado", borrador: "Borrador" };
const NOMBRE_RED: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };

const fecha = (s: string) => new Date(s).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
/** «Público» para la red: Instagram no tiene privado, se publica al terminar. */
const esPublico = (red: string, privacidad: string) => privacidad === "publico" || red === "instagram";
/** Cada gravedad con palabra e ícono, no sólo color. */
const GRAVEDAD: Record<Problema["gravedad"], { clase: string; icono: string; nombre: string }> = {
  error: { clase: "text-red-300", icono: "✕", nombre: "Hay que arreglarlo" },
  aviso: { clase: "text-amber-300", icono: "!", nombre: "Conviene revisarlo" },
  info: { clase: "text-tenue", icono: "i", nombre: "Sugerencia" },
};

/** Títulos que ya se usaron en una cuenta: los de este proyecto y los de todos (`/api/cuentas/titulos`). */
const titulosDe = (publicaciones: PublicacionV[], cuentaId: string, deTodos: Record<string, string[]> | undefined) => [
  ...publicaciones.filter((p) => p.cuenta.id === cuentaId && !["cancelada", "fallida"].includes(p.estado)).map((p) => p.titulo),
  ...(deTodos?.[cuentaId] ?? []),
];

/** Lo que revisa `revision-texto.ts`, con el botón de arreglo cuando Geeper lo puede hacer solo. */
function RevisionTexto({ red, problemas, alArreglar }: { red: RedInfo; problemas: Problema[]; alArreglar: (id: string) => void }) {
  if (problemas.length === 0) {
    return <p className="text-xs text-emerald-300 sm:col-span-2" role="status">✓ Título y descripción listos para {red.nombre}.</p>;
  }
  return (
    <ul className="space-y-1.5 text-xs sm:col-span-2" aria-label={`Revisión del texto para ${red.nombre}`}>
      {problemas.map((x) => {
        const g = GRAVEDAD[x.gravedad];
        return (
          <li key={x.id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${g.clase}`}>
            <span aria-hidden="true" className="inline-flex size-4 items-center justify-center rounded-full border border-current text-[10px] font-bold">{g.icono}</span>
            <span className="sr-only">{g.nombre}:</span>
            <span>{x.que} {x.hacer}</span>
            {x.arreglo && <button type="button" className="boton py-0.5 text-xs" onClick={() => alArreglar(x.id)}>{x.arreglo}</button>}
          </li>
        );
      })}
    </ul>
  );
}

export function ListaPublicaciones({ publicaciones, alCambiar }: { publicaciones: PublicacionV[]; alCambiar: () => void }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; t: string } | null>(null);
  async function accion(p: PublicacionV, a: "reintentar" | "cancelar") {
    if (a === "cancelar" && !confirm(`¿Cancelar la publicación en ${p.cuenta.alias ?? p.cuenta.usuario}?`)) return;
    setOcupado(p.id);
    setMsg(null);
    try {
      await postJson(`/api/publicaciones/${p.id}`, { accion: a });
      setMsg({ tipo: "ok", t: a === "reintentar" ? "Reintento en cola: retoma la subida desde donde quedó." : "Publicación cancelada." });
      alCambiar();
    } catch (e) {
      setMsg({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(null);
    }
  }
  if (publicaciones.length === 0) return <p className="text-sm text-tenue">Todavía no se publicó este proyecto.</p>;
  return (
    <div className="space-y-2">
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      <ul className="space-y-2 text-sm">
        {publicaciones.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 border-t border-borde pt-2">
            <Estado valor={p.estado} />
            <span className="font-medium">{NOMBRE_RED[p.cuenta.red] ?? p.cuenta.red}</span>
            <span>{p.cuenta.alias ?? p.cuenta.usuario}</span>
            <span className="text-tenue">«{p.titulo}» · {PRIVACIDAD[p.privacidad] ?? p.privacidad}{p.programada ? ` · programada ${fecha(p.programada)}` : ""} · {fecha(p.creado)}</span>
            <span className="ml-auto flex gap-2">
              {p.urlExterna && <a className="boton py-0.5 text-xs" href={p.urlExterna} target="_blank" rel="noreferrer">Ver en {NOMBRE_RED[p.cuenta.red] ?? "la red"}</a>}
              {p.estado === "fallida" && <button type="button" className="boton py-0.5 text-xs" disabled={ocupado === p.id} onClick={() => void accion(p, "reintentar")}>Reintentar</button>}
              {["pendiente", "subiendo", "procesando"].includes(p.estado) && (
                <button type="button" className="boton boton-peligro py-0.5 text-xs" disabled={ocupado === p.id} onClick={() => void accion(p, "cancelar")}>Cancelar</button>
              )}
            </span>
            {p.error && <p className={`w-full text-xs ${p.estado === "fallida" ? "text-red-300" : "text-amber-300"}`}>{p.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «✨ Sugerir» título, descripción y hashtags con el modelo local (/api/proyectos/[id]/sugerir-texto). */
function SugerirTexto({ proyectoId, red, v, cambiar }: { proyectoId: string; red: RedInfo; v: Campos; cambiar: (v: Campos) => void }) {
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugerido, setSugerido] = useState(false);
  async function sugerir() {
    setPensando(true);
    setError(null);
    try {
      const s = await postJson<{ titulo: string; descripcion: string }>(`/api/proyectos/${proyectoId}/sugerir-texto`, { red: red.id });
      cambiar({ ...v, titulo: s.titulo, descripcion: s.descripcion });
      setSugerido(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPensando(false);
    }
  }
  return (
    <div className="space-y-1 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton" disabled={pensando} onClick={() => void sugerir()}>
          {pensando ? "Pensando (hasta 1 min)…" : sugerido ? "↻ Sugerir otra vez" : "✨ Sugerir título, descripción y hashtags"}
        </button>
        <span className="text-xs text-tenue">Con la IA de esta PC, a partir de lo que dice el video. Reemplaza lo que esté escrito abajo.</span>
      </div>
      {sugerido && !error && <p className="text-xs text-amber-300">Léelo y corrige lo que haga falta antes de publicar: la IA puede equivocarse.</p>}
      {error && <Aviso tipo="alerta">{error}</Aviso>}
    </div>
  );
}

function CamposDestino({ proyectoId, c, red, v, cambiar, portada, perfil, texto, problemas }: { proyectoId: string; c: CuentaInfo; red: RedInfo; v: Campos; cambiar: (v: Campos) => void; portada: PortadaV | null; perfil: string; texto: TextoPublicacion; problemas: Problema[] }) {
  const pre = `pub-${c.id}`;
  return (
    <div className="grid gap-3 border-l-2 border-borde pl-3 sm:grid-cols-2">
      {["youtube", "tiktok", "instagram"].includes(red.id) && <SugerirTexto proyectoId={proyectoId} red={red} v={v} cambiar={cambiar} />}
      <div className="sm:col-span-2">
        <label className="etiqueta" htmlFor={`${pre}-titulo`}>
          Título ({Array.from(v.titulo).length}/100)
          {red.id === "youtube" && <span className="font-normal text-tenue"> · en el teléfono se ve completo hasta {LIMITES.youtube.tituloVisible}</span>}
        </label>
        <input id={`${pre}-titulo`} className="campo" value={v.titulo} maxLength={100} required onChange={(e) => cambiar({ ...v, titulo: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="etiqueta" htmlFor={`${pre}-desc`}>Descripción y hashtags ({v.descripcion.length}/5000)</label>
        <textarea id={`${pre}-desc`} className="campo min-h-20" value={v.descripcion} maxLength={5000} onChange={(e) => cambiar({ ...v, descripcion: e.target.value })} />
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${pre}-priv`}>Privacidad</label>
        <select id={`${pre}-priv`} className="campo" value={v.privacidad} onChange={(e) => cambiar({ ...v, privacidad: e.target.value })}>
          {red.privacidades.map((x) => <option key={x} value={x}>{PRIVACIDAD[x] ?? x}</option>)}
        </select>
      </div>
      {red.programar && (
        <div>
          <label className="etiqueta" htmlFor={`${pre}-prog`}>Programar (opcional, hora local)</label>
          <input id={`${pre}-prog`} type="datetime-local" className="campo" value={v.programada} onChange={(e) => cambiar({ ...v, programada: e.target.value })} />
        </div>
      )}
      {red.id === "youtube" && (
        <div className="sm:col-span-2">
          {perfil !== "youtube-16x9" ? (
            <p className="text-xs text-tenue">En los Shorts, YouTube elige la miniatura desde su app: la portada no se sube.</p>
          ) : portada ? (
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={v.portada} onChange={(e) => cambiar({ ...v, portada: e.target.checked })} />
              {/* eslint-disable-next-line @next/next/no-img-element -- archivo local */}
              <img src={`${archivo(portada.archivo)}?v=${encodeURIComponent(portada.creada)}`} alt="" className="h-10 rounded" />
              <span>Usar la portada del video como miniatura <span className="block text-xs text-tenue">YouTube la acepta si el canal está verificado por teléfono.</span></span>
            </label>
          ) : (
            <p className="text-xs text-tenue">Sin portada: YouTube elegirá una imagen del video. Puedes crearla arriba, en «Portada del video».</p>
          )}
        </div>
      )}
      <RevisionTexto red={red} problemas={problemas} alArreglar={(id) => cambiar({ ...v, ...arreglar(texto, id) })} />
      <div className="space-y-1 text-xs sm:col-span-2">
        {red.id === "instagram" && <p className="text-amber-300">Instagram no tiene privado: el Reel se publica apenas termina la subida.</p>}
        {red.id === "tiktok" && v.privacidad === "borrador" && <p className="text-tenue">En borrador, el video llega a la bandeja de la app de TikTok y se publica desde el teléfono.</p>}
        {red.id === "youtube" && v.programada && v.privacidad !== "privado" && <p className="text-amber-300">YouTube sólo programa videos privados: elige «Privado».</p>}
      </div>
    </div>
  );
}

export function PanelPublicar({ proyectoId, render, nombre, tema, publicaciones, alCambiar }: {
  proyectoId: string;
  render: { id: string; perfil: string; informeQc: { reglas: ReglaQc[] } | null };
  nombre: string;
  tema: string;
  publicaciones: PublicacionV[];
  alCambiar: () => void;
}) {
  const { datos, error } = useSondeo<DatosCuentas>("/api/cuentas", 60_000);
  const { datos: dp } = useSondeo<{ elegida: PortadaV | null }>(`/api/proyectos/${proyectoId}/portada`, 60_000);
  const portada = dp?.elegida ?? null;
  const { datos: dt } = useSondeo<{ porCuenta: Record<string, string[]> }>("/api/cuentas/titulos", 60_000);
  const [marcadas, setMarcadas] = useState<Record<string, Campos>>({});
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; t: string } | null>(null);

  const redes = new Map((datos?.redes ?? []).map((r) => [r.id, r]));
  const compatibles = (datos?.cuentas ?? []).filter((c) => redes.get(c.red)?.formatos.includes(render.perfil));
  const conectadas = compatibles.filter((c) => c.estado === "conectada");
  const sinPermiso = compatibles.filter((c) => c.estado === "reconectar");
  const ya = new Set(publicaciones.filter((p) => p.renderId === render.id && !["cancelada", "fallida"].includes(p.estado)).map((p) => p.cuenta.id));
  const elegidas = conectadas.filter((c) => marcadas[c.id]);
  const licencia = (render.informeQc?.reglas ?? []).filter((g) => g.id.includes("licencia") && (g.aviso || !g.ok));
  const hayPublico = elegidas.some((c) => esPublico(c.red, marcadas[c.id]!.privacidad));

  function alternar(c: CuentaInfo) {
    setMarcadas((m) => {
      if (m[c.id]) {
        const { [c.id]: _quitada, ...resto } = m;
        void _quitada;
        return resto;
      }
      const red = redes.get(c.red)!;
      // El título de la portada elegida, si hay: es el que la persona eligió para este video.
      const titulo = (portada?.titulo ?? nombre).slice(0, 100);
      return { ...m, [c.id]: { titulo, descripcion: tema.slice(0, 5000), privacidad: red.privacidades[0] ?? "privado", programada: "", portada: red.id === "youtube" && render.perfil === "youtube-16x9" && !!portada } };
    });
  }

  async function publicar() {
    if (hayPublico && licencia.length > 0 && !confirm("El QC marcó un aviso de licencia en este render. ¿Publicar igual en público?")) return;
    setEnviando(true);
    setMsg(null);
    try {
      const destinos = elegidas.map((c) => {
        const v = marcadas[c.id]!;
        return { cuentaId: c.id, titulo: v.titulo.trim(), descripcion: v.descripcion, privacidad: v.privacidad, programada: v.programada ? new Date(v.programada).toISOString() : null, ...(v.portada ? { portada: true } : {}) };
      });
      await postJson(`/api/proyectos/${proyectoId}/publicar`, { renderId: render.id, destinos });
      setMsg({ tipo: "ok", t: `${destinos.length === 1 ? "1 publicación en cola" : `${destinos.length} publicaciones en cola`}. El avance se ve abajo y en Trabajos.` });
      setMarcadas({});
      alCambiar();
    } catch (e) {
      setMsg({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnviando(false);
    }
  }

  const textos = new Map(elegidas.map((c): [string, TextoPublicacion] => {
    const v = marcadas[c.id]!;
    return [c.id, { red: c.red, titulo: v.titulo, descripcion: v.descripcion, titulosPrevios: titulosDe(publicaciones, c.id, dt?.porCuenta), tituloSugerido: nombre, descripcionSugerida: tema }];
  }));
  const problemas = new Map([...textos].map(([id, t]) => [id, revisarTexto(t)]));
  const invalido = elegidas.some((c) => bloquea(problemas.get(c.id) ?? []));
  return (
    <section className="tarjeta space-y-4 p-4" aria-labelledby="publicar-titulo">
      <h2 id="publicar-titulo" className="font-medium">Publicar en redes</h2>
      {error && !datos && <Aviso tipo="error">{error}</Aviso>}
      {!datos && !error && <p className="text-sm text-tenue">Cargando cuentas…</p>}
      {datos && !datos.vpn.ok && <Aviso tipo="alerta">{textoVpn(datos.vpn)}. Se puede encolar: antes de subir, Geeper vuelve a medir y espera al VPN.</Aviso>}
      {datos && conectadas.length === 0 && (
        <p className="text-sm text-tenue">
          No hay cuentas conectadas que admitan el formato {render.perfil}. <Link className="text-acento hover:underline" href="/cuentas">Conectar una cuenta</Link>
        </p>
      )}
      {sinPermiso.length > 0 && (
        <p className="text-xs text-amber-300">
          {sinPermiso.map((c) => c.alias ?? c.usuario).join(", ")}: hay que reconectar{sinPermiso.length === 1 ? "la" : "las"} en <Link className="underline" href="/cuentas">Cuentas</Link>.
        </p>
      )}
      {conectadas.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="etiqueta">Cuentas compatibles con {render.perfil}</legend>
          {conectadas.map((c) => {
            const red = redes.get(c.red)!;
            const publicada = ya.has(c.id);
            return (
              <div key={c.id} className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!marcadas[c.id]} disabled={publicada} onChange={() => alternar(c)} />
                  <span className="font-medium">{red.nombre}</span>
                  <span>{c.alias ?? c.usuario}</span>
                  {c.alias && <span className="text-tenue">{c.usuario}</span>}
                  {publicada && <span className="text-xs text-tenue">(este render ya está en esta cuenta)</span>}
                </label>
                {marcadas[c.id] && <CamposDestino proyectoId={proyectoId} c={c} red={red} v={marcadas[c.id]!} cambiar={(v) => setMarcadas((m) => ({ ...m, [c.id]: v }))} portada={portada} perfil={render.perfil} texto={textos.get(c.id)!} problemas={problemas.get(c.id) ?? []} />}
              </div>
            );
          })}
        </fieldset>
      )}
      {hayPublico && licencia.length > 0 && (
        <Aviso tipo="alerta">
          <p className="font-medium">Aviso de licencia del QC antes de publicar en público:</p>
          <ul className="mt-1 list-disc pl-5">
            {licencia.map((g) => <li key={g.id}>{g.nombre}{g.detalle ? `: ${g.detalle}` : ""}</li>)}
          </ul>
          <p className="mt-1">Música o clips con licencia dudosa pueden disparar Content ID o silenciar el audio. Si dudas, publica en privado.</p>
        </Aviso>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      {conectadas.length > 0 && (
        <button type="button" className="boton boton-primario" disabled={enviando || elegidas.length === 0 || invalido} onClick={() => void publicar()}>
          {enviando ? "Encolando…" : `Publicar en ${elegidas.length} ${elegidas.length === 1 ? "cuenta" : "cuentas"}`}
        </button>
      )}
      {invalido && <p className="text-xs text-red-300" role="status">Arregla lo marcado con ✕ para poder publicar.</p>}
      <div className="space-y-2 border-t border-borde pt-3">
        <h3 className="text-sm font-medium">Publicaciones de este proyecto</h3>
        <ListaPublicaciones publicaciones={publicaciones} alCambiar={alCambiar} />
      </div>
    </section>
  );
}
