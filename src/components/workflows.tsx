"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Aviso, AvisoTarjeta, Barra, LineaFalta, archivo, faltanConGuardar, pedir, postJson, useGuardeAntes, useSondeo } from "./comun";
import { textoEspera, useMotorVivo } from "./motor";
import { avisoDescarga, coincideBusqueda, entradasSinArchivo, iconoDeTipo, LIGERA, textoFaltaArchivo, textoGb, tipoMiniatura, tuArchivo } from "@/lib/workflows-texto";

interface WfV { id: string; titulo: string; original?: string | null; descripcion: string; categoria: string; tipo: string; etiquetas: string[]; modelos: string[]; tamano: number; local: boolean; bloqueo: string | null; aviso: string | null; comunidad: boolean; entradas: number; uso: number; fecha: string | null; miniaturas: string[] }
interface CorridaV { id: string; workflow: string; titulo: string; creada: string; estado: "preparada" | "hecha" | "fallida"; salidas: { archivo: string; tipo: string }[]; segundos?: number; error?: string; trabajo: string | null; cancelada?: boolean }
interface TrabajoV { id: string; estado: string; etapa: string; progreso: number; corrida: string | null; workflow: string | null }
interface Datos { comfy: { listo: boolean; falta: string | null; instalando: boolean; disponible: boolean; aMedias?: boolean; detalle?: string }; workflows: WfV[]; corridas: CorridaV[]; trabajos: TrabajoV[] }
interface Detalle {
  workflow: WfV & { miniaturas: string[] };
  textos: { nodo: string; indice: number; etiqueta: string; valor: string; experto?: boolean }[];
  notas: string[];
  modelos: { nombre: string; carpeta: string; listo: boolean }[];
  faltan: number;
  /** Bytes que faltan bajar (aprox.) y los libres en el disco (UX-36). */
  porBajar: number;
  libre: number | null;
  nodos: { id: string; nombre: string; version: string | null; autor: string; repo: string; licencia: string; megas: number; motivo: string | null; instalado: boolean; permitido: boolean }[];
  entradas: { nodo: number; tipo: string; archivo: string | null; medio: string; ejemplo: string | null }[];
}

const gb = textoGb;
const MEDIO: Record<string, string> = { image: "una imagen", video: "un video", audio: "un audio" };
const ACEPTA: Record<string, string> = { image: ".png,.jpg,.jpeg,.webp", video: ".mp4,.mov,.webm", audio: ".wav,.mp3,.flac,.m4a,.ogg" };
type Filtro = "ligeras" | "local" | "todos" | "pago";
/** Corre en esta PC y baja menos de 10 GB: con lo que se abre la galería (UX-36). */
const esLigera = (w: { local: boolean; tamano: number }) => w.local && w.tamano < LIGERA;
const enFiltro = (w: { local: boolean; tamano: number }, f: Filtro) => (f === "ligeras" ? esLigera(w) : f === "local" ? w.local : f === "pago" ? !w.local : true);

