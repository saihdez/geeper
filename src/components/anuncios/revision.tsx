"use client";
import Link from "next/link";
import { useState } from "react";
import type { ResultadoChequeo } from "@/lib/anuncios/esquema";
import { nombreForma } from "@/lib/glosario";
import type { Chequeo, RevisionConcepto } from "@/lib/anuncios/revision";
import { Aviso } from "../comun";
import type { Ctx } from "./campana";
import { QUE } from "./textos";
import { BarraResumen, Contadores, NOMBRE_RESULTADO, Resultado, hoy } from "./ui";

const pendiente = (c: Chequeo) => c.estado === "fail" || c.estado === "unknown";

export function PestanaRevision({ ctx }: { ctx: Ctx }) {
  const [soloPendiente, setSoloPendiente] = useState(false);
  const { revision } = ctx;
  if (!revision.conceptos.length) {
    return (
      <div className="tarjeta mx-auto max-w-xl p-8 text-center">
        <p className="text-tenue">La revisión aparece cuando tengas ideas y sus videos.</p>
        <button className="boton boton-primario mt-4" onClick={() => ctx.irA("conceptos")}>Ir a Ideas</button>
      </div>
    );
  }
  const orden = ctx.conceptoActivo ? [...revision.conceptos].sort((a, b) => Number(b.conceptoId === ctx.conceptoActivo) - Number(a.conceptoId === ctx.conceptoActivo)) : revision.conceptos;
  return (
    <div className="space-y-4">
      <div className="tarjeta flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">{QUE.revision}</p>
          <BarraResumen r={revision.resumen} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soloPendiente} onChange={(e) => setSoloPendiente(e.target.checked)} />
          Sólo lo pendiente
        </label>
      </div>
      <LoQueFalta ctx={ctx} />
      <h3 className="pt-2 text-sm font-semibold text-tenue">Detalle por idea</h3>
      {orden.map((rc) => (
        <details key={rc.conceptoId} open={rc.conceptoId === ctx.conceptoActivo} className="group">
          <summary className="tarjeta flex cursor-pointer list-none items-center justify-between gap-3 p-3 group-open:rounded-b-none">
            <span className="flex items-center gap-2 font-medium"><span className="text-tenue transition-transform group-open:rotate-90" aria-hidden>›</span>{rc.nombre}</span>
            <Contadores r={rc.resumen} compacto />
          </summary>
          <TarjetaConcepto ctx={ctx} rc={rc} soloPendiente={soloPendiente} />
        </details>
      ))}
    </div>
  );
}

