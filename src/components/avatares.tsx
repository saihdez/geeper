"use client";
import { useEffect, useMemo, useState } from "react";
import { cancelarAlSalir, escribirEstadoAsistente, leerEstadoAsistente, pedidoAvatar, puedeCrearAvatar, volverSeguro, type EstadoAsistente, type TextosAvatar } from "@/lib/asistente-avatar";
import { Aviso, Barra, CIRCULO_PASO, CLASE_PASO, pedir, postJson, useSondeo } from "./comun";
import { ElegirVozAvatar, type VozElegida } from "./elegir-voz-avatar";

export interface AvatarV {
  id: string;
  nombre: string;
  descripcion: string;
  estilo: string;
  estiloNombre: string;
  origen: "descripcion" | "foto";
  retrato: string;
  puedeDeshacer: boolean;
  /** Retoque hecho que espera la elección de la persona. */
  retoque: { nota: string; opciones: string[] } | null;
  voz?: VozElegida;
  versiones: { nota: string; fecha: string }[];
}
interface Opcion { id: string; nombre: string; detalle?: string }
interface TrabajoV { id: string; tipo: string; estado: string; etapa: string; progreso: number; error: string | null; avatar: string | null; propuesta: string | null }
interface Datos {
  wan2gp: { listo: boolean; falta: string | null; instalando: boolean };
  avatares: AvatarV[];
  estilos: Opcion[];
  fondos: Opcion[];
  luces: Opcion[];
  looks: Opcion[];
  consentimiento: string;
  maxDescripcion: number;
  trabajos: TrabajoV[];
}
interface Avance { estado: string; etapa: string; progreso: number; error: string | null; conFoto: boolean; tomas: { numero: number; url: string }[] }

const EJEMPLOS = [
  "Mujer de unos 30 años, pelo castaño recogido, blusa blanca, sonrisa amable",
  "Hombre mayor con barba canosa y lentes redondos, suéter de lana, aire de profesor",
  "Robot simpático de metal azul con ojos grandes y luminosos",
  "Chica joven de pelo corto rosa, chaqueta de mezclilla, muy expresiva",
];
const RETOQUES = ["Ponle lentes", "Que sonría un poco", "Cámbiale la ropa por un traje azul marino", "Ponle un fondo de oficina desenfocado", "Hazle el pelo más corto", "Que se vea más nítido"];

const enCurso = (e?: string) => e === "pendiente" || e === "corriendo";