/** Workflows: el catálogo de recetas de ComfyUI, para usar sin saber de nodos. */
export function PaginaWorkflows() {
  const { datos, error, recargar } = useSondeo<Datos>("/api/workflows", 4000);
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState("Todas");
  const [filtro, setFiltro] = useState<Filtro>("ligeras");
  const [cuantos, setCuantos] = useState(48);
  const [abierto, setAbierto] = useState<string | null>(null);
  const detalleRef = useRef<HTMLDivElement>(null);

  const lista = useMemo(() => {
    return (datos?.workflows ?? [])
      .filter((w) => enFiltro(w, filtro))
      .filter((w) => categoria === "Todas" || w.categoria === categoria)
      .filter((w) => coincideBusqueda(w, buscar))
      // En «Ligeras», las más livianas primero; en las demás, las más usadas.
      .sort((a, b) => Number(!!a.bloqueo) - Number(!!b.bloqueo) || Number(!!a.aviso) - Number(!!b.aviso) || (filtro === "ligeras" ? a.tamano - b.tamano : 0) || b.uso - a.uso);
  }, [datos, buscar, categoria, filtro]);
  const categorias = useMemo(() => {
    const c = new Map<string, number>();
    for (const w of datos?.workflows ?? []) if (enFiltro(w, filtro)) c.set(w.categoria, (c.get(w.categoria) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [datos, filtro]);

  useEffect(() => {
    if (abierto) detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [abierto]);

  if (error && !datos) return <Aviso tipo="error">{error}</Aviso>;
  if (!datos) return <p className="text-tenue">Cargando…</p>;
  const total = datos.workflows.length;
  const locales = datos.workflows.filter((w) => w.local).length;
  const ligeras = datos.workflows.filter(esLigera).length;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <p className="text-sm text-tenue">
          Recetas listas de ComfyUI para crear imágenes, videos, música, voces y 3D. Elige una, escribe lo que quieres o sube tu archivo, y Geeper hace el resto
          en esta computadora. Cada receta baja sus modelos la primera vez que la usas.
        </p>
      </header>

      {!datos.comfy.listo ? (
        <Instalar comfy={datos.comfy} alTerminar={() => void recargar()} />
      ) : (
        <>
          <Resultados corridas={datos.corridas} trabajos={datos.trabajos} cambio={() => void recargar()} />
          <div ref={detalleRef}>{abierto && <Detalle id={abierto} cerrar={() => setAbierto(null)} creado={() => void recargar()} />}</div>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input className="campo max-w-sm" type="search" placeholder="Buscar: retrato, música, quitar fondo, video…" value={buscar} onChange={(ev) => { setBuscar(ev.target.value); setCuantos(48); }} aria-label="Buscar workflows" />
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Qué workflows mostrar">
                {([["ligeras", `Ligeras, menos de 10 GB (${ligeras}) · recomendado`], ["local", `Corren en tu PC (${locales})`], ["todos", `Todos (${total})`], ["pago", `De pago (${total - locales})`]] as const).map(([id, n]) => (
                  <button key={id} role="radio" aria-checked={filtro === id} type="button" className="opcion text-xs" onClick={() => { setFiltro(id); setCategoria("Todas"); setCuantos(48); }}>{n}</button>
                ))}
              </div>
            </div>
            {filtro === "ligeras" && <p className="text-xs text-tenue">Las que bajan poco y suelen caber en tu tarjeta de video, de la más liviana a la más pesada. Las demás están en «Corren en tu PC».</p>}
            {(filtro === "todos" || filtro === "pago") && <p className="text-xs text-tenue">Los de pago usan servicios de la nube de Comfy que cobran por uso: aparecen para que los conozcas, pero están bloqueados porque Geeper funciona gratis.</p>}
            <div className="flex flex-wrap gap-1">
              {[["Todas", lista.length] as const, ...categorias].map(([c, n]) => (
                <button key={c} type="button" aria-pressed={categoria === c} className="opcion rounded-full text-xs" onClick={() => { setCategoria(c); setCuantos(48); }}>
                  {c}{c !== "Todas" ? ` · ${n}` : ""}
                </button>
              ))}
            </div>
            {lista.length === 0 ? (
              <p className="text-sm text-tenue">No hay recetas con esa búsqueda. Prueba con menos palabras o con otras (por ejemplo «retrato», «música», «voz» o «quitar fondo»).</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {lista.slice(0, cuantos).map((w) => (
                  <button key={w.id} type="button" aria-pressed={abierto === w.id} onClick={() => setAbierto(w.id)} className="opcion-tarjeta overflow-hidden">
                    <div className="relative aspect-video bg-slate-800">
                      <Miniatura key={w.id} urls={w.miniaturas} tipo={w.tipo} apagada={!!w.bloqueo} />
                      {!w.local && <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px]">🔒 De pago</span>}
                    </div>
                    <div className="space-y-1 p-2">
                      <p className="line-clamp-2 text-sm font-medium">{w.titulo}</p>
                      {w.original && <p className="line-clamp-1 text-[11px] text-tenue" lang="en">{w.original}</p>}
                      <p className="text-[11px] text-tenue">
                        {w.local ? (w.bloqueo ? "Código de la comunidad no disponible" : w.aviso ? "Experimental" : w.comunidad ? `${w.categoria} · usa código de la comunidad` : `${w.categoria}${w.tamano ? ` · baja ${gb(w.tamano)}` : ""}`) : "Nube de pago · bloqueado"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {lista.length > cuantos && <button className="boton" onClick={() => setCuantos((n) => n + 48)}>Ver más ({lista.length - cuantos} más)</button>}
          </section>
          <Editor />
        </>
      )}
    </div>
  );
}

/**
 * La miniatura de una tarjeta: prueba cada archivo en orden y, si ninguno carga, muestra un dibujo por el
 * tipo de receta en vez de un cuadro vacío (UX-25).
 */
function Miniatura({ urls, tipo, apagada }: { urls: string[]; tipo: string; apagada: boolean }) {
  const [i, setI] = useState(0);
  const url = urls[i];
  const clase = `h-full w-full object-cover ${apagada ? "opacity-50" : ""}`;
  if (!url) return <span aria-hidden className="flex h-full w-full items-center justify-center text-4xl opacity-60">{iconoDeTipo(tipo)}</span>;
  if (tipoMiniatura(decodeURIComponent(url)) === "video") return <video src={url} muted loop playsInline preload="metadata" className={clase} onError={() => setI((n) => n + 1)} onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" className={clase} onError={() => setI((n) => n + 1)} />;
}

/** El ejemplo de resultado en el detalle: la primera imagen o video que cargue y, si la receta trae, su audio (UX-25). */
function Ejemplo({ urls }: { urls: string[] }) {
  const [malas, setMalas] = useState<string[]>([]);
  const vista = urls.find((u) => !malas.includes(u) && tipoMiniatura(decodeURIComponent(u)) !== "audio");
  const audio = urls.find((u) => !malas.includes(u) && tipoMiniatura(decodeURIComponent(u)) === "audio");
  const fallo = (u: string) => () => setMalas((m) => [...m, u]);
  if (!vista && !audio) return null;
  return (
    <div className="w-full max-w-sm space-y-2 sm:w-auto">
      {vista && (tipoMiniatura(decodeURIComponent(vista)) === "video" ? (
        <video key={vista} src={vista} controls muted playsInline preload="metadata" className="max-h-56 w-full rounded object-contain" onError={fallo(vista)} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={vista} src={vista} alt="Ejemplo de resultado" className="max-h-56 w-full rounded object-contain sm:w-auto" onError={fallo(vista)} />
      ))}
      {audio && (
        <label className="block space-y-1 text-xs text-tenue">
          <span>Escucha un ejemplo</span>
          <audio key={audio} src={audio} controls preload="none" className="w-full" onError={fallo(audio)} />
        </label>
      )}
    </div>
  );
}

function Instalar({ comfy, alTerminar }: { comfy: Datos["comfy"]; alTerminar: () => void }) {
  const [activo, setActivo] = useState(comfy.instalando);
  const { datos: e, recargar } = useSondeo<{ corriendo: boolean; falta: string | null; error: string | null; pasos: { id: string; nombre: string; estado: string }[]; registro: string[] }>("/api/sistema/comfyui", activo ? 1500 : 30_000);
  const [error, setError] = useState<string | null>(null);
  const listo = e && !e.falta && !e.corriendo;
  const avisado = useRef(false);
  useEffect(() => {
    if (listo && !avisado.current) {
      avisado.current = true;
      alTerminar();
    }
  }, [listo, alTerminar]);
  if (!comfy.disponible) return <Aviso tipo="info">Los workflows necesitan una tarjeta de video NVIDIA: en este equipo no se pueden usar.</Aviso>;
  return (
    <section className="tarjeta space-y-3 p-4">
      <h2 className="font-semibold">{comfy.aMedias ? "Terminar de instalar ComfyUI" : "Instalar ComfyUI (una sola vez)"}</h2>
      {comfy.aMedias ? (
        <p className="text-sm text-tenue">
          La instalación anterior no llegó al final (por ejemplo, se apagó la computadora, se cortó internet o se cerró Geeper). Con «Reparar la instalación» sigue
          donde quedó: lo que ya bajó no se vuelve a bajar.
        </p>
      ) : (
        <p className="text-sm text-tenue">
          ComfyUI es el programa gratuito que ejecuta estas recetas con la tarjeta de video de este equipo. Ocupa unos 10 GB y tarda entre 15 y 30 minutos; puedes seguir
          usando Geeper mientras tanto. Después, cada receta baja sus modelos (de 1 a 50 GB) sólo cuando la usas.
        </p>
      )}
      {comfy.detalle && !e?.corriendo && !e?.error && (
        <details className="text-xs"><summary className="cursor-pointer text-tenue">Qué pasó (para pedir ayuda)</summary><p className="mt-1 font-mono">{comfy.detalle}</p></details>
      )}
      {!e?.corriendo && (
        <button className="boton boton-primario" onClick={async () => {
          setError(null);
          setActivo(true);
          try {
            await postJson("/api/sistema/comfyui", {});
            await recargar();
          } catch (x) {
            setError((x as Error).message);
          }
        }}>{e?.error ? "Volver a intentar" : comfy.aMedias ? "Reparar la instalación" : "Instalar con un clic"}</button>
      )}
      {e && (e.corriendo || e.error) && (
        <ol className="space-y-0.5 text-xs" aria-live="polite">
          {e.pasos.map((p) => <li key={p.id} className={p.estado === "listo" ? "text-emerald-300" : p.estado === "error" ? "text-red-300" : p.estado === "trabajando" ? "text-sky-300" : "text-tenue"}>{p.estado === "listo" ? "✓" : p.estado === "error" ? "✗" : p.estado === "trabajando" ? "…" : "○"} {p.nombre}</li>)}
        </ol>
      )}
      {e?.corriendo && <p className="text-xs text-tenue">Puedes cerrar esta página: la instalación sigue. Lo último: {e.registro.at(-1) ?? "empezando…"}</p>}
      {e?.error && <Aviso tipo="error">No se pudo instalar: {e.error}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {e && e.registro.length > 0 && (
        <details className="text-xs"><summary className="cursor-pointer text-tenue">Ver el registro (para pedir ayuda si algo falla)</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono">{e.registro.slice(-80).join("\n")}</pre>
        </details>
      )}
    </section>
  );
}

function Detalle({ id, cerrar, creado }: { id: string; cerrar: () => void; creado: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [archivos, setArchivos] = useState<Record<number, File | null>>({});
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [preguntado, setPreguntado] = useState(false);
  const [permiso, setPermiso] = useState(false);
  const guarde = useGuardeAntes();

  useEffect(() => {
    let vivo = true;
    pedir<Detalle>(`/api/workflows/${encodeURIComponent(id)}`)
      .then((x) => {
        if (!vivo) return;
        setD(x);
        setTextos(Object.fromEntries(x.textos.map((t) => [`${t.nodo}/${t.indice}`, t.valor])));
        setArchivos({});
        setListo(false);
        setPermiso(false);
        setError(null);
      })
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [id]);

  async function crear() {
    if (!d) return;
    // Antes de bajar más de 10 GB se pregunta, una vez (UX-36).
    const descarga = avisoDescarga(d.porBajar, d.libre);
    if (descarga.pregunta && !preguntado && !confirm(descarga.pregunta)) return;
    setPreguntado(true);
    setError(null);
    setListo(false);
    setEnviando(true);
    try {
      const f = new FormData();
      // Sólo lo que cambió: lo demás queda como lo dejó el autor (y unas instrucciones largas no pasan el tope).
      f.set("textos", JSON.stringify(d.textos.map((t) => ({ nodo: t.nodo, indice: t.indice, valor: textos[`${t.nodo}/${t.indice}`] ?? t.valor })).filter((t, i) => t.valor !== d.textos[i]!.valor)));
      for (const [nodo, a] of Object.entries(archivos)) if (a) f.set(`archivo-${nodo}`, a);
      if (permiso) f.set("permitirNodos", "1");
      await pedir(`/api/workflows/${encodeURIComponent(id)}`, { method: "POST", body: f });
      setListo(true);
      creado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (error && !d) return <Aviso tipo="error">{error}</Aviso>;
  if (!d) return <p className="text-sm text-tenue">Cargando la receta…</p>;
  const w = d.workflow;
  const sinArchivo = entradasSinArchivo(d.entradas, Object.keys(archivos).filter((n) => archivos[Number(n)]), (e) => !!e.ejemplo);
  const descarga = avisoDescarga(d.porBajar, d.libre);
  const faltaGuardar = faltanConGuardar(guarde);
  return (
    <section className="tarjeta space-y-4 p-4" aria-label={`Receta ${w.titulo}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{w.titulo}</h2>
          {w.original && <p className="text-xs text-tenue">Nombre original: <span lang="en">{w.original}</span></p>}
          <p className="text-xs text-tenue">{w.categoria}{w.modelos.length ? ` · ${w.modelos.join(", ")}` : ""}</p>
        </div>
        <button className="boton" onClick={cerrar}>Cerrar</button>
      </div>
      <div className="flex flex-wrap gap-4">
        <Ejemplo urls={w.miniaturas} />
        <p className="min-w-0 flex-1 text-sm">{w.descripcion}</p>
      </div>

      {w.aviso && !w.bloqueo && <Aviso tipo="alerta">{w.aviso}</Aviso>}
      {w.bloqueo ? (
        <Aviso tipo="info">{w.bloqueo}</Aviso>
      ) : (
        <>
          {d.entradas.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="font-medium">
                1. Tus archivos{" "}
                {d.entradas.every((e) => e.ejemplo) && <span className="text-xs font-normal text-tenue">(si no subes nada, usa el de ejemplo)</span>}
              </legend>
              {d.entradas.map((e, i) => (
                <div key={e.nodo} className="flex flex-wrap items-center gap-3">
                  {e.ejemplo && e.medio === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.ejemplo} alt="Ejemplo" className="h-16 w-16 rounded object-cover" />
                  )}
                  <label className="boton cursor-pointer">
                    {archivos[e.nodo] ? "Cambiar" : `Subir ${MEDIO[e.medio] ?? "un archivo"}${d.entradas.length > 1 ? ` (${i + 1})` : ""}`}
                    <input type="file" className="sr-only" accept={ACEPTA[e.medio] ?? ""} onChange={(ev) => setArchivos((x) => ({ ...x, [e.nodo]: ev.target.files?.[0] ?? null }))} />
                  </label>
                  <span className={`text-xs ${!archivos[e.nodo] && !e.ejemplo ? "text-amber-300" : "text-tenue"}`}>
                    {archivos[e.nodo]?.name ?? (e.ejemplo ? "Ejemplo de la receta" : `Sube ${tuArchivo(e.medio)} (hace falta para empezar)`)}
                  </span>
                </div>
              ))}
            </fieldset>
          )}
          {d.textos.some((t) => !t.experto) && (
            <fieldset className="space-y-3">
              <legend className="font-medium">{d.entradas.length ? "2." : "1."} Lo que quieres <span className="text-xs font-normal text-tenue">(en inglés suele salir mejor)</span></legend>
              {d.textos.filter((t) => !t.experto).map((t) => (
                <label key={`${t.nodo}/${t.indice}`} className="block space-y-1">
                  <span className="text-xs text-tenue">{t.etiqueta}</span>
                  <textarea className="campo min-h-20" maxLength={5000} value={textos[`${t.nodo}/${t.indice}`] ?? ""} onChange={(ev) => setTextos((x) => ({ ...x, [`${t.nodo}/${t.indice}`]: ev.target.value }))} />
                </label>
              ))}
            </fieldset>
          )}
          {d.textos.some((t) => t.experto) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-tenue">Para expertos: las instrucciones para la IA que mejora tu pedido (no hace falta tocarlas)</summary>
              <div className="mt-2 space-y-3">
                {d.textos.filter((t) => t.experto).map((t) => (
                  <textarea key={`${t.nodo}/${t.indice}`} aria-label={t.etiqueta} className="campo min-h-20 text-xs" maxLength={5000} value={textos[`${t.nodo}/${t.indice}`] ?? ""} onChange={(ev) => setTextos((x) => ({ ...x, [`${t.nodo}/${t.indice}`]: ev.target.value }))} />
                ))}
              </div>
            </details>
          )}
          {!d.textos.some((t) => !t.experto) && d.entradas.length === 0 && (
            <Aviso tipo="info">Esta receta todavía no deja escribir lo que quieres: hará el ejemplo del autor.</Aviso>
          )}
          <div className="space-y-1 text-xs text-tenue">
            <p>
              {d.faltan
                ? `La primera vez baja ${d.faltan} modelo${d.faltan === 1 ? "" : "s"}${d.porBajar ? ` (unos ${gb(d.porBajar)})` : ""}; después ya no.${d.libre != null ? ` En el disco quedan ${gb(d.libre)} libres.` : ""}`
                : "Los modelos ya están en esta computadora."}
            </p>
            {d.notas.length > 0 && (
              <details><summary className="cursor-pointer">Notas del autor (en inglés)</summary>
                <div className="mt-1 max-h-48 space-y-2 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2">{d.notas.map((n, i) => <p key={i}>{n}</p>)}</div>
              </details>
            )}
          </div>
          {d.nodos.length > 0 && (
            <fieldset className="space-y-2 rounded border border-amber-400/30 p-3 text-sm">
              <legend className="px-1 font-medium">Código de la comunidad</legend>
              <p className="text-xs text-tenue">
                Esta receta usa piezas que no vienen con ComfyUI: las hizo otra gente y corren en tu computadora. Geeper solo instala la versión revisada del registro oficial de Comfy, y solo las carga cuando usas una receta que las pide.
              </p>
              <ul className="space-y-1 text-xs">
                {d.nodos.map((n) => (
                  <li key={n.id}>
                    <span className="font-medium">{n.nombre}</span> {n.version && <span className="text-tenue">versión {n.version}</span>}
                    {n.autor && <span className="text-tenue"> · de {n.autor}</span>}
                    {n.repo && <> · <a href={n.repo} target="_blank" rel="noreferrer" className="text-acento hover:underline">ver código</a></>}
                    <span className="text-tenue"> · {n.instalado ? "ya instalado" : `baja ${n.megas} MB`}</span>
                  </li>
                ))}
              </ul>
              {d.nodos.every((n) => n.permitido) ? (
                <p className="text-xs text-emerald-300">Ya lo permitiste.</p>
              ) : (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={permiso} onChange={(e) => setPermiso(e.target.checked)} />
                  <span>Permito instalar este código de la comunidad en mi computadora.</span>
                </label>
              )}
            </fieldset>
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
          {listo && (
            <Aviso tipo="ok">Listo: está en camino (lo ves avanzar arriba, en «Lo que estás creando»). ¿Otra versión? Cambia el texto y pulsa «Crear otra».</Aviso>
          )}
          <AvisoTarjeta g={guarde}>Mientras trabaja se pausa la generación de videos.</AvisoTarjeta>
          <div className="space-y-1">
            {descarga.bloqueo && <Aviso tipo="alerta">{descarga.bloqueo}</Aviso>}
            <button className="boton boton-primario" disabled={enviando || !!descarga.bloqueo || sinArchivo.length > 0 || (d.nodos.some((n) => !n.permitido) && !permiso) || faltaGuardar.length > 0}
              aria-describedby={faltaGuardar.length ? guarde.idFalta : undefined} onClick={() => void crear()}>{enviando ? "Enviando…" : listo ? "Crear otra" : "Crear"}</button>
            {sinArchivo.length > 0 && <p className="text-xs text-amber-300">{textoFaltaArchivo(sinArchivo.map((e) => e.medio))}</p>}
            <LineaFalta id={guarde.idFalta} faltan={faltaGuardar} />
          </div>
        </>
      )}
    </section>
  );
}

function Resultados({ corridas, trabajos, cambio }: { corridas: CorridaV[]; trabajos: TrabajoV[]; cambio: () => void }) {
  const motorVivo = useMotorVivo();
  // Una corrida «preparada» sin trabajo en marcha pero con uno cortado (se apagó la PC…) también se ve: se puede reintentar.
  const visibles = corridas.filter((c) => c.estado !== "preparada" || trabajos.some((t) => t.corrida === c.id) || c.trabajo).slice(0, 12);
  if (!visibles.length && !trabajos.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Lo que estás creando</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((c) => {
          const t = trabajos.find((x) => x.corrida === c.id);
          return (
            <article key={c.id} className="tarjeta space-y-2 p-3">
              <p className="text-sm font-medium">{c.titulo}</p>
              {t ? (
                <div className="space-y-1">
                  <p className="text-xs">{t.estado === "pendiente" ? textoEspera(motorVivo) : t.etapa || "Trabajando…"}</p>
                  <Barra valor={t.progreso} etiqueta={`Avance de «${c.titulo}»`} />
                  <button className="boton text-xs" onClick={async () => { if (confirm("¿Cancelar?")) { await postJson(`/api/trabajos/${t.id}`, { accion: "cancelar" }).catch(() => {}); cambio(); } }}>Cancelar</button>
                </div>
              ) : c.estado !== "hecha" ? (
                <div className="space-y-2">
                  {c.cancelada ? (
                    <Aviso tipo="info">Lo cancelaste antes de terminar.</Aviso>
                  ) : (
                    <Aviso tipo="error">{c.estado === "preparada" ? "Se cortó antes de terminar." : c.error?.split("\n")[0] ?? "No se pudo crear."}</Aviso>
                  )}
                  {c.trabajo && <Reintentar trabajo={c.trabajo} cambio={cambio} />}
                  <button type="button" className="boton text-xs"
                    onClick={async () => {
                      await pedir(`/api/workflows/corridas/${encodeURIComponent(c.id)}`, { method: "DELETE" }).catch((e: Error) => alert(e.message));
                      cambio();
                    }}>
                    Quitar
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {c.salidas.slice(0, 4).map((s) => {
                    const src = archivo(`workflows/${c.id}/${s.archivo}`);
                    return (
                      <div key={s.archivo} className="space-y-1">
                        {s.tipo === "imagen" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" className="max-h-64 w-full rounded object-contain" />
                        ) : s.tipo === "video" ? (
                          <video src={src} controls className="max-h-64 w-full rounded" />
                        ) : s.tipo === "audio" ? (
                          <audio src={src} controls className="w-full" />
                        ) : null}
                        <div className="flex flex-wrap items-center gap-3">
                          <a className="text-xs text-acento underline" href={archivo(`workflows/${c.id}/${s.archivo}`, true)}>Descargar</a>
                          {(s.tipo === "imagen" || s.tipo === "video") && <UsarEnVideo corrida={c.id} archivo={s.archivo} />}
                        </div>
                      </div>
                    );
                  })}
                  {c.segundos !== undefined && <p className="text-[11px] text-tenue">Tardó {c.segundos >= 60 ? `${Math.round(c.segundos / 60)} min` : `${c.segundos} s`}</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Relanza el mismo pedido (mismos textos y archivos) con el trabajo que falló o se cortó. */
function Reintentar({ trabajo, cambio }: { trabajo: string; cambio: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <button className="boton text-xs" disabled={enviando} onClick={async () => {
        setError(null);
        setEnviando(true);
        try {
          await postJson(`/api/trabajos/${trabajo}`, { accion: "relanzar" });
          cambio();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setEnviando(false);
        }
      }}>{enviando ? "Enviando…" : "Volver a intentar"}</button>
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}

interface ProyectoV { id: string; nombre: string; versionActual: number }
interface EscenaV { id: string; indice: number; texto: string }

/** Pone un resultado como imagen o video de una escena: elige el video y la escena. */
function UsarEnVideo({ corrida, archivo: nombre }: { corrida: string; archivo: string }) {
  const [abierto, setAbierto] = useState(false);
  const [proyectos, setProyectos] = useState<ProyectoV[] | null>(null);
  const [proyecto, setProyecto] = useState("");
  const [escenas, setEscenas] = useState<EscenaV[] | null>(null);
  const [escena, setEscena] = useState("");
  const [estado, setEstado] = useState<"" | "enviando" | "listo">("");
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setAbierto(true);
    setError(null);
    if (!proyectos) {
      try {
        const r = await pedir<{ proyectos: ProyectoV[] }>("/api/proyectos");
        setProyectos(r.proyectos.filter((x) => x.versionActual > 0));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  async function elegirProyecto(id: string) {
    setProyecto(id);
    setEscena("");
    setEscenas(null);
    if (!id) return;
    try {
      const v = await pedir<{ escenas: EscenaV[] }>(`/api/proyectos/${id}`);
      setEscenas(v.escenas);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function poner() {
    setError(null);
    setEstado("enviando");
    try {
      await postJson("/api/workflows/usar", { corrida, archivo: nombre, proyecto, escena });
      setEstado("listo");
    } catch (e) {
      setError((e as Error).message);
      setEstado("");
    }
  }

  if (!abierto) return <button className="boton text-xs" onClick={() => void abrir()}>Usar en un video</button>;
  return (
    <div className="w-full space-y-2 rounded border border-white/10 p-2 text-xs">
      {estado === "listo" ? (
        <Aviso tipo="ok">Listo: ya está en la escena. <a className="underline" href={`/proyectos/${proyecto}`}>Abrir el video</a></Aviso>
      ) : (
        <>
          <label className="block space-y-1">
            <span>1. ¿En qué video?</span>
            <select className="campo" value={proyecto} onChange={(e) => void elegirProyecto(e.target.value)}>
              <option value="">Elige un video…</option>
              {proyectos?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </label>
          {proyectos?.length === 0 && <p className="text-tenue">Todavía no tienes videos: crea uno primero.</p>}
          {escenas && (
            <label className="block space-y-1">
              <span>2. ¿En qué escena? (reemplaza su imagen o video)</span>
              <select className="campo" value={escena} onChange={(e) => setEscena(e.target.value)}>
                <option value="">Elige una escena…</option>
                {escenas.map((e) => <option key={e.id} value={e.id}>{`${e.indice + 1}. ${e.texto.slice(0, 70)}${e.texto.length > 70 ? "…" : ""}`}</option>)}
              </select>
            </label>
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
          <div className="flex gap-2">
            <button className="boton boton-primario" disabled={!escena || estado === "enviando"} onClick={() => void poner()}>{estado === "enviando" ? "Poniendo…" : "Poner aquí"}</button>
            <button className="boton" onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
          <p className="text-tenue">Puedes deshacerlo desde el historial de versiones del video.</p>
        </>
      )}
    </div>
  );
}

/** Para los workflows que Geeper no corre solo: abrir el editor completo de ComfyUI. */
function Editor() {
  const { datos, recargar } = useSondeo<{ abierto: boolean; arrancando: boolean; url: string | null }>("/api/workflows/editor", 10_000);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const accion = async (a: "abrir" | "cerrar") => {
    setError(null);
    setOcupado(true);
    try {
      const r = await postJson<{ url?: string }>("/api/workflows/editor", { accion: a });
      if (r.url) window.open(r.url, "_blank", "noopener");
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <details className="tarjeta p-4 text-sm">
      <summary className="cursor-pointer font-medium">Para expertos: el editor de ComfyUI</summary>
      <div className="mt-2 space-y-2">
        <p className="text-tenue">Abre ComfyUI tal cual, con sus nodos, para las recetas que necesitan complementos o para armar las tuyas. Mientras está abierto usa la tarjeta de video: ciérralo al terminar.</p>
        {datos?.abierto ? (
          <div className="flex flex-wrap gap-2">
            <a className="boton boton-primario" href={datos.url ?? "#"} target="_blank" rel="noopener">Ir al editor</a>
            <button className="boton" disabled={ocupado} onClick={() => void accion("cerrar")}>Cerrar el editor</button>
          </div>
        ) : (
          <button className="boton" disabled={ocupado || datos?.arrancando} onClick={() => void accion("abrir")}>{ocupado || datos?.arrancando ? "Abriendo (hasta 1 minuto)…" : "Abrir el editor de ComfyUI"}</button>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
    </details>
  );
}
