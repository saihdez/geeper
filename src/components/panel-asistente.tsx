"use client";
import { useEffect, useRef, useState } from "react";
import type { Recomendacion } from "@/lib/recomendaciones";
import { postJson, useSondeo } from "./comun";

const PRIORIDAD: Record<Recomendacion["prioridad"], { texto: string; clase: string }> = {
  bloquea: { texto: "Falta arreglar", clase: "bg-red-900 text-red-100" },
  mejora: { texto: "Mejora", clase: "bg-sky-800 text-sky-100" },
  idea: { texto: "Idea", clase: "bg-slate-700 text-slate-100" },
};
const VISIBLES = 3;

/**
 * «Asistente»: lo que mejoraría este video, de lo más urgente a lo opcional, con una acción cada cosa.
 * Las recomendaciones salen de src/lib/recomendaciones.ts (sin GPU). «Ahora no» se recuerda en este
 * navegador por proyecto.
 */
export function PanelAsistente({ proyectoId, version, ocupado, editarVarias, renderizar, alinearMusica, volverA }: {
  proyectoId: string;
  version: number;
  ocupado: boolean;
  editarVarias: (eds: object[]) => Promise<void>;
  renderizar: () => Promise<void>;
  alinearMusica: () => Promise<void>;
  /** Vuelve a una versión anterior (queda como versión nueva). */
  volverA: (numero: number) => Promise<void>;
}) {
  // La versión en la URL hace que se recalcule en cuanto se guarda un cambio.
  const { datos } = useSondeo<{ recomendaciones: Recomendacion[] }>(`/api/proyectos/${proyectoId}/asistente?v=${version}`, 15_000);
  const clave = `geeper:asistente:${proyectoId}`;
  // El panel no se pinta hasta tener datos (sólo en el navegador), así que leer aquí no desincroniza.
  const [descartadas, setDescartadas] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(clave) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [todas, setTodas] = useState(false);
  /** Lo último que se hizo desde aquí: si la versión subió, se ofrece deshacerlo. */
  const [hecho, setHecho] = useState<{ titulo: string; antes: number } | null>(null);
  /** Lo que la persona escribe en las recomendaciones con campo (p. ej. el gancho), por id. */
  const [escrito, setEscrito] = useState<Record<string, string>>({});
  /** Ideas de la IA local por recomendación (o el error en palabras simples). */
  const [ideas, setIdeas] = useState<Record<string, { cargando?: boolean; ganchos?: string[]; error?: string }>>({});
  const pedirIdeas = async (id: string, ruta: string) => {
    setIdeas((x) => ({ ...x, [id]: { cargando: true } }));
    try {
      const r = await postJson<{ ganchos: string[] }>(`/api/proyectos/${proyectoId}/${ruta}`, {});
      setIdeas((x) => ({ ...x, [id]: { ganchos: r.ganchos } }));
    } catch (e) {
      setIdeas((x) => ({ ...x, [id]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  };
  const descartar = (id: string) => {
    const nuevas = [...new Set([...descartadas, id])];
    setDescartadas(nuevas);
    localStorage.setItem(clave, JSON.stringify(nuevas));
  };
  const restaurar = () => {
    setDescartadas([]);
    localStorage.removeItem(clave);
  };

  // Desde «Lo siguiente» de Inicio se llega con #asistente-titulo: el panel aparece después de traer los
  // datos, así que el navegador no alcanza a bajar solo.
  const bajado = useRef(false);
  const hayDatos = !!datos;
  useEffect(() => {
    if (!hayDatos || bajado.current) return;
    bajado.current = true;
    if (location.hash === "#asistente-titulo") document.getElementById("asistente-titulo")?.scrollIntoView({ block: "start" });
  }, [hayDatos]);

  if (!datos) return null;
  const lista = datos.recomendaciones.filter((r) => !descartadas.includes(r.id));
  const ocultas = datos.recomendaciones.length - lista.length;
  const mostradas = todas ? lista : lista.slice(0, VISIBLES);

  const aplicar = (titulo: string, eds: object[]) => {
    setHecho({ titulo, antes: version });
    return editarVarias(eds);
  };
  /** Las ediciones con lo escrito en lugar de `{texto}` (se reemplaza en los textos, no en el JSON crudo). */
  const conTexto = (eds: object[], texto: string): object[] =>
    JSON.parse(JSON.stringify(eds), (_k, v: unknown) => (typeof v === "string" ? v.replaceAll("{texto}", texto) : v)) as object[];
  const hacer = async (r: Recomendacion) => {
    if (r.ediciones?.length || r.accion === "alinearMusica") setHecho({ titulo: `«${r.titulo}»`, antes: version });
    if (r.ediciones?.length) return editarVarias(r.ediciones);
    if (r.accion === "renderizar") return renderizar();
    if (r.accion === "alinearMusica") return alinearMusica();
  };
  /** Lleva a la parte de la página y la marca un momento, para que se vea dónde hay que mirar. */
  const irA = (e: React.MouseEvent, destino: string) => {
    if (!destino.startsWith("#")) return;
    const el = document.querySelector<HTMLElement>(destino);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", destino);
    el.classList.add("ring-2", "ring-sky-400", "rounded-lg");
    setTimeout(() => el.classList.remove("ring-2", "ring-sky-400", "rounded-lg"), 2500);
  };
  const deshacible = hecho && version > hecho.antes ? hecho : null;

  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="asistente-titulo">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="asistente-titulo" className="font-medium">Asistente: lo que mejoraría este video</h2>
        <span className="text-xs text-tenue">
          {lista.length ? `${lista.length} ${lista.length === 1 ? "sugerencia" : "sugerencias"}, de lo más urgente a lo opcional` : "Nada pendiente"}
        </span>
      </div>
      {deshacible && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-sm" role="status">
          <span>Hecho: {deshacible.titulo}. Ya se ve en la vista previa «En vivo».</span>
          <button type="button" className="boton ml-auto py-1 text-sm" disabled={ocupado}
            onClick={() => void volverA(deshacible.antes).then(() => setHecho(null))}>Deshacer</button>
          <button type="button" className="boton py-1 text-sm" onClick={() => setHecho(null)}>Listo</button>
        </div>
      )}
      {!lista.length && <p className="text-sm text-tenue">No vemos nada que mejorar ahora mismo. Si cambias algo, lo volvemos a revisar.</p>}
      <ul className="space-y-2">
        {mostradas.map((r) => {
          const pr = PRIORIDAD[r.prioridad];
          const puedeHacer = !!(r.ediciones?.length || r.accion);
          return (
            <li key={r.id} className="rounded border border-borde p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${pr.clase}`}>{pr.texto}</span>
                <span className="font-medium">{r.titulo}</span>
                {r.efecto && <span className="text-xs text-emerald-300">{r.efecto}</span>}
                {r.gpu && <span className="text-xs text-amber-300" title="Esa herramienta usa la tarjeta gráfica: va por la cola y te pide confirmar">usa la tarjeta gráfica</span>}
              </div>
              <p className="mt-1 text-sm text-tenue">{r.porque}</p>
              {r.tecnico && (
                <details className="mt-1 text-xs text-tenue">
                  <summary className="cursor-pointer">Detalle técnico</summary>
                  <p className="mt-1 break-words font-mono">{r.tecnico}</p>
                </details>
              )}
              {r.escribir && (() => {
                const esc = r.escribir;
                const texto = (escrito[r.id] ?? "").trim();
                return (
                  <form className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(ev) => { ev.preventDefault(); if (texto) void aplicar(`Pusiste «${texto}» al inicio`, conTexto(esc.ediciones, texto)); }}>
                    <label className="grow text-sm">
                      <span className="etiqueta">{esc.etiqueta}</span>
                      <input className="campo w-full" value={escrito[r.id] ?? ""} maxLength={esc.max} placeholder={`Por ejemplo: ${esc.ejemplo}`}
                        onChange={(ev) => setEscrito({ ...escrito, [r.id]: ev.target.value })} />
                    </label>
                    <button type="submit" className="boton boton-primario py-1 text-sm" disabled={ocupado || !texto}>Ponerlo en el video</button>
                    {esc.sugerir && (
                      <button type="button" className="boton py-1 text-sm" disabled={ideas[r.id]?.cargando}
                        title="La IA de tu PC lee lo que dice el video y propone 3. Usa la tarjeta gráfica unos segundos."
                        onClick={() => void pedirIdeas(r.id, esc.sugerir!)}>
                        {ideas[r.id]?.cargando ? "Pensando… (hasta 1 min)" : ideas[r.id]?.ganchos ? "Otras 3 ideas" : "✨ Sugiéreme 3"}
                      </button>
                    )}
                    {esc.sugerir && !ideas[r.id] && <p className="w-full text-xs text-tenue">«Sugiéreme 3» usa la IA de tu PC y la tarjeta gráfica unos segundos.</p>}
                    {ideas[r.id]?.error && <p className="w-full text-xs text-red-300" role="alert">{ideas[r.id]!.error}</p>}
                    {ideas[r.id]?.ganchos && (
                      <div className="flex w-full flex-wrap items-center gap-2 text-sm" role="group" aria-label="Ideas de gancho">
                        <span className="text-xs text-tenue">Elige una (puedes cambiarla antes de ponerla):</span>
                        {ideas[r.id]!.ganchos!.map((g) => (
                          <button key={g} type="button" className={`rounded border px-2 py-1 ${texto === g ? "border-sky-400 bg-sky-950/50" : "border-borde hover:bg-white/5"}`}
                            onClick={() => setEscrito({ ...escrito, [r.id]: g })}>{g}</button>
                        ))}
                      </div>
                    )}
                  </form>
                );
              })()}
              {r.opciones && (
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={r.titulo}>
                  {r.opciones.map((o) => (
                    <button key={o.etiqueta} type="button" className="boton py-1 text-sm" disabled={ocupado}
                      onClick={() => void aplicar(`elegiste ${o.etiqueta}`, o.ediciones)}>{o.etiqueta}</button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {puedeHacer && (
                  <button type="button" className="boton boton-primario py-1 text-sm" disabled={ocupado} onClick={() => void hacer(r)}>
                    {r.accion === "renderizar" ? "Armar el video" : r.accion === "alinearMusica" ? "Alinear al ritmo" : "Hacerlo"}
                  </button>
                )}
                {r.ir && <a className="boton py-1 text-sm" href={r.ir} onClick={(e) => irA(e, r.ir!)}>{puedeHacer || r.opciones || r.escribir ? "Ver dónde" : "Ir ahí"}</a>}
                {r.prioridad !== "bloquea" && r.area !== "flujo" && <button type="button" className="boton py-1 text-sm" onClick={() => descartar(r.id)}>Ahora no</button>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3 text-xs">
        {lista.length > VISIBLES && (
          <button type="button" className="text-acento hover:underline" onClick={() => setTodas(!todas)}>
            {todas ? "Ver sólo las más importantes" : `Ver las ${lista.length}`}
          </button>
        )}
        {ocultas > 0 && <button type="button" className="text-tenue hover:underline" onClick={restaurar}>Mostrar las {ocultas} que dejaste para después</button>}
        <span className="text-tenue">Todo cambio queda como versión nueva: puedes volver atrás en «Historial».</span>
      </div>
    </section>
  );
}
