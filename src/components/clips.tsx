"use client";
/**
 * Asistente de clips para alguien que no sabe nada de video: 1) elige tu video, 2) elige un momento
 * (con vista previa), 3) ajusta y crea. El paso vive en la URL (?fuente=…&momento=…).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Aviso, Barra, archivo, numero, pedir, postJson, segundos, useSondeo } from "./comun";
import { SugerenciasBusqueda } from "./sugerencias-busqueda";
import { sugerirGlosario, sumarAlGlosario } from "@/lib/glosario";
import { etapaSimple, explicarError, ERROR_GENERICO } from "@/lib/textos";

interface Vista { video: string; poster: string; desde: number; hasta: number }
interface Candidato { n: number; inicio: number; fin: number; puntaje: number; motivos: string[]; texto?: string; vista?: Vista }
interface Fuente {
  id: string;
  info: { url: string; src?: string; titulo: string; canal: string | null; plataforma: string | null; duracion: number };
  candidatos: Candidato[] | null;
  idioma: string | null;
  /** Con qué opciones se buscó (análisis viejos: sin el dato). */
  opciones?: { top: number; min: number; max: number } | null;
  /** Segundos que se revisaron (menos que la duración si el video pasa del tope). */
  revisado?: number;
}
interface TrabajoM {
  id: string; estado: string; etapa: string; progreso: number; error: string | null;
  payload: PedidoAnalisis; resultado: { fuente?: string } | null;
}
interface PedidoAnalisis { src?: string; idioma?: string; top?: number; min?: number; max?: number; maxMinutos?: number }
interface Datos { fuentes: Fuente[]; trabajos: TrabajoM[]; workerVivo: boolean }
interface Tendencia { url: string; titulo: string; canal: string; vistas: number; horas: number; vistasPorHora: number; minutos: number; loMasVisto: boolean; fueDirecto: boolean }

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Los motivos del puntaje, dichos como los diría una persona. */
function motivoSimple(m: string): string {
  if (m.startsWith("pico de sonoridad")) return "Hay un grito o una reacción fuerte";
  if (m.startsWith("lo más visto")) return "Es la parte que más vuelve a ver la gente";
  if (m.startsWith("pico del chat")) return "El chat explotó";
  if (/palabras de emoción/.test(m)) return "Dicen cosas como «no puede ser»";
  return "Hay mucha energía";
}

function estrellas(c: Candidato, todos: Candidato[]): number {
  const orden = [...todos].sort((a, b) => b.puntaje - a.puntaje);
  const i = orden.findIndex((x) => x.n === c.n);
  return i < Math.ceil(orden.length / 3) ? 3 : i < Math.ceil((orden.length * 2) / 3) ? 2 : 1;
}

export function PaginaClips() {
  const router = useRouter();
  const ruta = usePathname();
  const q = useSearchParams();
  const fuenteId = q.get("fuente");
  const momento = q.get("momento") ? Number(q.get("momento")) : null;
  const trabajoPedido = q.get("trabajo"); // el análisis que el paso 1 sigue al volver de «Revisar todo»
  const { datos, recargar } = useSondeo<Datos>("/api/clips", 3000);
  const ir = (f: string | null, m: number | null = null, trabajo: string | null = null) => {
    const p = new URLSearchParams();
    if (f) p.set("fuente", f);
    if (m) p.set("momento", String(m));
    if (trabajo) p.set("trabajo", trabajo);
    router.push(p.size ? `${ruta}?${p}` : ruta);
  };
  const fuente = datos?.fuentes.find((f) => f.id === fuenteId) ?? null;
  const cand = fuente?.candidatos?.find((c) => c.n === momento) ?? null;
  const paso = cand ? 3 : fuente ? 2 : 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Hacer clips de un video largo</h1>
        <p className="text-sm text-tenue">Geeper encuentra los mejores momentos de un video y los convierte en clips verticales listos para redes.</p>
      </div>
      <Pasos actual={paso} ir={(n) => (n === 1 ? ir(null) : n === 2 && fuente ? ir(fuente.id) : undefined)} />
      {datos && !datos.workerVivo && (
        <Aviso tipo="alerta">
          <p className="font-medium">El motor de Geeper está apagado, así que nada avanza.</p>
          <p className="mt-1">Cierra Geeper y ábrelo otra vez con <code>pnpm run dev:up</code> (enciende la web y el motor juntos).</p>
        </Aviso>
      )}
      {!datos && <p className="text-tenue">Cargando…</p>}
      {datos && paso === 1 && <Paso1 datos={datos} recargar={recargar} elegir={(id) => ir(id)} trabajoInicial={trabajoPedido} />}
      {datos && paso === 2 && fuente && <Paso2 f={fuente} elegir={(n) => ir(fuente.id, n)} volver={(trabajo) => ir(null, null, trabajo ?? null)} />}
      {datos && paso === 3 && fuente && cand && <Paso3 f={fuente} c={cand} volver={() => ir(fuente.id)} />}
      {datos && fuenteId && !fuente && <Aviso tipo="error">No encuentro ese video. <button className="underline" onClick={() => ir(null)}>Volver al inicio</button></Aviso>}
    </div>
  );
}