/** Guarda en la URL por dónde va el asistente, para retomarlo al recargar o volver (UX-13). */
function guardarEnUrl(e: EstadoAsistente | null) {
  try {
    const q = escribirEstadoAsistente(window.location.search, e);
    if (q !== window.location.search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${q}${window.location.hash}`);
  } catch {
    /* sin URL que tocar */
  }
}

/** Avatares: crear (describirlo o desde una foto), elegir entre varias tomas, nombrarlo y retocarlo. */
export function PaginaAvatares() {
  const { datos, error, recargar } = useSondeo<Datos>("/api/avatares", 5000, ["trabajos"]);
  const [creando, setCreando] = useState(false);
  const [inicial, setInicial] = useState<EstadoAsistente | null>(null);
  // Al llegar los datos: retomar lo que dice la URL o, si no, las opciones que se están dibujando (UX-13).
  // Se hace una vez, durante el render (los datos sólo llegan en el navegador).
  const [retomado, setRetomado] = useState(false);
  // Si se llegó desde un video («Presentador»), el enlace para volver a él (UX-32).
  const [volver, setVolver] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  if (datos && !retomado) {
    setRetomado(true);
    setVolver(volverSeguro(new URLSearchParams(window.location.search).get("volver")));
    const t = datos.trabajos.find((x) => x.tipo === "avatar.proponer" && enCurso(x.estado) && x.propuesta);
    const e = leerEstadoAsistente(window.location.search) ?? (t ? { propuesta: t.propuesta!, trabajo: t.id } : null);
    if (e && datos.wan2gp.listo) {
      setInicial(e);
      setCreando(true);
    }
  }
  if (error && !datos) return <Aviso tipo="error">{error}</Aviso>;
  if (!datos) return <p className="text-tenue">Cargando…</p>;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Avatares</h1>
        <p className="text-sm text-tenue">
          Un personaje, realista o animado, que presenta tus videos hablando con la voz del video. Se crea una vez y después lo eliges desde
          cualquier proyecto («Presentador»). Todo se hace en esta computadora, sin pagar nada.
        </p>
        {volver && !guardado && <a className="inline-block text-sm text-acento underline" href={volver}>← Volver a tu video</a>}
      </header>
      {guardado && (
        <Aviso tipo="ok">
          Listo: ya está en tu biblioteca.{" "}
          {volver ? <>Ahora vuelve a tu video y elígelo en «Presentador». <a className="boton boton-primario ml-2 inline-block" href={volver}>Volver a tu video</a></> : "Ya lo puedes elegir en «Presentador» desde cualquier video."}
        </Aviso>
      )}
      {!datos.wan2gp.listo ? (
        <div className="space-y-2">
          <Aviso tipo="info">
            {datos.wan2gp.instalando
              ? "Se está instalando el programa que dibuja y anima los avatares. Cuando termine (míralo en Sistema), vuelve aquí."
              : "Para crear avatares hace falta instalar una vez Wan2GP, el programa gratuito que usa la tarjeta de video de este equipo (el mismo de «Animar esta escena»)."}
          </Aviso>
          <a className="boton boton-primario inline-block" href="/sistema#wan2gp">Ir a Sistema para instalarlo</a>
        </div>
      ) : creando ? (
        <Crear datos={datos} inicial={inicial} alGuardar={() => setGuardado(true)} cerrar={() => { guardarEnUrl(null); setInicial(null); setCreando(false); void recargar(); }} />
      ) : (
        <button className="boton boton-primario" onClick={() => { setGuardado(false); setCreando(true); }}>＋ Crear un avatar</button>
      )}
      {datos.avatares.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tu biblioteca</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {datos.avatares.map((a) => (
              <Tarjeta key={a.id} avatar={a} listo={datos.wan2gp.listo} trabajo={datos.trabajos.find((t) => t.tipo === "avatar.retocar" && t.avatar === a.id) ?? null} cambio={() => void recargar()} />
            ))}
          </div>
        </section>
      ) : (
        !creando && <p className="text-sm text-tenue">Todavía no tienes avatares. Crea el primero: tarda unos 2 minutos.</p>
      )}
    </div>
  );
}

function Paso({ actual, n, titulo }: { actual: number; n: number; titulo: string }) {
  return (
    <li className={`flex items-center gap-2 ${CLASE_PASO[actual === n ? "actual" : actual > n ? "hecho" : "pendiente"]}`} aria-current={actual === n ? "step" : undefined}>
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${CIRCULO_PASO[actual === n ? "actual" : actual > n ? "hecho" : "pendiente"]}`}>{actual > n ? "✓" : n}</span>
      {titulo}
    </li>
  );
}

