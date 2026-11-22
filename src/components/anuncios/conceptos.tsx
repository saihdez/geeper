"use client";
import Link from "next/link";
import { useState } from "react";
import { MARCOS, ubicacion } from "@/lib/anuncios/catalogo";
import { Concepto, type Concepto as ConceptoT } from "@/lib/anuncios/esquema";
import { Aviso, Estado, useSondeo } from "../comun";
import type { Ctx } from "./campana";
import { BotonIdeas } from "./guia";
import { TablaVariantes } from "./tabla-variantes";
import { QUE } from "./textos";
import { Ayuda, Campo, Chip, Contadores, nuevoId } from "./ui";

/** Palabras por segundo de una voz de locución en español a velocidad 1 (estimación). */
const PALABRAS_POR_SEGUNDO = 2.5;

function nuevo(n: number, principal: ConceptoT["principal"]): ConceptoT {
  return Concepto.parse({ id: nuevoId("c"), nombre: `Idea ${n}`, principal });
}

export function PestanaConceptos({ ctx }: { ctx: Ctx }) {
  const { datos } = ctx;
  const activo = datos.conceptos.find((c) => c.id === ctx.conceptoActivo) ?? datos.conceptos[0] ?? null;

  function agregar(base?: ConceptoT) {
    const principal = datos.brief.ubicaciones[0] ?? "youtube-shorts";
    const c = base
      ? { ...structuredClone(base), id: nuevoId("c"), nombre: `${base.nombre} (copia)`.slice(0, 80), proyectoId: null }
      : nuevo(datos.conceptos.length + 1, principal);
    ctx.cambiar((d) => ({ ...d, conceptos: [...d.conceptos, c] }));
    ctx.setConceptoActivo(c.id);
  }

  if (!datos.conceptos.length) {
    return (
      <div className="tarjeta mx-auto max-w-xl space-y-4 p-8 text-center">
        <h2 className="text-lg font-semibold">Todavía no tienes ideas</h2>
        <p className="text-sm text-tenue">
          Cada idea es un video con su propio comienzo y su mensaje. Conviene tener dos o tres bien distintas para comparar cuál funciona mejor.
        </p>
        <div className="mx-auto max-w-sm space-y-2 text-left">
          <BotonIdeas ctx={ctx} primario ancho texto="Propónme 3 ideas" />
          <button className="boton w-full justify-center" onClick={() => agregar()}>Escribir una idea yo</button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
      <aside className="space-y-2">
        <ul className="space-y-2" aria-label="Ideas">
          {datos.conceptos.map((c) => {
            const r = ctx.revision.conceptos.find((x) => x.conceptoId === c.id);
            const sel = activo?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  onClick={() => ctx.setConceptoActivo(c.id)}
                  aria-current={sel}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${sel ? "border-cyan-700 bg-cyan-950/30" : "border-borde bg-panel hover:border-slate-600"}`}
                >
                  <p className="truncate font-medium">{c.nombre}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-tenue">{c.gancho || "Falta cómo empieza"}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {r && <Contadores r={r.resumen} compacto />}
                    <span className={`text-xs ${c.proyectoId ? "text-emerald-300" : "text-tenue"}`}>{c.proyectoId ? "● con video" : "○ sin video"}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <button className="boton w-full justify-center" onClick={() => agregar()} disabled={datos.conceptos.length >= 30}>+ Escribir una idea</button>
        <BotonIdeas ctx={ctx} ancho texto="Propónme más ideas" />
      </aside>
      {activo && <Editor key={activo.id} ctx={ctx} c={activo} duplicar={() => agregar(activo)} />}
    </div>
  );
}

function Editor({ ctx, c, duplicar }: { ctx: Ctx; c: ConceptoT; duplicar: () => void }) {
  const { datos } = ctx;
  const set = <K extends keyof ConceptoT>(k: K, v: ConceptoT[K]) =>
    ctx.cambiar((d) => ({ ...d, conceptos: d.conceptos.map((x) => (x.id === c.id ? { ...x, [k]: v } : x)) }));
  const marco = MARCOS[c.marco] ?? MARCOS.ninguno!;
  const palabras = c.guion.trim() ? c.guion.trim().split(/\s+/).length : 0;
  const segundos = palabras / PALABRAS_POR_SEGUNDO;
  const rc = ctx.revision.conceptos.find((x) => x.conceptoId === c.id);
  const ubisBrief = datos.brief.ubicaciones;
  const propias = c.ubicaciones.length ? c.ubicaciones : ubisBrief;
  const borradorIa = c.nombre.startsWith("Idea: ") && c.hipotesis.startsWith("Borrador del modelo local");

  function quitar() {
    if (!confirm(`¿Borrar la idea «${c.nombre}»? Su video (si tiene) no se borra.`)) return;
    ctx.cambiar((d) => ({
      ...d,
      conceptos: d.conceptos.filter((x) => x.id !== c.id),
      manuales: Object.fromEntries(Object.entries(d.manuales).filter(([k]) => !k.startsWith(`${c.id}:`))),
    }));
    ctx.setConceptoActivo(null);
  }

  const alternarUbi = (id: ConceptoT["principal"]) => {
    const actual = new Set(propias);
    if (actual.has(id)) actual.delete(id);
    else actual.add(id);
    const lista = ubisBrief.filter((u) => actual.has(u));
    set("ubicaciones", lista.length === ubisBrief.length ? [] : lista);
  };

  return (
    <div className="space-y-4">
      <div className="tarjeta flex flex-wrap items-center gap-3 p-4">
        <input className="campo min-w-0 flex-1 basis-full text-base font-semibold sm:basis-auto" value={c.nombre} maxLength={80} onChange={(e) => set("nombre", e.target.value || "Sin nombre")} aria-label="Nombre de la idea" />
        {rc && <button className="text-left" onClick={() => ctx.irA("revision", c.id)} title="Ver la revisión"><Contadores r={rc.resumen} compacto /></button>}
        <button className="boton" onClick={duplicar} title="Copia para probar otra versión">Copiar</button>
        <button className="boton boton-peligro" onClick={quitar}>Borrar</button>
      </div>
      {borradorIa && <Aviso tipo="info">Borrador del asistente. Léelo en voz alta: cambia lo que no suene a tu marca y revisa que todo lo que dice sea cierto.</Aviso>}

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <section className="tarjeta space-y-4 p-4">
            <Campo etiqueta="Cómo empieza (el gancho)" que={QUE.gancho} contador={{ n: c.gancho.length, max: 200 }}>
              <input className="campo text-base" value={c.gancho} maxLength={200} onChange={(e) => set("gancho", e.target.value)} placeholder="Ej.: ¿Tu café de la mañana sabe a nada?" />
            </Campo>
            <div>
              <div className="etiqueta flex flex-wrap items-baseline justify-between gap-2">
                <span><label htmlFor={`guion-${c.id}`}>Lo que dice la voz (guion)</label><Ayuda texto={QUE.guion} de="guion" /></span>
                <span className="tabular-nums">{palabras} palabras · ~{Math.round(segundos)} s</span>
              </div>
              <textarea
                id={`guion-${c.id}`}
                className="campo min-h-44 text-base leading-relaxed"
                value={c.guion}
                maxLength={4000}
                onChange={(e) => set("guion", e.target.value)}
                placeholder="Empieza con el gancho, cuenta el beneficio en 2 o 3 frases cortas y termina diciendo qué hacer. Ej.: «¿Tu café sabe a nada? El nuestro se tuesta la semana en que lo pides. Pide tu primera bolsa.»"
              />
              {palabras > 0 && segundos > 45 && <p className="mt-1 text-xs text-amber-300">Más de 45 segundos: en redes, los anuncios cortos (15–30 s) suelen verse completos más veces. Prueba a recortar.</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Qué le pides al final" que={QUE.cta}>
                <input className="campo" value={c.cta} maxLength={120} onChange={(e) => set("cta", e.target.value)} placeholder="Ej.: Pide tu primera bolsa" />
              </Campo>
              <Campo etiqueta="Dónde se verá sobre todo" que={QUE.principal}>
                <select className="campo" value={c.principal} onChange={(e) => set("principal", e.target.value as ConceptoT["principal"])}>
                  {(ubisBrief.includes(c.principal) ? ubisBrief : [c.principal, ...ubisBrief]).map((u) => <option key={u} value={u}>{ubicacion(u)?.nombre} · {ubicacion(u)?.formato}</option>)}
                </select>
              </Campo>
            </div>
          </section>

          <details className="tarjeta group p-4">
            <summary className="cursor-pointer select-none font-semibold">
              Más detalle <span className="font-normal text-tenue">(opcional: ayuda a pensar la idea y a revisarla)</span>
            </summary>
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Por qué le importaría a tu cliente" que={QUE.insight}>
                  <textarea className="campo min-h-20" value={c.insight} maxLength={600} onChange={(e) => set("insight", e.target.value)} />
                </Campo>
                <Campo etiqueta="Beneficio principal" que={QUE.promesa}>
                  <textarea className="campo min-h-20" value={c.promesa} maxLength={300} onChange={(e) => set("promesa", e.target.value)} />
                </Campo>
              </div>
              <Campo etiqueta="Datos de «Tu negocio» que usa esta idea" que={QUE.afirmaciones}>
                {datos.brief.afirmaciones.length === 0 ? (
                  <p className="text-sm text-tenue">Todavía no anotaste datos en «Tu negocio».</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {datos.brief.afirmaciones.map((a) => (
                      <Chip key={a.id} activo={c.pruebas.includes(a.id)} onClick={() => set("pruebas", c.pruebas.includes(a.id) ? c.pruebas.filter((x) => x !== a.id) : [...c.pruebas, a.id])} titulo={a.prueba}>
                        <span aria-hidden>{a.aprobada ? "✓" : "⏳"}</span>
                        <span className="max-w-[16rem] truncate">{a.texto || "(sin texto)"}</span>
                      </Chip>
                    ))}
                  </div>
                )}
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Cómo avanza el video" ayuda="Escena por escena.">
                  <textarea className="campo min-h-20" value={c.narrativa} maxLength={1500} onChange={(e) => set("narrativa", e.target.value)} />
                </Campo>
                <Campo etiqueta="Dudas del cliente que responde">
                  <textarea className="campo min-h-20" value={c.objeciones} maxLength={600} onChange={(e) => set("objeciones", e.target.value)} />
                </Campo>
              </div>
              <Campo etiqueta="Qué esperas que pase" que={QUE.hipotesis}>
                <input className="campo" value={c.hipotesis} maxLength={400} onChange={(e) => set("hipotesis", e.target.value)} />
              </Campo>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Campo etiqueta="Forma de ordenar el mensaje" que={QUE.marco}>
                    <select className="campo" value={c.marco} onChange={(e) => set("marco", e.target.value as ConceptoT["marco"])}>
                      {Object.entries(MARCOS).map(([k, v]) => <option key={k} value={k}>{v.nombre}</option>)}
                    </select>
                  </Campo>
                  {marco.preguntas.length > 0 && (
                    <>
                      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">{marco.preguntas.map((q) => <li key={q}>{q}</li>)}</ol>
                      <p className="rounded-md border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-200"><b>Cuidado con:</b> {marco.riesgos}</p>
                    </>
                  )}
                </div>
                <div>
                  <span className="etiqueta">También se muestra en</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ubisBrief.map((u) => <Chip key={u} activo={propias.includes(u)} onClick={() => alternarUbi(u)}>{ubicacion(u)?.nombre}</Chip>)}
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>

        <div className="space-y-4">
          <VideoDelConcepto ctx={ctx} c={c} />
        </div>
      </div>
    </div>
  );
}

interface ProyectoLista { id: string; nombre: string; formato: string; estado: string }

function VideoDelConcepto({ ctx, c }: { ctx: Ctx; c: ConceptoT }) {
  const rc = ctx.revision.conceptos.find((x) => x.conceptoId === c.id);
  const p = rc?.proyecto ?? null;
  const [modo, setModo] = useState<"nada" | "generar" | "vincular">("nada");
  const [acepto, setAcepto] = useState(false);
  const [elegido, setElegido] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = ubicacion(c.principal);

  async function correr(cuerpo: Record<string, unknown>): Promise<boolean> {
    setOcupado(true);
    setError(null);
    try {
      await ctx.accion(cuerpo);
      setModo("nada");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta space-y-3 p-4">
      <h3 className="font-semibold">Video</h3>
      {c.proyectoId && p ? (
        <>
          <div className="rounded-lg border border-borde bg-[#0f131a] p-3">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/proyectos/${p.id}`} className="font-medium text-acento hover:underline">{p.nombre}</Link>
              <Estado valor={p.estado} />
            </div>
            <p className="mt-1 text-xs text-tenue">{p.formato} · versión {p.versionActual}{p.ocupado ? " · trabajando…" : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/proyectos/${p.id}`} className="boton">Abrir el video</Link>
            <button className="boton" disabled={ocupado} onClick={() => confirm("¿Quitar este video de la idea? El video no se borra.") && void correr({ tipo: "vincular", concepto: c.id, proyecto: null })}>Quitar video</button>
          </div>
          <VarianteGancho c={c} ocupado={ocupado} correr={correr} />
          <TablaVariantes ctx={ctx} c={c} />
        </>
      ) : c.proyectoId ? (
        <Aviso tipo="alerta">
          El proyecto vinculado ya no existe.{" "}
          <button className="underline" onClick={() => void correr({ tipo: "vincular", concepto: c.id, proyecto: null })}>Desvincular</button>
        </Aviso>
      ) : (
        <>
          <p className="text-sm text-tenue">Geeper hace el video con tu guion ({u?.formato ?? "9:16"}, para {u?.nombre}). Si ya tienes uno hecho en Geeper, puedes usarlo.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={modo === "generar"} className="opcion" onClick={() => setModo(modo === "generar" ? "nada" : "generar")}>Hacer el video</button>
            <button type="button" aria-pressed={modo === "vincular"} className="opcion" onClick={() => setModo(modo === "vincular" ? "nada" : "vincular")}>Usar uno que ya tengo</button>
          </div>
          {modo === "generar" && (
            <div className="space-y-2">
              {c.guion.trim().length < 20 ? (
                <Aviso tipo="alerta">Primero escribe el guion: es lo que va a decir la voz.</Aviso>
              ) : (
                <Aviso tipo="alerta">
                  <p className="font-medium">Hacer el video tarda unos 3 minutos y usa la tarjeta de video.</p>
                  <p className="mt-1">Windows se ha reiniciado sin aviso durante generaciones: guarda tu trabajo antes. Si se corta, el trabajo queda «interrumpido» y lo relanzas desde Trabajos.</p>
                  <label className="mt-2 flex items-center gap-2">
                    <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
                    Guardé mi trabajo; puedo generar.
                  </label>
                </Aviso>
              )}
              <button className="boton boton-primario w-full justify-center" disabled={!acepto || ocupado || c.guion.trim().length < 20} onClick={() => void correr({ tipo: "generar", concepto: c.id })}>
                {ocupado ? "Empezando…" : "Hacer el video con este guion"}
              </button>
            </div>
          )}
          {modo === "vincular" && (
            <div className="space-y-2">
              <SelectorProyecto valor={elegido} onCambio={setElegido} />
              <button className="boton boton-primario w-full justify-center" disabled={!elegido || ocupado} onClick={() => void correr({ tipo: "vincular", concepto: c.id, proyecto: elegido })}>Vincular</button>
            </div>
          )}
        </>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </section>
  );
}

function SelectorProyecto({ valor, onCambio }: { valor: string; onCambio: (id: string) => void }) {
  const { datos } = useSondeo<{ proyectos: ProyectoLista[] }>("/api/proyectos", 15000);
  return (
    <select className="campo" value={valor} onChange={(e) => onCambio(e.target.value)} aria-label="Proyecto a vincular">
      <option value="">{datos ? "Elige un proyecto…" : "Cargando proyectos…"}</option>
      {datos?.proyectos.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {x.formato}</option>)}
    </select>
  );
}

/** El mismo video con otra primera escena: voz nueva en CPU + render, sin GPU. */
function VarianteGancho({ c, ocupado, correr }: { c: ConceptoT; ocupado: boolean; correr: (cuerpo: Record<string, unknown>) => Promise<boolean> }) {
  const [abierto, setAbierto] = useState(false);
  const [gancho, setGancho] = useState("");
  if (!abierto) {
    return (
      <button className="boton w-full justify-center" onClick={() => setAbierto(true)} title="Probar otro gancho sin regenerar el video">
        + Probar otro comienzo
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-borde bg-[#0f131a] p-3">
      <p className="text-sm font-medium">Probar otro comienzo</p>
      <p className="text-xs text-tenue">
        Hace una copia del video que sólo cambia lo que se dice al principio, para comparar qué comienzo funciona mejor. Tarda un par de minutos y no usa la tarjeta de video. Aparece como una idea nueva.
      </p>
      <textarea className="campo min-h-16" value={gancho} maxLength={300} onChange={(e) => setGancho(e.target.value)} placeholder={c.gancho ? `Distinto de: «${c.gancho}»` : "Nuevo gancho (lo que dice la primera escena)"} aria-label="Nuevo gancho" />
      <div className="flex gap-2">
        <button className="boton boton-primario" disabled={ocupado || gancho.trim().length < 3} onClick={() => void correr({ tipo: "variante", concepto: c.id, gancho }).then((ok) => { if (ok) { setGancho(""); setAbierto(false); } })}>
          {ocupado ? "Creando…" : "Crear la copia"}
        </button>
        <button className="boton" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </div>
  );
}