function TarjetaConcepto({ ctx, rc, soloPendiente }: { ctx: Ctx; rc: RevisionConcepto; soloPendiente: boolean }) {
  const [celda, setCelda] = useState<{ u: string; ch: string } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: React.ReactNode } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const listoYa = rc.resumen.fail === 0 && rc.resumen.unknown === 0;

  async function arreglar(ch: Chequeo) {
    if (!ch.arreglo) return;
    const formato = ch.arreglo.startsWith("formato:") ? ch.arreglo.slice(8) : undefined;
    if (formato && !confirm(`Cambiar la forma del video a ${nombreForma(formato)} hace que las ubicaciones de otra forma dejen de pasar. Para tener las dos, duplica la idea y vincula otro video. ¿Seguir?`)) return;
    setTrabajando(true);
    setAviso(null);
    try {
      const r = (await ctx.accion({ tipo: "preparar", concepto: rc.conceptoId, formato })) as { version: number | null; cambios: string[] };
      setAviso({
        tipo: "ok",
        texto: r.version ? (
          <>Versión {r.version} del proyecto: {r.cambios.join(", ")}. <Link className="underline" href={`/proyectos/${rc.proyecto?.id}`}>Crea el video de esta versión en el editor</Link> para que la revisión lo mida.</>
        ) : "El proyecto ya estaba así.",
      });
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setTrabajando(false);
    }
  }

  const filtrar = (cs: Chequeo[]) => (soloPendiente ? cs.filter(pendiente) : cs);
  const idsUbi = rc.ubicaciones[0]?.chequeos.map((c) => ({ id: c.id, nombre: c.nombre })) ?? [];
  const filasUbi = soloPendiente ? idsUbi.filter((f) => rc.ubicaciones.some((u) => u.chequeos.some((c) => c.id === f.id && pendiente(c)))) : idsUbi;
  const sel = celda ? rc.ubicaciones.find((u) => u.ubicacion.id === celda.u)?.chequeos.find((c) => c.id === celda.ch) : undefined;
  const selUbi = celda ? rc.ubicaciones.find((u) => u.ubicacion.id === celda.u)?.ubicacion : undefined;

  return (
    <section className="tarjeta overflow-hidden" aria-labelledby={`rev-${rc.conceptoId}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borde p-4">
        <div className="min-w-0">
          <h3 id={`rev-${rc.conceptoId}`} className="font-semibold">{rc.nombre}</h3>
          <p className="text-xs text-tenue">
            {rc.proyecto ? <Link className="hover:underline" href={`/proyectos/${rc.proyecto.id}`}>{rc.proyecto.nombre}</Link> : "Sin video"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Contadores r={rc.resumen} compacto />
          {listoYa ? <span className="rounded-md bg-emerald-800 px-2 py-0.5 text-xs font-semibold text-emerald-50">Listo</span> : null}
          <button className="boton" onClick={() => ctx.irA("conceptos", rc.conceptoId)}>Editar</button>
        </div>
      </header>
      <div className="grid gap-0 lg:grid-cols-2">
        <Lista titulo="Copy" chequeos={filtrar(rc.copy)} />
        <Lista titulo="Video" chequeos={filtrar(rc.video)} arreglar={arreglar} trabajando={trabajando} ctx={ctx} />
      </div>
      {aviso && <div className="px-4 pb-3"><Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso></div>}

      {rc.ubicaciones.length > 0 && filasUbi.length > 0 && (
        <div className="border-t border-borde p-4">
          <h4 className="mb-2 text-sm font-semibold">Por ubicación</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-panel py-1.5 pr-3 text-left font-normal text-tenue">Chequeo</th>
                  {rc.ubicaciones.map((u) => (
                    <th key={u.ubicacion.id} className="px-2 py-1.5 text-center text-xs font-medium text-slate-300">
                      {u.ubicacion.nombre}<span className="block font-normal text-tenue">{u.ubicacion.formato}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filasUbi.map((f) => (
                  <tr key={f.id}>
                    <th scope="row" className="sticky left-0 border-t border-borde bg-panel py-1.5 pr-3 text-left font-normal">{f.nombre.replace(/ \(categoría.*\)$/, "")}</th>
                    {rc.ubicaciones.map((u) => {
                      const ch = u.chequeos.find((c) => c.id === f.id)!;
                      const activa = celda?.u === u.ubicacion.id && celda.ch === f.id;
                      return (
                        <td key={u.ubicacion.id} className="border-t border-borde px-2 py-1.5 text-center">
                          <button
                            onClick={() => setCelda(activa ? null : { u: u.ubicacion.id, ch: f.id })}
                            className={`rounded-md p-0.5 ${activa ? "ring-2 ring-cyan-500" : "hover:ring-1 hover:ring-slate-500"}`}
                            aria-label={`${f.nombre} en ${u.ubicacion.nombre}: ${NOMBRE_RESULTADO[ch.estado]}${ch.clave ? " (editable)" : ""}`}
                            aria-expanded={activa}
                          >
                            <Resultado valor={ch.estado} corto />
                            {ch.clave && <span className="sr-only">editable</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-tenue">Toca una celda para ver la evidencia. Las verificaciones manuales se marcan ahí.</p>
          {sel && selUbi && (
            <Detalle key={`${celda!.u}:${celda!.ch}`} ctx={ctx} ch={sel} titulo={`${sel.nombre} · ${selUbi.nombre}`} arreglar={arreglar} trabajando={trabajando} />
          )}
        </div>
      )}
    </section>
  );
}

function Lista({ titulo, chequeos, arreglar, trabajando, ctx }: { titulo: string; chequeos: Chequeo[]; arreglar?: (c: Chequeo) => void; trabajando?: boolean; ctx?: Ctx }) {
  return (
    <div className="p-4 lg:border-r lg:border-borde lg:last:border-r-0">
      <h4 className="mb-2 text-sm font-semibold">{titulo}</h4>
      {chequeos.length === 0 ? (
        <p className="text-sm text-tenue">Nada pendiente.</p>
      ) : (
        <ul className="space-y-2.5">
          {chequeos.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Resultado valor={c.estado} corto />
              <div className="min-w-0 text-sm">
                <p className="font-medium">{c.nombre}</p>
                <p className="text-tenue">{c.evidencia}</p>
                {c.accion && pendiente(c) && <p className="mt-0.5 text-slate-300">→ {c.accion}</p>}
                {c.arreglo && arreglar && pendiente(c) && (
                  <button className="boton mt-1.5" disabled={trabajando} onClick={() => arreglar(c)}>
                    {c.arreglo === "preparar" ? "Preparar para anuncio" : `Pasar a ${c.arreglo.slice(8)}`}
                  </button>
                )}
                {c.clave && ctx && <EditorManual ctx={ctx} ch={c} compacto />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Detalle({ ctx, ch, titulo, arreglar, trabajando }: { ctx: Ctx; ch: Chequeo; titulo: string; arreglar: (c: Chequeo) => void; trabajando: boolean }) {
  return (
    <div className="mt-3 rounded-lg border border-cyan-900 bg-[#0f131a] p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{titulo}</p>
        <Resultado valor={ch.estado} />
      </div>
      <p className="mt-1 text-tenue">{ch.evidencia}</p>
      {ch.accion && pendiente(ch) && <p className="mt-1 text-slate-300">→ {ch.accion}</p>}
      {ch.fuente && (
        <a href={ch.fuente} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-acento hover:underline">Abrir la fuente oficial ↗</a>
      )}
      {ch.arreglo && pendiente(ch) && (
        <div className="mt-2">
          <button className="boton" disabled={trabajando} onClick={() => arreglar(ch)}>
            {ch.arreglo === "preparar" ? "Preparar para anuncio" : `Pasar a ${ch.arreglo.slice(8)}`}
          </button>
        </div>
      )}
      {ch.clave && <EditorManual ctx={ctx} ch={ch} />}
    </div>
  );
}

const OPCIONES: ResultadoChequeo[] = ["pass", "fail", "unknown", "not_applicable"];

/** Lo marca la persona: estado, evidencia (qué vio, dónde) y fecha. */
function EditorManual({ ctx, ch, compacto = false }: { ctx: Ctx; ch: Chequeo; compacto?: boolean }) {
  const clave = ch.clave!;
  const m = ctx.datos.manuales[clave];
  const guardar = (cambio: Partial<{ estado: ResultadoChequeo; evidencia: string }>) =>
    ctx.cambiar((d) => {
      const actual = d.manuales[clave] ?? { estado: "unknown" as ResultadoChequeo, evidencia: "", fecha: "" };
      const nuevo = { ...actual, ...cambio, fecha: hoy() };
      const manuales = { ...d.manuales };
      if (nuevo.estado === "unknown" && !nuevo.evidencia.trim()) delete manuales[clave];
      else manuales[clave] = nuevo;
      return { ...d, manuales };
    });
  return (
    <div className={compacto ? "mt-1.5 space-y-1.5" : "mt-3 space-y-2 border-t border-borde pt-3"}>
      <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-borde" role="radiogroup" aria-label="Resultado de la verificación">
        {OPCIONES.map((o) => (
          <button
            key={o}
            role="radio"
            aria-checked={(m?.estado ?? "unknown") === o}
            onClick={() => guardar({ estado: o })}
            className={`px-2.5 py-1 text-xs ${(m?.estado ?? "unknown") === o ? "bg-cyan-900 text-white" : "bg-[#0f131a] text-tenue hover:text-white"}`}
          >
            {NOMBRE_RESULTADO[o]}
          </button>
        ))}
      </div>
      <input
        className="campo text-sm"
        placeholder="Evidencia: qué viste y dónde (enlace a la vista previa, captura, página consultada)"
        value={m?.evidencia ?? ""}
        maxLength={500}
        onChange={(e) => guardar({ evidencia: e.target.value })}
        aria-label="Evidencia"
      />
      {m?.fecha && <p className="text-xs text-tenue">Anotado el {m.fecha}</p>}
    </div>
  );
}

interface Pendiente {
  clave: string;
  concepto: string;
  idea: string;
  donde: string;
  ch: Chequeo;
  orden: number;
}

/** Todo lo pendiente de la campaña en una lista corta y ordenada: primero lo que falla, luego lo que falta saber. */
function LoQueFalta({ ctx }: { ctx: Ctx }) {
  const items: Pendiente[] = [];
  for (const rc of ctx.revision.conceptos) {
    const add = (ch: Chequeo, donde: string) => {
      if (!pendiente(ch)) return;
      const orden = ch.estado === "fail" ? (ch.arreglo ? 0 : 1) : ch.clave ? 3 : 2;
      items.push({ clave: `${rc.conceptoId}:${donde}:${ch.id}`, concepto: rc.conceptoId, idea: rc.nombre, donde, ch, orden });
    };
    for (const ch of rc.copy) add(ch, "");
    // Sin video, todo lo demás depende de hacerlo: se muestra una sola tarea en vez de diez «sin saber».
    if (!rc.proyecto) {
      const v = rc.video.find((x) => x.id === "vinculado");
      if (v) add(v, "");
      continue;
    }
    for (const ch of rc.video) add(ch, "");
    for (const u of rc.ubicaciones) for (const ch of u.chequeos) add(ch, u.ubicacion.nombre);
  }
  items.sort((a, b) => a.orden - b.orden);
  if (!items.length) {
    return <Aviso tipo="ok">No falta nada: todas las ideas pasaron la revisión. Siguiente: «Comparar» y «Lanzar».</Aviso>;
  }
  // Las verificaciones manuales iguales (p. ej. «vista previa» en 4 lugares) se agrupan en una sola línea.
  const manuales = items.filter((i) => i.orden === 3);
  const resto = items.filter((i) => i.orden < 3);
  const grupos = new Map<string, Pendiente[]>();
  for (const m of manuales) grupos.set(m.ch.nombre, [...(grupos.get(m.ch.nombre) ?? []), m]);
  const visibles = resto.slice(0, 8);
  return (
    <section className="tarjeta p-4" aria-labelledby="lo-que-falta">
      <h3 id="lo-que-falta" className="font-semibold">Lo que falta, en orden</h3>
      <ol className="mt-3 space-y-2">
        {visibles.map((i, n) => (
          <li key={i.clave} className="flex flex-wrap items-start gap-3 rounded-lg border border-borde bg-[#0f131a] p-3 sm:flex-nowrap">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold tabular-nums">{n + 1}</span>
            <div className="min-w-0 flex-1 basis-48 text-sm">
              <p><span className="font-medium">{i.ch.nombre}</span> <span className="text-tenue">· {i.idea}{i.donde ? ` · ${i.donde}` : ""}</span></p>
              <p className="text-slate-300">{i.ch.accion ?? i.ch.evidencia}</p>
            </div>
            <Resultado valor={i.ch.estado} corto />
            <button className="boton ml-9 shrink-0 sm:ml-0" onClick={() => ctx.irA(i.ch.id === "vinculado" || i.ch.id === "cta" || i.ch.id === "distinto" || i.ch.id === "afirmaciones" || i.ch.id === "pruebas" ? "conceptos" : "revision", i.concepto)}>
              {i.ch.id === "vinculado" ? "Hacer video" : ["cta", "distinto"].includes(i.ch.id) ? "Editar idea" : ["afirmaciones", "pruebas"].includes(i.ch.id) ? "Revisar" : "Ver"}
            </button>
          </li>
        ))}
        {resto.length > visibles.length && <li className="text-sm text-tenue">…y {resto.length - visibles.length} más abajo, en el detalle de cada idea.</li>}
      </ol>
      {grupos.size > 0 && (
        <div className="mt-4 rounded-lg border border-borde p-3">
          <p className="text-sm font-medium">Para revisar tú en la plataforma de anuncios</p>
          <p className="mt-0.5 text-xs text-tenue">Geeper no puede ver tu cuenta. Cuando subas los videos, revisa esto y márcalo en el detalle de cada idea.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {[...grupos.entries()].map(([nombre, xs]) => (
              <li key={nombre} className="flex items-center justify-between gap-2">
                <span>{nombre}</span>
                <span className="text-xs text-tenue tabular-nums">{xs.length} pendiente{xs.length === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