function Crear({ datos, inicial, cerrar, alGuardar }: { datos: Datos; inicial: EstadoAsistente | null; cerrar: () => void; alGuardar: () => void }) {
  const [paso, setPaso] = useState<1 | 2 | 3>(inicial ? 2 : 1);
  const [conFoto, setConFoto] = useState(false);
  const [estilo, setEstilo] = useState("realista");
  // Un texto por modo (UX-23): lo escrito para «Describirlo» no viaja como cambio sobre la foto de alguien.
  const [textos, setTextos] = useState<TextosAvatar>({ palabras: "", foto: "" });
  const descripcion = conFoto ? textos.foto : textos.palabras;
  const setDescripcion = (v: string) => setTextos((t) => (conFoto ? { ...t, foto: v } : { ...t, palabras: v }));
  const [fondo, setFondo] = useState("liso");
  const [luz, setLuz] = useState("");
  const [look, setLook] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const vistaFoto = useMemo(() => (foto ? URL.createObjectURL(foto) : null), [foto]);
  useEffect(() => () => {
    if (vistaFoto) URL.revokeObjectURL(vistaFoto);
  }, [vistaFoto]);
  const [consiento, setConsiento] = useState(false);
  const [pedido, setPedido] = useState<{ propuesta: string; trabajo: string } | null>(inicial ? { propuesta: inicial.propuesta, trabajo: inicial.trabajo } : null);
  const [avance, setAvance] = useState<Avance | null>(null);
  const [elegida, setElegida] = useState<number | null>(inicial?.toma ?? null);

  useEffect(() => {
    if (pedido) guardarEnUrl({ ...pedido, ...(elegida ? { toma: elegida } : {}) });
  }, [pedido, elegida]);
  const [nombre, setNombre] = useState("");
  const [voz, setVoz] = useState<VozElegida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const d = await pedir<Avance>(`/api/avatares/propuestas?propuesta=${pedido.propuesta}&trabajo=${pedido.trabajo}`);
        if (!vivo) return;
        setAvance(d);
        if (enCurso(d.estado)) t = setTimeout(() => void tick(), 3000);
      } catch (e) {
        if (!vivo) return;
        const m = (e as Error).message;
        if (/No existe esa propuesta/.test(m)) {
          // Lo que guardaba la URL ya no existe (se borró, es de otra PC…): se empieza de nuevo.
          guardarEnUrl(null);
          setPedido(null);
          setPaso(1);
          setError("Esas opciones ya no están: crea el avatar de nuevo.");
        } else setError(m);
      }
    };
    void tick();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [pedido]);

  const puede = puedeCrearAvatar(conFoto, textos, !!foto, consiento);

  async function empezar() {
    setError(null);
    setEnviando(true);
    try {
      const f = new FormData();
      f.set("pedido", JSON.stringify(pedidoAvatar({ conFoto, textos, estilo, fondo, luz, look })));
      if (conFoto && foto) {
        f.set("foto", foto);
        f.set("consiento", consiento ? "si" : "no");
      }
      const r = await pedir<{ propuesta: string; trabajo: string }>("/api/avatares", { method: "POST", body: f });
      setAvance(null);
      setElegida(null);
      setPedido(r);
      setPaso(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function otras() {
    if (!pedido) return;
    setError(null);
    try {
      const r = await postJson<{ propuesta: string; trabajo: string }>("/api/avatares/propuestas", { accion: "otras", propuesta: pedido.propuesta });
      setPedido(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Con las opciones dibujándose, «Cancelar» lo pregunta y para el trabajo (no deja la tarjeta ocupada a escondidas). */
  async function cancelar() {
    if (pedido && cancelarAlSalir(pedido, avance?.estado)) {
      if (!confirm("¿Dejar de dibujar? Se pierde lo que lleva.")) return;
      try {
        await postJson(`/api/trabajos/${pedido.trabajo}`, { accion: "cancelar" });
      } catch {
        /* ya había terminado */
      }
    }
    cerrar();
  }

  async function guardar() {
    if (!pedido || !elegida) return;
    setError(null);
    setEnviando(true);
    try {
      await postJson("/api/avatares/propuestas", { accion: "guardar", propuesta: pedido.propuesta, toma: elegida, nombre, ...(voz ? { voz } : {}) });
      alGuardar();
      cerrar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="tarjeta space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ol className="flex flex-wrap gap-4 text-sm">
          <Paso actual={paso} n={1} titulo="Cómo lo quieres" />
          <Paso actual={paso} n={2} titulo="Elige el que más te guste" />
          <Paso actual={paso} n={3} titulo="Nombre y voz" />
        </ol>
        <button className="boton" onClick={() => void cancelar()}>Cancelar</button>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      {paso === 1 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="De dónde sale el avatar">
            <button type="button" role="radio" aria-checked={!conFoto} className="opcion" onClick={() => setConFoto(false)}>Describirlo con palabras</button>
            <button type="button" role="radio" aria-checked={conFoto} className="opcion" onClick={() => setConFoto(true)}>Desde una foto</button>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Estilo</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {datos.estilos.map((e) => (
                <button key={e.id} type="button" aria-pressed={estilo === e.id} onClick={() => setEstilo(e.id)}
                  className="opcion-tarjeta p-3">
                  <span className="block font-medium">{e.nombre}</span>
                  <span className="block text-xs text-tenue">{e.detalle}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {conFoto ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Foto de frente, con la cara bien visible</p>
              <div className="flex flex-wrap items-center gap-3">
                {vistaFoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={vistaFoto} alt="La foto que elegiste" className="h-24 w-24 rounded-lg object-cover" />
                )}
                <label className="boton cursor-pointer">
                  {foto ? "Cambiar la foto" : "Elegir una foto"}
                  <input type="file" accept=".png,.jpg,.jpeg,.webp" className="sr-only" onChange={(ev) => setFoto(ev.target.files?.[0] ?? null)} />
                </label>
                {foto && <span className="text-xs text-tenue">Mírala: ¿se ve bien la cara, de frente?</span>}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={consiento} onChange={(ev) => setConsiento(ev.target.checked)} />
                <span>{datos.consentimiento}</span>
              </label>
              <p className="text-xs text-tenue">Queda anotado junto al avatar. No uses la cara de alguien sin su permiso.</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="desc-avatar">{conFoto ? "¿Algo que cambiar? (opcional)" : "¿Cómo es?"}</label>
            <textarea id="desc-avatar" className="campo min-h-24" maxLength={datos.maxDescripcion} value={descripcion} onChange={(ev) => setDescripcion(ev.target.value)}
              placeholder={conFoto ? "Por ejemplo: con camisa azul" : "Edad, pelo, ropa, actitud… mientras más detalle, mejor"} />
            {!conFoto && (
              <div className="flex flex-wrap gap-2">
                {EJEMPLOS.map((x) => <button key={x} type="button" className="boton text-xs" onClick={() => setDescripcion(x)}>{x}</button>)}
              </div>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Fondo</legend>
            <div className="flex flex-wrap gap-2">
              {datos.fondos.map((f) => <button key={f.id} type="button" aria-pressed={fondo === f.id} className="opcion" onClick={() => setFondo(f.id)}>{f.nombre}</button>)}
            </div>
          </fieldset>

          <details className="text-sm">
            <summary className="cursor-pointer text-tenue">Más opciones (luz y look)</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1"><span className="block text-xs text-tenue">Luz</span>
                <select className="campo" value={luz} onChange={(ev) => setLuz(ev.target.value)}>
                  <option value="">Luz de estudio uniforme (recomendada)</option>
                  {/* «estudio» es la misma luz que la recomendada: no se repite (UX-32). */}
                  {datos.luces.filter((l) => l.id !== "estudio").map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="block text-xs text-tenue">Look</span>
                <select className="campo" value={look} onChange={(ev) => setLook(ev.target.value)}>
                  <option value="">Natural</option>
                  {datos.looks.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
            </div>
          </details>

          <div className="space-y-1">
            <button className="boton boton-primario" disabled={!puede || enviando} onClick={() => void empezar()}>
              {enviando ? "Enviando…" : conFoto ? "Crear 2 versiones" : "Crear 4 opciones"}
            </button>
            <p className="text-xs text-tenue">
              Usa la tarjeta de video: mientras tanto se pausa la generación de videos. Tarda unos 2 minutos; la primera vez, unos 6, porque
              baja el modelo (unos 11 GB).
            </p>
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-3">
          {avance && enCurso(avance.estado) && (
            <div className="space-y-1">
              <p className="text-sm">{avance.estado === "pendiente" ? "En espera: la tarjeta de video está ocupada con otro trabajo." : avance.etapa || "Dibujando…"}</p>
              <Barra valor={avance.progreso} />
            </div>
          )}
          {avance?.estado === "fallido" && <Aviso tipo="error">No se pudo crear: {avance.error?.split("\n")[0]}</Aviso>}
          {avance && avance.tomas.length > 0 && (
            <>
              <p className="text-sm">Toca el que más te guste. Para que hable bien, conviene que mire de frente y con la boca cerrada.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {avance.tomas.map((t) => (
                  <button key={t.url} type="button" aria-pressed={elegida === t.numero} onClick={() => setElegida(t.numero)}
                    className="opcion-tarjeta overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.url} alt={`Opción ${t.numero}`} className="aspect-[832/1216] w-full object-cover" />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="boton" onClick={() => setPaso(1)}>← Cambiar la descripción</button>
            <button className="boton" disabled={!avance || enCurso(avance.estado)} onClick={() => void otras()}>{avance?.conFoto ? "Hacer otras 2" : "Hacer otras 4"}</button>
            <button className="boton boton-primario" disabled={!elegida} onClick={() => setPaso(3)}>Usar éste →</button>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">¿Cómo se llama?</span>
            <input className="campo max-w-sm" maxLength={60} value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Por ejemplo: Sofía" />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">¿Con qué voz habla? <span className="font-normal text-tenue">(escúchalas; se puede cambiar después)</span></legend>
            <ElegirVozAvatar valor={voz} cambiar={setVoz} nombreAvatar={nombre} />
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button className="boton" onClick={() => setPaso(2)}>← Elegir otro</button>
            <button className="boton boton-primario" disabled={!nombre.trim() || !voz || enviando} onClick={() => void guardar()}>Guardar en mi biblioteca</button>
          </div>
          {(!nombre.trim() || !voz) && <p className="text-xs text-tenue">Falta {!nombre.trim() && !voz ? "el nombre y la voz" : !nombre.trim() ? "el nombre" : "elegir la voz"}.</p>}
        </div>
      )}
    </section>
  );
}

function Tarjeta({ avatar: a, listo, trabajo, cambio }: { avatar: AvatarV; listo: boolean; trabajo: TrabajoV | null; cambio: () => void }) {
  const [retocar, setRetocar] = useState(false);
  const [editando, setEditando] = useState<"nombre" | "voz" | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState(a.nombre);
  const [instruccion, setInstruccion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function hacer(fn: () => Promise<unknown>) {
    setError(null);
    setOcupado(true);
    try {
      await fn();
      cambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const patch = (cuerpo: unknown) => pedir(`/api/avatares/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const retocando = trabajo && enCurso(trabajo.estado);
  return (
    <article className="tarjeta overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={a.retrato} alt={`Retrato de ${a.nombre}`} className={`aspect-[832/1216] w-full object-cover ${retocando ? "opacity-60" : ""}`} />
      <div className="space-y-2 p-3">
        <div>
          <h3 className="font-semibold">{a.nombre}</h3>
          <p className="text-xs text-tenue">{a.estiloNombre}{a.origen === "foto" ? " · desde una foto" : ""}{a.versiones.length ? ` · ${a.versiones.length} retoque${a.versiones.length === 1 ? "" : "s"}` : ""}</p>
          <p className="text-xs">{a.voz ? <>Voz: {a.voz.nombre}</> : <span className="text-amber-300">Sin voz elegida</span>}</p>
        </div>
        {editando === "nombre" && (
          <div className="space-y-2">
            <input className="campo" maxLength={60} value={nuevoNombre} onChange={(ev) => setNuevoNombre(ev.target.value)} aria-label="Nombre del avatar" />
            <div className="flex gap-2">
              <button className="boton boton-primario" disabled={ocupado || !nuevoNombre.trim()} onClick={() => void hacer(async () => { await patch({ nombre: nuevoNombre }); setEditando(null); })}>Guardar</button>
              <button className="boton" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {editando === "voz" && (
          <div className="space-y-2">
            <ElegirVozAvatar valor={a.voz ?? null} nombreAvatar={a.nombre} cambiar={(v) => void hacer(async () => { await patch({ voz: v }); setEditando(null); })} />
            <button className="boton" onClick={() => setEditando(null)}>Cerrar</button>
          </div>
        )}
        {retocando && (
          <div className="space-y-1">
            <p className="text-xs">{trabajo.estado === "pendiente" ? "Retoque en espera de la tarjeta de video" : trabajo.etapa || "Retocando…"}</p>
            <Barra valor={trabajo.progreso} />
          </div>
        )}
        {trabajo?.estado === "fallido" && !a.retoque && (
          <Aviso tipo="error">No se pudo retocar{trabajo.error ? `: ${trabajo.error}` : "."} Puedes volver a intentarlo.</Aviso>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        {a.retoque && !retocando && !editando && (
          <ElegirRetoque avatar={a} ocupado={ocupado} elegir={(toma) => void hacer(() => patch({ elegirRetoque: toma }))} />
        )}
        {editando ? null : retocar && !retocando && !a.retoque ? (
          <div className="space-y-2">
            <label className="block text-xs text-tenue" htmlFor={`ret-${a.id}`}>¿Qué le cambias? Se conserva su cara. Pide una cosa a la vez; salen 2 opciones y eliges.</label>
            <input id={`ret-${a.id}`} className="campo" maxLength={400} value={instruccion} onChange={(ev) => setInstruccion(ev.target.value)} placeholder="Ponle lentes" />
            <div className="flex flex-wrap gap-1">
              {RETOQUES.map((x) => <button key={x} type="button" className="boton text-xs" onClick={() => setInstruccion(x)}>{x}</button>)}
            </div>
            <div className="flex gap-2">
              <button className="boton boton-primario" disabled={ocupado || instruccion.trim().length < 3} onClick={() => void hacer(async () => { await postJson(`/api/avatares/${a.id}`, { instruccion }); setRetocar(false); setInstruccion(""); })}>Retocar</button>
              <button className="boton" onClick={() => setRetocar(false)}>Cerrar</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="boton" disabled={!listo || !!retocando || !!a.retoque} title={a.retoque ? "Primero elige una opción del retoque anterior" : undefined} onClick={() => setRetocar(true)}>Retocar</button>
            {a.puedeDeshacer && <button className="boton" disabled={ocupado || !!retocando} onClick={() => void hacer(() => patch({ deshacer: true }))}>Deshacer retoque</button>}
            <button className="boton" disabled={ocupado} onClick={() => setEditando("voz")}>{a.voz ? "Cambiar voz" : "Elegir voz"}</button>
            <button className="boton" disabled={ocupado} onClick={() => { setNuevoNombre(a.nombre); setEditando("nombre"); }}>Renombrar</button>
            <button className="boton boton-peligro" disabled={ocupado || !!retocando} onClick={() => {
              if (confirm(`¿Borrar a «${a.nombre}»? Los videos que ya lo usan no cambian.`)) void hacer(() => pedir(`/api/avatares/${a.id}`, { method: "DELETE" }));
            }}>Borrar</button>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Después de retocar: el retrato actual y las opciones, lado a lado. Nada cambia hasta que la persona
 * elige; «Quedarme con el actual» descarta el retoque (por si salió raro: imagen doble, otro encuadre…).
 */
function ElegirRetoque({ avatar: a, ocupado, elegir }: { avatar: AvatarV; ocupado: boolean; elegir: (toma: number | null) => void }) {
  const [elegida, setElegida] = useState<number | null>(null);
  const r = a.retoque!;
  return (
    <fieldset className="space-y-2 rounded-lg border border-cyan-700 p-2">
      <legend className="px-1 text-sm font-medium">Elige el retoque</legend>
      <p className="text-xs text-tenue">Pediste: «{r.nota}». Si ninguna te convence, quédate con el actual: no cambia nada.</p>
      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Opciones del retoque">
        {[{ toma: null as number | null, url: a.retrato, titulo: "Actual" }, ...r.opciones.map((url, i) => ({ toma: i + 1 as number | null, url, titulo: `Opción ${i + 1}` }))].map((o) => (
          <button key={o.titulo} type="button" role="radio" aria-checked={elegida === o.toma}
            className="opcion-tarjeta overflow-hidden text-xs"
            onClick={() => setElegida(o.toma)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.url} alt={o.titulo} className="aspect-[832/1216] w-full object-cover" />
            <span className="block py-0.5">{o.titulo}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="boton boton-primario" disabled={ocupado} onClick={() => elegir(elegida)}>{elegida === null ? "Quedarme con el actual" : `Usar la opción ${elegida}`}</button>
        {elegida !== null && <button className="boton" disabled={ocupado} onClick={() => elegir(null)}>Ninguna: quedarme con el actual</button>}
      </div>
    </fieldset>
  );
}