function Pasos({ actual, ir }: { actual: number; ir: (n: number) => void }) {
  const nombres = ["Elige tu video", "Elige un momento", "Ajusta y crea"];
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Pasos">
      {nombres.map((n, i) => {
        const k = i + 1;
        const hecho = k < actual;
        return (
          <li key={n}>
            <button type="button" disabled={!hecho} onClick={() => ir(k)} aria-current={k === actual ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 ${k === actual ? "border-cyan-500 bg-cyan-950/50 text-white" : hecho ? "border-borde text-tenue hover:text-white" : "border-borde text-tenue opacity-60"}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${k === actual ? "bg-cyan-600" : "bg-[#232a38]"}`}>{hecho ? "✓" : k}</span>{n}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Paso 1 ---------------------------------------------------------------------------------------

export function Paso1({ datos, recargar, elegir, trabajoInicial = null }: { datos: Datos; recargar: () => Promise<void>; elegir: (id: string) => void; trabajoInicial?: string | null }) {
  const [modo, setModo] = useState<"enlace" | "archivo">("enlace");
  const [url, setUrl] = useState("");
  const [idioma, setIdioma] = useState("es");
  const [min, setMin] = useState(15);
  const [max, setMax] = useState(40);
  const [subida, setSubida] = useState<number | null>(null);
  // UX-24: al volver de «Revisar todo el video» sigue ese análisis (avance, ir a los momentos o el fallo).
  const [esperando, setEsperando] = useState<string | null>(trabajoInicial);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const trabajo = datos.trabajos.find((t) => t.id === esperando);
  // UX-03: si el análisis falla o se cancela, los botones vuelven a funcionar sin recargar.
  const ocupado = Boolean(esperando) && (!trabajo || trabajo.estado === "pendiente" || trabajo.estado === "corriendo");
  useEffect(() => {
    // Al pasar al paso 2 este componente se desmonta: basta con navegar.
    if (trabajo?.estado === "hecho" && trabajo.resultado?.fuente) elegir(trabajo.resultado.fuente);
  }, [trabajo, elegir]);

  async function buscarEnlace(e?: React.FormEvent, u?: string) {
    e?.preventDefault();
    setError(null);
    try {
      await analizar({ src: (u ?? url).trim(), idioma, min, max });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function analizar(pedido: PedidoAnalisis & { src: string }) {
    const r = await postJson<{ trabajo: string }>("/api/clips/momentos", pedido);
    setEsperando(r.trabajo);
    void recargar();
  }

  /** «Volver a intentar» con lo mismo que se pidió (sirve también para un archivo ya subido). */
  async function reintentar(t: TrabajoM) {
    setError(null);
    try {
      if (!t.payload.src) throw new Error("No sé qué video era: pega el enlace o súbelo otra vez.");
      await analizar({ src: t.payload.src, idioma: t.payload.idioma, top: t.payload.top, min: t.payload.min, max: t.payload.max, maxMinutos: t.payload.maxMinutos });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function subir(f: File) {
    setError(null);
    setSubida(0);
    const x = new XMLHttpRequest();
    x.open("POST", `/api/clips/subir?${new URLSearchParams({ nombre: f.name, idioma, min: String(min), max: String(max) })}`);
    x.upload.onprogress = (ev) => ev.lengthComputable && setSubida(ev.loaded / ev.total);
    x.onload = () => {
      setSubida(null);
      try {
        const r = JSON.parse(x.responseText) as { trabajo?: string; error?: string };
        if (x.status >= 400 || !r.trabajo) setError(r.error ?? "No pude recibir el video. Vuelve a intentar; si sigue fallando, pide ayuda.");
        else {
          setEsperando(r.trabajo);
          void recargar();
        }
      } catch {
        setError(x.status === 413 ? "Ese video es demasiado grande para subirlo." : "No pude recibir el video. Vuelve a intentar; si sigue fallando, pide ayuda.");
      }
    };
    x.onerror = () => {
      setSubida(null);
      setError("La subida se cortó. Revisa que Geeper siga abierto y vuelve a intentar.");
    };
    x.send(f);
  }

  const enCurso = datos.trabajos.filter((t) => t.estado === "pendiente" || t.estado === "corriendo");
  const fallo = trabajo && ["fallido", "interrumpido", "cancelado"].includes(trabajo.estado) ? trabajo : null;
  const conMomentos = datos.fuentes.filter((f) => f.candidatos?.length);

  return (
    <div className="space-y-6">
      <section className="tarjeta space-y-4 p-5">
        <div className="flex gap-2" role="tablist">
          {(["enlace", "archivo"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={modo === m} onClick={() => setModo(m)} className={`boton ${modo === m ? "boton-primario" : ""}`}>
              {m === "enlace" ? "Pegar un enlace" : "Subir un video"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="etiqueta" htmlFor="idioma">¿En qué idioma hablan en el video?</label>
            <select id="idioma" className="campo" value={idioma} onChange={(e) => setIdioma(e.target.value)}>
              <option value="es">Español</option><option value="en">Inglés</option><option value="pt">Portugués</option>
            </select>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-tenue">Más opciones</summary>
            <div className="mt-2 flex gap-3">
              <div><label className="etiqueta" htmlFor="min">Clip más corto (s)</label><input id="min" type="number" className="campo w-24" value={min} min={3} max={120} onChange={(e) => setMin(Number(e.target.value))} /></div>
              <div><label className="etiqueta" htmlFor="max">Clip más largo (s)</label><input id="max" type="number" className="campo w-24" value={max} min={3} max={180} onChange={(e) => setMax(Number(e.target.value))} /></div>
            </div>
          </details>
        </div>
        {modo === "enlace" ? (
          <form onSubmit={buscarEnlace} className="space-y-2">
            <label className="etiqueta" htmlFor="url">Enlace del video (YouTube, Twitch, Kick…)</label>
            <input id="url" className="campo" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" required />
            <p className="text-xs text-tenue">Tiene que ser un video ya publicado. Si es un directo, espera a que termine y usa la grabación.</p>
            <button className="boton boton-primario" disabled={!url.trim() || ocupado}>Buscar los mejores momentos</button>
          </form>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer.files[0]; if (f) subir(f); }}
            className={`grid place-items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center ${arrastrando ? "border-cyan-500 bg-cyan-950/30" : "border-borde"}`}>
            <p className="text-base">Arrastra tu video aquí</p>
            <p className="text-sm text-tenue">o</p>
            <button type="button" className="boton boton-primario" disabled={subida !== null || ocupado} onClick={() => entrada.current?.click()}>Elegir un archivo</button>
            <input ref={entrada} type="file" accept="video/*" className="hidden" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
            <p className="text-xs text-tenue">Una grabación tuya, de un directo o de una partida. MP4, MOV, MKV…</p>
          </div>
        )}
        {subida !== null && (
          <div className="space-y-1 text-sm"><p>Subiendo el video… {Math.round(subida * 100)} %</p><Barra valor={subida} /></div>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        {fallo && <FalloAnalisis t={fallo} reintentar={() => void reintentar(fallo)} ocupado={ocupado} />}
      </section>

      {enCurso.map((t) => <TarjetaAnalisis key={t.id} t={t} fuentes={datos.fuentes} mio={t.id === esperando} />)}

      {conMomentos.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">Videos que ya analizaste</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {conMomentos.map((f) => {
              const poster = f.candidatos!.find((c) => c.vista)?.vista?.poster;
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => elegir(f.id)} className="tarjeta flex w-full items-center gap-3 p-3 text-left hover:border-cyan-700">
                    {poster
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={archivo(poster)} alt="" className="h-16 w-28 shrink-0 rounded object-cover" />
                      : <span className="grid h-16 w-28 shrink-0 place-items-center rounded bg-[#0f131a] text-2xl" aria-hidden>🎬</span>}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{f.info.titulo}</span>
                      <span className="block text-xs text-tenue">{f.info.canal ?? "Video tuyo"} · {f.candidatos!.length === 1 ? "1 momento" : `${f.candidatos!.length} momentos`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Radar alElegir={(u) => { setModo("enlace"); setUrl(u); void buscarEnlace(undefined, u); }} />
    </div>
  );
}

/** UX-03: por qué no se pudo, en palabras simples, con «Volver a intentar» y el detalle plegado. */
export function FalloAnalisis({ t, reintentar, ocupado = false }: { t: Pick<TrabajoM, "estado" | "error">; reintentar: () => void; ocupado?: boolean }) {
  const { simple, detalle } = explicarError(t.error);
  const texto = t.estado === "cancelado"
    ? "Se canceló el análisis de este video."
    : t.estado === "interrumpido"
      ? "El análisis se cortó (Geeper se cerró o se reinició a la mitad)."
      : simple === ERROR_GENERICO ? "No pude abrir ese video. Revisa que el enlace esté completo y que el video sea público." : simple;
  return (
    <Aviso tipo="error">
      <p>{texto}</p>
      <button type="button" className="boton mt-2" disabled={ocupado} onClick={reintentar}>Volver a intentar</button>
      {detalle && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-tenue">Ver detalle técnico</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{detalle}</pre>
        </details>
      )}
    </Aviso>
  );
}

/** Nombre del video que se está analizando: su título si ya se sabe, si no el archivo o el enlace. */
export function nombreAnalisis(src: string | undefined, fuentes: Pick<Fuente, "info">[]): string {
  if (!src) return "tu video";
  const f = fuentes.find((x) => x.info.src === src || x.info.url === src);
  if (f?.info.titulo) return f.info.titulo;
  if (!/^https?:\/\//i.test(src)) return (src.split(/[\\/]/).pop() ?? src).replace(/^[a-f0-9]{8,}-/, "");
  return src.replace(/^https?:\/\/(www\.)?/i, "");
}

/** UX-34: el paso en curso en palabras simples; con un archivo subido nunca dice «Bajando». */
export function etapaClip(etapa: string, estado: string, src?: string): string {
  if (estado === "pendiente") return "En la fila: empieza en cuanto el motor se libere.";
  const archivoPropio = Boolean(src) && !/^https?:\/\//i.test(src!);
  // Trabajos de antes de que el worker avisara cada paso.
  if (/^Trayendo la fuente/i.test(etapa)) return archivoPropio ? "Midiendo dónde hay más reacción…" : "Bajando el video y midiendo dónde hay más reacción…";
  if (archivoPropio && /^Bajando/i.test(etapa)) return "Abriendo tu video…";
  return etapaSimple(etapa, estado);
}

function TarjetaAnalisis({ t, fuentes, mio }: { t: TrabajoM; fuentes: Fuente[]; mio: boolean }) {
  const archivoPropio = Boolean(t.payload.src) && !/^https?:\/\//i.test(t.payload.src!);
  return (
    <section className="tarjeta space-y-2 p-4" aria-live="polite">
      <p className="font-medium">Analizando «{nombreAnalisis(t.payload.src, fuentes)}»… {mio ? "te llevo a los momentos cuando termine." : ""}</p>
      <p className="text-sm text-tenue">{etapaClip(t.etapa, t.estado, t.payload.src)}</p>
      <Barra valor={Math.max(0.03, t.progreso)} etiqueta="Avance del análisis" />
      <p className="text-xs text-tenue">
        Puede tardar unos minutos ({archivoPropio ? "medir el sonido" : "bajar el video, medir el sonido"} y escuchar los mejores momentos). Puedes dejar esta página abierta.
      </p>
    </section>
  );
}

function Radar({ alElegir }: { alElegir: (url: string) => void }) {
  const [q, setQ] = useState("gta 6");
  const [res, setRes] = useState<Tendencia[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function buscar(consulta: string) {
    setCargando(true);
    setError(null);
    try {
      setRes((await pedir<{ videos: Tendencia[] }>(`/api/clips/tendencias?q=${encodeURIComponent(consulta)}&horas=24`)).videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }
  function medir(e: React.FormEvent) {
    e.preventDefault();
    void buscar(q);
  }
  function elegirSugerencia(s: string) {
    setQ(s);
    if (!cargando) void buscar(s);
  }
  return (
    <details className="tarjeta p-4">
      <summary className="cursor-pointer font-medium">¿No sabes qué video usar? Mira lo que está de moda hoy</summary>
      <form onSubmit={medir} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="grow"><label className="etiqueta" htmlFor="q">Tema</label><input id="q" className="campo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="boton" disabled={cargando || !q.trim()}>{cargando ? "Buscando (cerca de 1 min)…" : "Buscar en YouTube"}</button>
      </form>
      {!cargando && <SugerenciasBusqueda consulta={q} alElegir={elegirSugerencia} texto="Toca una para buscar sus videos de moda." />}
      {error && <div className="mt-3"><Aviso tipo="error">{error}</Aviso></div>}
      {res && (
        <div className="mt-3 space-y-2">
          {res.length === 0 && <p className="text-sm text-tenue">No encontré videos de las últimas 24 horas sobre eso.</p>}
          <ul className="space-y-2">
            {res.map((v) => (
              <li key={v.url} className="flex flex-wrap items-center gap-3 rounded-lg border border-borde p-2 text-sm">
                <span className="min-w-0 grow">
                  <a className="hover:underline" href={v.url} target="_blank" rel="noreferrer">{v.titulo}</a>
                  <span className="block text-xs text-tenue">{v.canal} · {numero(v.vistasPorHora)} vistas por hora · hace {v.horas} h · {segundos(v.minutos * 60)}</span>
                </span>
                <button type="button" className="boton" onClick={() => alElegir(v.url)}>Usar este video</button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-tenue">Que un video esté de moda no da permiso para usarlo: hace falta que el creador tenga una campaña de clips o te autorice.</p>
        </div>
      )}
    </details>
  );
}

// ---- Paso 2 ---------------------------------------------------------------------------------------

function Paso2({ f, elegir, volver }: { f: Fuente; elegir: (n: number) => void; volver: (trabajo?: string) => void }) {
  const cands = f.candidatos ?? [];
  const orden = [...cands].sort((a, b) => b.puntaje - a.puntaje);
  const sinVista = cands.some((c) => !c.vista);
  const [reanalizando, setReanalizando] = useState(false);
  const [errorTodo, setErrorTodo] = useState<string | null>(null);
  const corto = revisadoParcial(f);
  async function revisarTodo() {
    setReanalizando(true);
    setErrorTodo(null);
    try {
      const r = await postJson<{ trabajo: string }>("/api/clips/momentos", pedidoOtraVez(f, Math.min(600, Math.ceil(f.info.duracion / 60) + 1)));
      volver(r.trabajo); // el paso 1 enseña el avance de ese trabajo
    } catch (err) {
      setErrorTodo(err instanceof Error ? err.message : String(err));
      setReanalizando(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-medium">{f.info.titulo}</h2>
        <span className="text-sm text-tenue">{f.info.canal ?? "Video tuyo"} · {segundos(f.info.duracion)}</span>
        <button type="button" className="boton ml-auto" onClick={() => volver()}>← Elegir otro video</button>
      </div>
      {corto && (
        <Aviso tipo="info">
          <p>Este video dura {segundos(f.info.duracion)}: revisé sólo {corto}. Los momentos de después no salen en la lista.</p>
          <button type="button" className="boton mt-2" disabled={reanalizando} onClick={() => void revisarTodo()}>
            {reanalizando ? "Pidiendo…" : "Revisar todo el video (tarda más y ocupa más espacio)"}
          </button>
          {errorTodo && <p className="mt-1 text-red-300">{errorTodo}</p>}
        </Aviso>
      )}
      {cands.length === 0 ? (
        <Aviso tipo="alerta">No encontré momentos en este video. Suele pasar si es más corto que un clip o si casi no tiene sonido.</Aviso>
      ) : (
        <p className="text-sm text-tenue">{cands.length === 1 ? "Encontré 1 momento. Dale play para verlo." : `Encontré ${cands.length} momentos, del mejor al menos bueno. Dale play para verlos y elige uno.`}</p>
      )}
      {sinVista && (
        <Aviso tipo="info">
          Este video se analizó antes de las vistas previas.{" "}
          <button type="button" className="underline" disabled={reanalizando} onClick={() => { setReanalizando(true); void postJson("/api/clips/momentos", pedidoOtraVez(f)); }}>
            {reanalizando ? "Analizando otra vez… (vuelve al paso 1 para ver el avance)" : "Analizarlo otra vez"}
          </button>
        </Aviso>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {orden.map((c) => (
          <li key={c.n} className="tarjeta overflow-hidden">
            <VistaMomento c={c} />
            <div className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <span aria-label={`${estrellas(c, cands)} de 3 estrellas`} className="text-amber-300">{"★".repeat(estrellas(c, cands))}<span className="text-[#3a4255]">{"★".repeat(3 - estrellas(c, cands))}</span></span>
                <span className="text-xs text-tenue">en el minuto {mmss(c.inicio)} · dura {segundos(c.fin - c.inicio)}</span>
              </div>
              <ul className="text-sm">{[...new Set(c.motivos.map(motivoSimple))].map((m) => <li key={m}>• {m}</li>)}</ul>
              {c.texto && <p className="line-clamp-3 text-sm text-tenue">«{c.texto}»</p>}
              <button type="button" className="boton boton-primario w-full justify-center" onClick={() => elegir(c.n)}>Usar este momento</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * UX-24: pedir otra vez el análisis de una fuente con lo mismo de antes: lo que pegó la persona (no la
 * `webpage_url`, que daría otra fuente), su idioma y sus duraciones de clip.
 */
export function pedidoOtraVez(f: Pick<Fuente, "info" | "idioma" | "opciones">, maxMinutos?: number): PedidoAnalisis & { src: string } {
  return {
    src: f.info.src ?? f.info.url,
    idioma: f.idioma ?? "es",
    ...(f.opciones ? { top: f.opciones.top, min: f.opciones.min, max: f.opciones.max } : {}),
    ...(maxMinutos ? { maxMinutos } : {}),
  };
}

/** UX-24: «la primera hora y media» si de un video largo se revisó sólo una parte; si no, null. */
export function revisadoParcial(f: Pick<Fuente, "info" | "revisado">): string | null {
  const revisado = f.revisado ?? Math.min(f.info.duracion, 90 * 60);
  if (f.info.duracion - revisado < 60) return null;
  if (Math.abs(revisado - 5400) < 30) return "la primera hora y media";
  return `los primeros ${segundos(revisado)}`;
}

/** Miniatura que, al darle play, reproduce sólo el momento (dentro de la vista previa con aire). */
function VistaMomento({ c }: { c: Candidato }) {
  const ref = useRef<HTMLVideoElement>(null);
  if (!c.vista) return <div className="grid aspect-video place-items-center bg-[#0f131a] text-sm text-tenue">Sin vista previa</div>;
  const v = c.vista;
  return (
    <video ref={ref} src={archivo(v.video)} poster={archivo(v.poster)} controls preload="none" className="aspect-video w-full bg-black"
      onPlay={(e) => { const t = e.currentTarget; if (t.currentTime < c.inicio - v.desde - 0.5 || t.currentTime >= c.fin - v.desde) t.currentTime = c.inicio - v.desde; }}
      onTimeUpdate={(e) => { const t = e.currentTarget; if (t.currentTime >= c.fin - v.desde) t.pause(); }} />
  );
}

// ---- Paso 3 ---------------------------------------------------------------------------------------

const ESTILOS = [
  { id: "react", nombre: "Cara arriba, juego abajo", para: "Streamer con su cámara sobre el juego" },
  { id: "cara", nombre: "Sigue a la persona", para: "Alguien hablando o caminando (IRL)" },
  { id: "contener", nombre: "Video completo", para: "Se ve todo, con fondo desenfocado" },
] as const;

function Dibujo({ id }: { id: string }) {
  const caja = "mx-auto grid h-24 w-14 overflow-hidden rounded border border-borde bg-[#0f131a]";
  if (id === "react") return <span className={`${caja} grid-rows-[38%_62%]`} aria-hidden><span className="grid place-items-center bg-[#334155] text-lg">🙂</span><span className="bg-gradient-to-br from-emerald-700 to-cyan-800" /></span>;
  if (id === "cara") return <span className={`${caja} place-items-center bg-[#334155] text-2xl`} aria-hidden>🙂</span>;
  if (id === "contener") return <span className={`${caja} place-items-center bg-gradient-to-b from-[#1e293b] to-[#0f172a]`} aria-hidden><span className="h-7 w-full bg-gradient-to-br from-emerald-700 to-cyan-800" /></span>;
  return <span className={`${caja} place-items-center bg-gradient-to-br from-emerald-700 to-cyan-800`} aria-hidden />;
}

const PERMISOS = [
  { id: "campania", texto: "Es de una campaña de clips del creador" },
  { id: "escrito", texto: "El creador me autorizó por escrito" },
  { id: "propio", texto: "Es mi propio video" },
] as const;

function Paso3({ f, c, volver }: { f: Fuente; c: Candidato; volver: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLVideoElement>(null);
  const v = c.vista;
  const desde = v?.desde ?? c.inicio;
  const hasta = v?.hasta ?? c.fin;
  const [inicio, setInicio] = useState(c.inicio);
  const [fin, setFin] = useState(c.fin);
  const [estilo, setEstilo] = useState<string>("react");
  const [formato, setFormato] = useState("9:16");
  const [gancho, setGancho] = useState("");
  const [titulo, setTitulo] = useState("");
  const [ideas, setIdeas] = useState<{ ganchos: string[]; titulo: string | null } | null>(null);
  const [pensando, setPensando] = useState(false);
  const [errorIdeas, setErrorIdeas] = useState<string | null>(null);
  const [tienePermiso, setTienePermiso] = useState(f.info.plataforma === "archivo");
  const [tipoPermiso, setTipoPermiso] = useState<string>(f.info.plataforma === "archivo" ? "propio" : "campania");
  const [detallePermiso, setDetallePermiso] = useState("");
  const [glosario, setGlosario] = useState("");
  const [mejorarVoz, setMejorarVoz] = useState(true);
  const [prueba, setPrueba] = useState<{ antes: string; despues: string; clave: string } | null>(null);
  const [probando, setProbando] = useState(false);
  const [errorPrueba, setErrorPrueba] = useState<string | null>(null);
  const clavePrueba = `${inicio.toFixed(1)}-${fin.toFixed(1)}`;
  async function escucharPrueba() {
    setProbando(true);
    setErrorPrueba(null);
    try {
      const r = await postJson<{ antes: string; despues: string }>("/api/clips/voz-prueba", { fuenteId: f.id, inicio, fin });
      setPrueba({ ...r, clave: clavePrueba });
    } catch (err) {
      setErrorPrueba(err instanceof Error ? err.message : String(err));
    } finally {
      setProbando(false);
    }
  }
  const sugeridos = sugerirGlosario(f.info.titulo, f.info.canal).filter((t) => !glosario.toLocaleLowerCase("es").split(",").map((x) => x.trim()).includes(t.toLocaleLowerCase("es")));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dur = fin - inicio;
  const ahora = () => (ref.current ? desde + ref.current.currentTime : inicio);

  function verRecorte() {
    const el = ref.current;
    if (!el) return;
    el.currentTime = inicio - desde;
    void el.play();
  }

  async function sugerir() {
    setPensando(true);
    setErrorIdeas(null);
    try {
      const r = await postJson<{ ganchos: string[]; titulo: string | null }>("/api/clips/ganchos", { fuenteId: f.id, momento: c.n, react: estilo === "react" });
      setIdeas(r);
      if (!gancho && r.ganchos[0]) setGancho(r.ganchos[0]);
    } catch (err) {
      setErrorIdeas(err instanceof Error ? err.message : String(err));
    } finally {
      setPensando(false);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const tp = PERMISOS.find((p) => p.id === tipoPermiso)!;
    const permiso = tienePermiso ? `${tp.texto.toLowerCase()}${detallePermiso.trim() ? ` (${detallePermiso.trim()})` : ""}` : undefined;
    try {
      const r = await postJson<{ proyecto: { id: string } }>("/api/clips", {
        fuenteId: f.id, inicio: Math.round(inicio * 10) / 10, fin: Math.round(fin * 10) / 10, encuadre: estilo, formato,
        idioma: f.idioma ?? "es", plantilla: "gta-vi-shorts", gancho, titulo: estilo === "react" ? titulo : "", permiso, glosario: glosario.trim() || undefined, mejorarVoz,
      });
      router.push(`/proyectos/${r.proyecto.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={crear} className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">Ajusta tu clip</h2>
        <button type="button" className="boton ml-auto" onClick={volver}>← Elegir otro momento</button>
      </div>

      <section className="tarjeta space-y-3 p-4">
        <h3 className="font-medium">1. ¿Dónde empieza y dónde termina?</h3>
        {v ? (
          <video ref={ref} src={archivo(v.video)} poster={archivo(v.poster)} controls className="w-full rounded bg-black"
            onLoadedMetadata={(e) => { e.currentTarget.currentTime = inicio - desde; }}
            onTimeUpdate={(e) => { if (desde + e.currentTarget.currentTime >= fin) e.currentTarget.pause(); }} />
        ) : <Aviso tipo="info">Este momento no tiene vista previa: ajusta con los números.</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="ini">Empieza en {mmss(inicio)}</label>
            <input id="ini" type="range" className="w-full accent-cyan-500" min={desde} max={hasta} step={0.1} value={inicio}
              onChange={(e) => { const x = Math.min(Number(e.target.value), fin - 3); setInicio(x); if (ref.current) ref.current.currentTime = x - desde; }} />
            {v && <button type="button" className="boton mt-1" onClick={() => setInicio(Math.min(ahora(), fin - 3))}>Empezar donde está el video</button>}
          </div>
          <div>
            <label className="etiqueta" htmlFor="fin">Termina en {mmss(fin)}</label>
            <input id="fin" type="range" className="w-full accent-cyan-500" min={desde} max={hasta} step={0.1} value={fin}
              onChange={(e) => { const x = Math.max(Number(e.target.value), inicio + 3); setFin(x); if (ref.current) ref.current.currentTime = Math.max(0, x - desde - 2); }} />
            {v && <button type="button" className="boton mt-1" onClick={() => setFin(Math.max(ahora(), inicio + 3))}>Terminar donde está el video</button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {v && <button type="button" className="boton" onClick={verRecorte}>▶ Ver mi recorte</button>}
          <span className={`text-sm ${dur < 7 || dur > 60 ? "text-amber-300" : "text-tenue"}`}>
            Dura {segundos(dur)}{dur < 7 ? " · muy corto: la gente no alcanza a entenderlo" : dur > 60 ? " · largo: los clips de 15 a 40 s funcionan mejor" : " · buena duración"}
          </span>
        </div>
        <div className="space-y-2 border-t border-borde pt-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={mejorarVoz} onChange={(e) => setMejorarVoz(e.target.checked)} />
            <span>Mejorar la voz
              <span className="block text-xs text-tenue">Quita el ruido de fondo (ventilador, teclado, zumbido) y empareja gritos y susurros. Apágalo si la voz ya suena bien o si notas que cambia de más.</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="boton" disabled={probando} onClick={() => void escucharPrueba()}>
              {probando ? "Preparando (unos segundos)…" : prueba && prueba.clave === clavePrueba ? "↻ Volver a preparar" : "🎧 Escuchar antes y después"}
            </button>
            {prueba && prueba.clave !== clavePrueba && <span className="text-xs text-tenue">Cambiaste el recorte: vuelve a prepararlo para oír el nuevo tramo.</span>}
          </div>
          {errorPrueba && <Aviso tipo="alerta">No se pudo preparar la prueba: {errorPrueba}</Aviso>}
          {prueba && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="etiqueta">Antes (como está)</span>
                <audio controls preload="none" src={archivo(prueba.antes)} className="w-full" />
              </div>
              <div>
                <span className="etiqueta">Después (voz mejorada)</span>
                <audio controls preload="none" src={archivo(prueba.despues)} className="w-full" />
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="tarjeta space-y-3 p-4">
        <h3 className="font-medium">2. ¿Cómo se ve en el teléfono?</h3>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Estilo">
          {ESTILOS.map((s) => (
            <label key={s.id} className={`cursor-pointer rounded-xl border p-3 text-center ${estilo === s.id ? "border-cyan-500 bg-cyan-950/40 ring-2 ring-cyan-500" : "border-borde hover:border-cyan-800"}`}>
              <input type="radio" name="estilo" value={s.id} checked={estilo === s.id} onChange={() => setEstilo(s.id)} className="sr-only" />
              <Dibujo id={s.id} />
              <span className="mt-2 block font-medium">{s.nombre}</span>
              <span className="block text-xs text-tenue">{s.para}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-tenue">Si Geeper no encuentra una cara clara, usa «Video completo» y te lo dice. Lo puedes cambiar después.</p>
      </section>

      <section className="tarjeta space-y-3 p-4">
        <h3 className="font-medium">3. La frase del principio</h3>
        <p className="text-sm text-tenue">Una frase corta que sale en los primeros 2 segundos para que la gente no pase de largo.</p>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Gancho" className="campo grow" value={gancho} maxLength={160} onChange={(e) => setGancho(e.target.value)} placeholder="Ej.: Nadie vio venir lo que pasó aquí" />
          <button type="button" className="boton" disabled={pensando || !c.texto} onClick={() => void sugerir()} title={!c.texto ? "Este momento no tiene palabras" : undefined}>
            {pensando ? "Pensando (hasta 1 min)…" : "✨ Sugerirme ideas"}
          </button>
        </div>
        {errorIdeas && <Aviso tipo="alerta">{errorIdeas}</Aviso>}
        {ideas && ideas.ganchos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ideas.ganchos.map((g) => (
              <button key={g} type="button" aria-pressed={gancho === g} onClick={() => setGancho(g)} className={`rounded-full border px-3 py-1 text-sm ${gancho === g ? "border-cyan-500 bg-cyan-950/50 ring-2 ring-cyan-500" : "border-borde hover:border-cyan-700"}`}>{g}</button>
            ))}
          </div>
        )}
        {estilo === "react" && (
          <div>
            <label className="etiqueta" htmlFor="titulo">Título fijo en la mitad (opcional)</label>
            <div className="flex flex-wrap gap-2">
              <input id="titulo" className="campo grow" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Kai PIERDE LA CABEZA cuando llega la policía" />
              {ideas?.titulo && <button type="button" className="boton" onClick={() => setTitulo(ideas.titulo!)}>Usar: {ideas.titulo}</button>}
            </div>
          </div>
        )}
        <p className="text-xs text-tenue">Describe lo que pasa. Nunca pongas frases que la persona no dijo, ni «oficial», ni promesas que el clip no cumple.</p>
      </section>

      <section className="tarjeta space-y-3 p-4">
        <h3 className="font-medium">4. ¿Se dicen nombres difíciles? <span className="font-normal text-tenue">(opcional)</span></h3>
        <p className="text-sm text-tenue">
          Nombres de personas, juegos o lugares que se oyen en el clip, para que los subtítulos los escriban bien. Sepáralos con
          comas. Si no hay, déjalo vacío: escribir palabras de más puede cambiar otras.
        </p>
        <input aria-label="Nombres difíciles" className="campo w-full" value={glosario} maxLength={400}
          onChange={(e) => setGlosario(e.target.value)} placeholder="Ej.: Lucia, Vice City, GTA VI" />
        {sugeridos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-tenue">Del video:</span>
            {sugeridos.map((t) => (
              <button key={t} type="button" className="rounded-full border border-borde px-3 py-1 hover:border-cyan-700"
                onClick={() => setGlosario(sumarAlGlosario(glosario, t))} aria-label={`Agregar ${t}`}>+ {t}</button>
            ))}
          </div>
        )}
      </section>

      <section className="tarjeta space-y-3 p-4">
        <h3 className="font-medium">5. ¿Tienes permiso para usar este video?</h3>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={tienePermiso} onChange={(e) => setTienePermiso(e.target.checked)} />
          Sí, tengo permiso
        </label>
        {tienePermiso ? (
          <div className="space-y-2 pl-6">
            {PERMISOS.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="permiso" checked={tipoPermiso === p.id} onChange={() => setTipoPermiso(p.id)} /> {p.texto}
              </label>
            ))}
            {tipoPermiso !== "propio" && (
              <input aria-label="Dónde está el permiso" className="campo" value={detallePermiso} maxLength={200} onChange={(e) => setDetallePermiso(e.target.value)}
                placeholder={tipoPermiso === "campania" ? "Nombre o enlace de la campaña" : "Dónde te autorizó (mensaje, correo…)"} />
            )}
          </div>
        ) : (
          <Aviso tipo="alerta">
            Puedes crear el clip para practicar, pero no lo publiques sin permiso: las redes lo pueden bajar y te pueden quitar la cuenta. Muchos creadores tienen campañas que pagan por clips.
          </Aviso>
        )}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-tenue">Más opciones</summary>
        <div className="mt-2 flex flex-wrap gap-4">
          <div>
            <label className="etiqueta" htmlFor="formato">Forma del video</label>
            <select id="formato" className="campo" value={formato} onChange={(e) => setFormato(e.target.value)}>
              <option value="9:16">Vertical (TikTok, Reels, Shorts)</option><option value="1:1">Cuadrado</option><option value="16:9">Horizontal (YouTube)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 self-end">
            <input type="radio" name="estilo" checked={estilo === "cubrir"} onChange={() => setEstilo("cubrir")} /> Recortar al centro (sin seguir caras)
          </label>
        </div>
      </details>

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="boton boton-primario px-5 py-2 text-base" disabled={enviando || dur < 3}>{enviando ? "Creando…" : "Crear mi clip"}</button>
        <span className="text-xs text-tenue">Tarda 1 o 2 minutos. Después lo puedes corregir: subtítulos, cortar palabras, quitar partes.</span>
      </div>
    </form>
  );
}
