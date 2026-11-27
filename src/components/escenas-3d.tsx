"use client";
import { useEffect, useMemo, useState } from "react";
import { Aviso, Barra, archivo, pedir, postJson, useSondeo } from "./comun";
import {
  CALIDADES_3D, COLORES_LOGO, DURACION_3D, ESTILOS_3D, FONDOS_3D, FONDOS_SALIDA_3D, FORMATOS_3D, INFO_PLANTILLAS, MAX_DATOS_3D, MOVIMIENTOS_3D, PALETAS_3D, PLANTILLAS_3D,
  SALIDAS_3D, TIPOS_DATOS_3D, minutosEstimados,
  type Calidad3d, type Colores3d, type FondoSalida3d, type Formato3d, type Plantilla3d, type Salida3d, type TipoDatos3d,
} from "@/lib/escenas3d-catalogo";

interface EstadoInstalacion { fase: string; progreso: number; detalle: string; disponible: boolean; mb: number | null }
export interface CorridaV {
  id: string;
  titulo: string;
  creada: string;
  estado: "preparada" | "hecha" | "fallida";
  error?: string;
  segundos?: number;
  pedido: { plantilla: Plantilla3d; formato: Formato3d; duracion: number; salida?: Salida3d; fondo_salida?: FondoSalida3d };
  video: string | null;
  /** WebM con alfa (video) o null. */
  transparente: string | null;
  /** PNG (salida «imagen») o null. */
  imagen: string | null;
  portada: string | null;
}
export interface TrabajoV { id: string; estado: string; etapa: string; progreso: number; corrida: string | null; proyecto: string | null; escena: string | null }
export interface Datos3d {
  blender: { listo: boolean; version: string | null; instalacion: EstadoInstalacion };
  describirConIa: boolean;
  corridas: CorridaV[];
  trabajos: TrabajoV[];
}

/** Lo que llega del editor cuando la escena 3D es para una escena de un video. */
export interface Destino3d { proyecto: string; escena: string; numero: number; formato: Formato3d; duracion: number }

export function useEscenas3d(ms = 4000) {
  return useSondeo<Datos3d>("/api/escenas-3d", ms);
}

// ---------------------------------------------------------------- piezas chicas

function Opciones<T extends string>({ valor, opciones, cambiar, columnas = 3 }: { valor: T; opciones: readonly { id: T; titulo: string; texto?: string }[]; cambiar: (v: T) => void; columnas?: 2 | 3 }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${columnas === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={valor === o.id} onClick={() => cambiar(o.id)}
          className={`rounded-lg border p-2 text-left ${valor === o.id ? "border-acento bg-acento/10" : "border-borde hover:border-acento/60"}`}>
          <span className="block text-sm font-medium">{o.titulo}</span>
          {o.texto && <span className="block text-xs text-tenue">{o.texto}</span>}
        </button>
      ))}
    </div>
  );
}

function Puntos({ c }: { c: Colores3d }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-full border border-white/20" aria-hidden>
      {[c.fondo, c.principal, c.acento].map((x, i) => <span key={i} className="h-5 w-5" style={{ background: x }} />)}
    </span>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-center gap-2 font-medium">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-acento/20 text-xs text-acento" aria-hidden>{n}</span>
        {titulo}
      </legend>
      {children}
    </fieldset>
  );
}

// ---------------------------------------------------------------- instalar Blender

/** Explica qué es y lo instala con un clic, con su avance. */
export function PrepararBlender({ datos, recargar, corto = false }: { datos: Datos3d; recargar: () => void; corto?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const i = datos.blender.instalacion;
  const trabajando = ["descargando", "verificando", "descomprimiendo"].includes(i.fase);
  useEffect(() => {
    if (!trabajando) return;
    const t = setInterval(recargar, 1000);
    return () => clearInterval(t);
  }, [trabajando, recargar]);
  async function instalar() {
    setError(null);
    try {
      await postJson("/api/sistema/blender", {});
      recargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!i.disponible) {
    return <Aviso tipo="alerta">En este equipo Blender no se instala solo. Bájalo gratis de blender.org (versión 5.2) y avísale a quien instaló Geeper.</Aviso>;
  }
  return (
    <div className="tarjeta space-y-3 p-4">
      <p className="font-medium">Para hacer escenas 3D, Geeper necesita Blender</p>
      {!corto && (
        <p className="text-sm text-tenue">
          Blender es el programa gratuito de 3D que usan estudios de todo el mundo. Geeper lo usa por detrás: tú no tienes que abrirlo ni
          aprender a usarlo. Se baja una sola vez (unos {i.mb ?? 400} MB) de la página oficial y se comprueba que sea el archivo original.
        </p>
      )}
      <button type="button" className="boton boton-primario" disabled={trabajando} onClick={() => void instalar()}>
        {trabajando ? "Instalando…" : "Instalar Blender con un clic"}
      </button>
      {trabajando && (
        <div className="space-y-1" aria-live="polite">
          <Barra valor={i.progreso} />
          <p className="text-xs text-tenue">{i.detalle}</p>
        </div>
      )}
      {i.fase === "error" && <Aviso tipo="error">No se pudo instalar: {i.detalle} Revisa la conexión y vuelve a intentar.</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}

// ---------------------------------------------------------------- crear

interface Estado3d {
  plantilla: Plantilla3d | null;
  texto: string;
  estilo: (typeof ESTILOS_3D)[number]["id"];
  movimiento: (typeof MOVIMIENTOS_3D)[number]["id"];
  estilo_fondo: (typeof FONDOS_3D)[number]["id"];
  colores_logo: (typeof COLORES_LOGO)[number]["id"];
  paleta: string | null;
  colores: Colores3d;
  formato: Formato3d;
  duracion: number;
  calidad: Calidad3d;
  tipo_datos: TipoDatos3d;
  /** Filas de la tabla: el número como lo escribe la persona («1,200», «3.5»). */
  datos: { etiqueta: string; valor: string }[];
  unidad: string;
  salida: Salida3d;
  fondo_salida: FondoSalida3d;
}

/** «1,200» / «1.200» → 1200; «3,5» / «3.5» → 3.5; vacío o texto → null. */
export function numeroEscrito(t: string): number | null {
  const x = t.trim().replace(/\s/g, "").replace(/^[$€]/, "").replace(/%$/, "");
  if (!x) return null;
  const n = /^-?\d{1,3}([.,]\d{3})+$/.test(x) ? x.replace(/[.,]/g, "") : x.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

const UNIDADES = [{ id: "", titulo: "Ninguna" }, { id: "%", titulo: "%" }, { id: "$", titulo: "$" }, { id: "kg", titulo: "kg" }] as const;

const inicial = (destino?: Destino3d): Estado3d => ({
  plantilla: null, texto: "", estilo: "brillante", movimiento: "entra", estilo_fondo: "burbujas", colores_logo: "originales",
  paleta: PALETAS_3D[0]!.id, colores: { ...PALETAS_3D[0]!.colores },
  formato: destino?.formato ?? "9:16",
  duracion: Math.min(DURACION_3D.max, Math.max(DURACION_3D.min, Math.round(destino?.duracion ?? DURACION_3D.porDefecto))),
  calidad: "normal",
  tipo_datos: "barras",
  datos: [{ etiqueta: "", valor: "" }, { etiqueta: "", valor: "" }, { etiqueta: "", valor: "" }],
  unidad: "",
  salida: "video",
  fondo_salida: "color",
});

/** «Descríbelo y lo armo»: el modelo local elige la plantilla y los ajustes; la persona los revisa abajo. */
function Describir({ conIa, aplicar }: { conIa: boolean; aplicar: (s: Partial<Estado3d> & { explicacion: string }) => void }) {
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ejemplos = ["Un título dorado que diga «Gran apertura»", "Un gráfico de barras: enero 120, febrero 340, marzo 510", "Mi logo girando en metal sobre fondo negro", "Una caja de regalo rosa que revele «¡Sorteo!»"];
  async function armar() {
    setError(null);
    setPensando(true);
    try {
      const s = await postJson<Omit<Estado3d, "paleta" | "formato" | "duracion" | "calidad" | "colores_logo" | "datos" | "salida" | "fondo_salida"> & { datos: { etiqueta: string; valor: number }[]; explicacion: string; origen: string }>("/api/escenas-3d/describir", { texto });
      const datos = s.datos.length ? s.datos.map((d) => ({ etiqueta: d.etiqueta, valor: String(d.valor) })) : undefined;
      aplicar({ ...s, datos, paleta: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPensando(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-borde p-3">
      <p className="text-sm font-medium">O descríbelo con tus palabras y yo la armo</p>
      <textarea className="campo min-h-20 w-full" maxLength={600} value={texto} onChange={(e) => setTexto(e.target.value)}
        placeholder="Ej.: un título en 3D rojo que diga «Promo 2x1» y que caiga rebotando" aria-label="Describe la escena 3D" />
      <div className="flex flex-wrap gap-1">
        {ejemplos.map((x) => <button key={x} type="button" className="rounded-full border border-borde px-2 py-0.5 text-xs text-tenue hover:text-white" onClick={() => setTexto(x)}>{x}</button>)}
      </div>
      <button type="button" className="boton" disabled={pensando || texto.trim().length < 3} onClick={() => void armar()}>{pensando ? "Pensando…" : "Armar con esta descripción"}</button>
      {pensando && conIa && <p className="text-xs text-tenue" aria-live="polite">El asistente de tu PC está leyendo lo que escribiste (puede tardar hasta un minuto).</p>}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}

/** El asistente completo: plantilla → ajustes → formato y calidad → crear. */
export function CrearEscena3d({ destino, alCrear }: { destino?: Destino3d; alCrear?: () => void }) {
  const [e, setE] = useState<Estado3d>(() => inicial(destino));
  const [archivoSubido, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [fondoSubido, setFondo] = useState<File | null>(null);
  const [vistaFondo, setVistaFondo] = useState<string | null>(null);
  const [propios, setPropios] = useState(false);
  const [entendido, setEntendido] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const { datos } = useEscenas3d(30_000);
  const info = e.plantilla ? INFO_PLANTILLAS[e.plantilla] : null;
  const poner = (x: Partial<Estado3d>) => setE((v) => ({ ...v, ...x }));

  function elegirArchivo(f: File | null) {
    setArchivo(f);
    setVista((antes) => {
      if (antes) URL.revokeObjectURL(antes);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  function elegirFondo(f: File | null) {
    setFondo(f);
    setVistaFondo((antes) => {
      if (antes) URL.revokeObjectURL(antes);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  /** Las filas con número (las vacías no cuentan). */
  const cifras = useMemo(() => e.datos.flatMap((d) => {
    const v = numeroEscrito(d.valor);
    return v === null ? [] : [{ etiqueta: d.etiqueta.trim().slice(0, 18), valor: v }];
  }), [e.datos]);
  const filaMala = e.datos.findIndex((d) => d.valor.trim() && numeroEscrito(d.valor) === null);

  const falta = useMemo(() => {
    if (!info) return "Elige cómo empieza.";
    if (info.obligatorios.includes("texto") && !e.texto.trim()) return "Escribe el texto.";
    if (info.obligatorios.includes("imagen") && !archivoSubido) return "Sube la foto de tu producto.";
    if (info.obligatorios.includes("logo") && !archivoSubido) return "Sube tu logo.";
    if (info.obligatorios.includes("datos")) {
      if (filaMala >= 0) return `En la fila ${filaMala + 1}, el número no se entiende (escribe sólo cifras, como 1200 o 3.5).`;
      if (!cifras.length) return "Escribe al menos un número.";
      if (e.tipo_datos === "pastel" && cifras.length < 2) return "Para el anillo hacen falta al menos dos partes.";
    }
    if (e.fondo_salida === "foto" && !fondoSubido) return "Sube la foto de fondo (o elige otro fondo).";
    return null;
  }, [info, e.texto, e.tipo_datos, e.fondo_salida, archivoSubido, fondoSubido, cifras, filaMala]);

  async function crear() {
    if (!e.plantilla) return;
    setError(null);
    setEnviando(true);
    try {
      const fd = new FormData();
      const { paleta: _p, ...pedido } = e;
      fd.set("pedido", JSON.stringify({ ...pedido, plantilla: e.plantilla, texto: info!.campos.includes("texto") ? e.texto : "", datos: info!.campos.includes("datos") ? cifras : [] }));
      if (archivoSubido && (info!.campos.includes("imagen") || info!.campos.includes("logo"))) fd.set("archivo", archivoSubido);
      if (fondoSubido && e.fondo_salida === "foto") fd.set("fondo", fondoSubido);
      if (destino) {
        fd.set("proyecto", destino.proyecto);
        fd.set("escena", destino.escena);
      }
      await pedir("/api/escenas-3d", { method: "POST", body: fd });
      setListo(true);
      alCrear?.();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="space-y-2">
        <Aviso tipo="ok">
          ¡En camino! Tarda unos {minutosEstimados(e.calidad, e.duracion, true, e.salida)} min.{" "}
          {destino ? `Cuando termine, la escena ${destino.numero} cambia sola (si no te gusta, vuelve atrás en el historial).` : "Puedes seguir usando Geeper: la vas a ver abajo, en «Tus escenas 3D»."}
        </Aviso>
        <button type="button" className="boton" onClick={() => { setListo(false); setE(inicial(destino)); elegirArchivo(null); elegirFondo(null); setEntendido(null); }}>Hacer otra</button>
      </div>
    );
  }

  const aceptaArchivo = e.plantilla === "logo" ? ".svg,.png" : ".png,.jpg,.jpeg,.webp";
  return (
    <div className="space-y-6">
      <Paso n={1} titulo="¿Cómo empieza?">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLANTILLAS_3D.map((id) => {
            const p = INFO_PLANTILLAS[id];
            const sel = e.plantilla === id;
            return (
              <button key={id} type="button" aria-pressed={sel} onClick={() => { poner({ plantilla: id }); setEntendido(null); }}
                className={`overflow-hidden rounded-xl border text-left transition-colors ${sel ? "border-acento ring-2 ring-acento" : "border-borde hover:border-acento/60"}`}>
                <video className="aspect-video w-full bg-black object-cover" src={`/api/escenas-3d/previa/${id}`} autoPlay muted loop playsInline preload="metadata" aria-hidden />
                <span className="block p-2">
                  <span className="block text-sm font-medium">{p.nombre}</span>
                  <span className="block text-xs text-tenue">{p.para}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Describir conIa={!!datos?.describirConIa} aplicar={(s) => {
          const { explicacion, ...resto } = s;
          poner(resto);
          setEntendido(explicacion);
        }} />
        {entendido && <Aviso tipo="info">{entendido} Revisa los pasos de abajo y cambia lo que quieras.</Aviso>}
      </Paso>

      {info && (
        <Paso n={2} titulo="Ajústala">
          {(info.campos.includes("imagen") || info.campos.includes("logo")) && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                {vista && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={vista} alt="Tu imagen" className="h-20 w-20 rounded border border-borde bg-white/5 object-contain" />
                )}
                <label className="boton cursor-pointer">
                  {archivoSubido ? "Cambiar" : info.campos.includes("logo") ? "Subir tu logo" : e.plantilla === "producto" ? "Subir la foto de tu producto" : "Subir una foto (opcional)"}
                  <input type="file" className="sr-only" accept={aceptaArchivo} onChange={(ev) => elegirArchivo(ev.target.files?.[0] ?? null)} />
                </label>
                {archivoSubido && !info.obligatorios.includes("imagen") && !info.obligatorios.includes("logo") && <button type="button" className="boton" onClick={() => elegirArchivo(null)}>Quitar</button>}
              </div>
              <p className="text-xs text-tenue">
                {info.campos.includes("logo")
                  ? "Con un logo SVG queda en 3D de verdad, con relieve y sus colores. Un PNG queda como una lámina."
                  : "Mejor una foto del producto solo, con fondo transparente (PNG) o liso."}
              </p>
            </div>
          )}
          {info.campos.includes("texto") && (
            <label className="block space-y-1">
              <span className="text-sm">{info.etiquetaTexto ?? "Texto"}</span>
              <input className="campo w-full" maxLength={80} value={e.texto} onChange={(ev) => poner({ texto: ev.target.value })} placeholder={info.ejemploTexto ? `Ej.: ${info.ejemploTexto}` : ""} />
              <span className="block text-xs text-tenue">Corto se lee mejor: hasta unas 6 palabras.</span>
            </label>
          )}
          {info.campos.includes("datos") && (
            <div className="space-y-3">
              <div className="space-y-1"><p className="text-sm">¿Qué tipo de gráfico?</p><Opciones valor={e.tipo_datos} opciones={TIPOS_DATOS_3D} cambiar={(v) => poner({ tipo_datos: v })} /></div>
              <div className="space-y-2">
                <p className="text-sm">{e.tipo_datos === "numero" ? "Tu número (y qué es)" : "Tus datos"}</p>
                <ul className="space-y-2">
                  {(e.tipo_datos === "numero" ? e.datos.slice(0, 1) : e.datos).map((d, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-xs text-tenue" aria-hidden>{i + 1}.</span>
                      <input className="campo min-w-0 flex-1" maxLength={18} value={d.etiqueta} aria-label={`Nombre ${i + 1}`}
                        placeholder={e.tipo_datos === "numero" ? "Ej.: clientes felices" : ["Ej.: Enero", "Ej.: Febrero", "Ej.: Marzo"][i] ?? "Nombre"}
                        onChange={(ev) => poner({ datos: e.datos.map((x, j) => (j === i ? { ...x, etiqueta: ev.target.value } : x)) })} />
                      <input className={`campo w-24 shrink-0 sm:w-28 ${filaMala === i ? "border-red-400" : ""}`} inputMode="decimal" maxLength={16} value={d.valor} aria-label={`Número ${i + 1}`}
                        placeholder={e.tipo_datos === "numero" ? "87" : ["120", "340", "510"][i] ?? "0"}
                        onChange={(ev) => poner({ datos: e.datos.map((x, j) => (j === i ? { ...x, valor: ev.target.value } : x)) })} />
                      {e.tipo_datos !== "numero" && e.datos.length > 1 && (
                        <button type="button" className="boton shrink-0 px-2 text-xs" aria-label={`Quitar la fila ${i + 1}`} onClick={() => poner({ datos: e.datos.filter((_, j) => j !== i) })}>✕</button>
                      )}
                    </li>
                  ))}
                </ul>
                {e.tipo_datos !== "numero" && e.datos.length < MAX_DATOS_3D && (
                  <button type="button" className="boton text-xs" onClick={() => poner({ datos: [...e.datos, { etiqueta: "", valor: "" }] })}>+ Agregar otra fila</button>
                )}
                <p className="text-xs text-tenue">{e.tipo_datos === "pastel" ? "Escribe cuánto es cada parte: Geeper saca los porcentajes." : `Hasta ${MAX_DATOS_3D} filas. Escribe sólo el número (1200, 3.5).`}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm">¿En qué se miden?</p>
                <div className="flex flex-wrap items-center gap-2">
                  {UNIDADES.map((u) => (
                    <button key={u.id || "nada"} type="button" aria-pressed={e.unidad === u.id} onClick={() => poner({ unidad: u.id })}
                      className={`rounded-full border px-3 py-1 text-xs ${e.unidad === u.id ? "border-acento bg-acento/10" : "border-borde hover:border-acento/60"}`}>{u.titulo}</button>
                  ))}
                  <input className="campo w-32 text-xs" maxLength={12} value={UNIDADES.some((u) => u.id === e.unidad) ? "" : e.unidad} onChange={(ev) => poner({ unidad: ev.target.value })} placeholder="Otra (ej.: litros)" aria-label="Otra unidad" />
                </div>
              </div>
            </div>
          )}
          {info.campos.includes("movimiento") && (<div className="space-y-1"><p className="text-sm">¿Cómo se mueve?</p><Opciones valor={e.movimiento} opciones={MOVIMIENTOS_3D} cambiar={(v) => poner({ movimiento: v })} /></div>)}
          {info.campos.includes("estilo_fondo") && (<div className="space-y-1"><p className="text-sm">¿Qué flota?</p><Opciones valor={e.estilo_fondo} opciones={FONDOS_3D} cambiar={(v) => poner({ estilo_fondo: v })} columnas={2} /></div>)}
          {info.campos.includes("estilo") && (<div className="space-y-1"><p className="text-sm">¿De qué material?</p><Opciones valor={e.estilo} opciones={ESTILOS_3D} cambiar={(v) => poner({ estilo: v })} /></div>)}
          {info.campos.includes("colores_logo") && archivoSubido?.name.toLowerCase().endsWith(".svg") && (
            <div className="space-y-1"><p className="text-sm">Colores del logo</p><Opciones valor={e.colores_logo} opciones={COLORES_LOGO} cambiar={(v) => poner({ colores_logo: v })} columnas={2} /></div>
          )}
          <div className="space-y-2">
            <p className="text-sm">Colores</p>
            <div className="flex flex-wrap gap-2">
              {PALETAS_3D.map((p) => (
                <button key={p.id} type="button" aria-pressed={e.paleta === p.id} onClick={() => { poner({ paleta: p.id, colores: { ...p.colores } }); setPropios(false); }}
                  className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs ${e.paleta === p.id ? "border-acento bg-acento/10" : "border-borde hover:border-acento/60"}`}>
                  <Puntos c={p.colores} /> {p.nombre}
                </button>
              ))}
              <button type="button" aria-pressed={propios} onClick={() => setPropios((x) => !x)} className={`rounded-full border px-3 py-1 text-xs ${propios || !e.paleta ? "border-acento bg-acento/10" : "border-borde"}`}>
                {e.paleta ? "Elegir mis colores" : "Mis colores"}
              </button>
            </div>
            {(propios || !e.paleta) && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([["fondo", "Fondo"], ["principal", info.colores.principal], ...(info.colores.acento ? [["acento", info.colores.acento]] : [])] as [keyof Colores3d, string][]).map(([k, etiqueta]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="color" className="h-9 w-12 cursor-pointer rounded border border-borde bg-transparent" value={e.colores[k] ?? "#000000"}
                      onChange={(ev) => poner({ paleta: null, colores: { ...e.colores, [k]: ev.target.value } })} />
                    {etiqueta}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!e.colores.fondo2} onChange={(ev) => poner({ paleta: null, colores: { ...e.colores, fondo2: ev.target.checked ? "#000000" : null } })} />
                  Fondo en degradado
                  {e.colores.fondo2 && <input type="color" aria-label="Color de abajo del degradado" className="h-7 w-10 cursor-pointer rounded border border-borde bg-transparent" value={e.colores.fondo2} onChange={(ev) => poner({ colores: { ...e.colores, fondo2: ev.target.value } })} />}
                </label>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm">¿Qué va detrás?</p>
            <Opciones valor={e.fondo_salida} opciones={FONDOS_SALIDA_3D} cambiar={(v) => poner({ fondo_salida: v })} />
            {e.fondo_salida === "foto" && (
              <div className="flex flex-wrap items-center gap-3">
                {vistaFondo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={vistaFondo} alt="Tu foto de fondo" className="h-20 w-20 rounded border border-borde object-cover" />
                )}
                <label className="boton cursor-pointer">
                  {fondoSubido ? "Cambiar la foto de fondo" : "Subir la foto de fondo"}
                  <input type="file" className="sr-only" accept=".png,.jpg,.jpeg,.webp" onChange={(ev) => elegirFondo(ev.target.files?.[0] ?? null)} />
                </label>
                <p className="w-full text-xs text-tenue">Se recorta para llenar el cuadro. Sirve para portadas: tu foto con el título en 3D delante.</p>
              </div>
            )}
            {e.fondo_salida === "transparente" && <p className="text-xs text-tenue">Te da además un archivo sin fondo para ponerlo encima de otro video o imagen. El color de fondo sólo se usa en la vista previa.</p>}
          </div>
        </Paso>
      )}

      {info && (
        <Paso n={3} titulo={e.salida === "imagen" ? "Tamaño y calidad" : "Tamaño, duración y calidad"}>
          {!destino && (
            <div className="space-y-1"><p className="text-sm">¿Video o imagen?</p><Opciones valor={e.salida} opciones={SALIDAS_3D} cambiar={(v) => poner({ salida: v })} columnas={2} /></div>
          )}
          {!destino && <Opciones valor={e.formato} opciones={FORMATOS_3D} cambiar={(v) => poner({ formato: v })} />}
          {destino && <p className="text-xs text-tenue">Se hace del mismo formato que tu video.</p>}
          {e.salida === "video" && (
            <label className="block space-y-1">
              <span className="text-sm">Duración: <strong>{e.duracion} segundos</strong></span>
              <input type="range" className="w-full max-w-sm" min={DURACION_3D.min} max={DURACION_3D.max} step={1} value={e.duracion} onChange={(ev) => poner({ duracion: Number(ev.target.value) })} />
            </label>
          )}
          <Opciones valor={e.calidad} cambiar={(v) => poner({ calidad: v })} opciones={CALIDADES_3D.map((c) => ({ ...c, texto: `${c.texto} Unos ${minutosEstimados(c.id, e.duracion, true, e.salida)} min.` }))} />
        </Paso>
      )}

      {info && (
        <div className="space-y-2">
          <button type="button" className="boton boton-primario" disabled={!!falta || enviando} onClick={() => void crear()}>
            {enviando ? "Enviando…" : destino ? `Crear y poner en la escena ${destino.numero}` : e.salida === "imagen" ? "Crear mi imagen 3D" : "Crear mi escena 3D"}
          </button>
          {falta && <p className="text-xs text-amber-200">{falta}</p>}
          {!falta && <p className="text-xs text-tenue">Usa la tarjeta de video. Si está ocupada, espera su turno sola.</p>}
          {error && <Aviso tipo="error">{error}</Aviso>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- lista

interface ProyectoV { id: string; nombre: string; versionActual: number }
interface EscenaV { id: string; indice: number; texto: string }

/** Poner una escena 3D hecha en una escena de un video: elegir el video y la escena. */
function UsarEnVideo({ corrida }: { corrida: string }) {
  const [abierto, setAbierto] = useState(false);
  const [proyectos, setProyectos] = useState<ProyectoV[] | null>(null);
  const [proyecto, setProyecto] = useState("");
  const [escenas, setEscenas] = useState<EscenaV[] | null>(null);
  const [escena, setEscena] = useState("");
  const [estado, setEstado] = useState<"" | "enviando" | "listo">("");
  const [error, setError] = useState<string | null>(null);
  async function abrir() {
    setAbierto(true);
    try {
      const r = await pedir<{ proyectos: ProyectoV[] }>("/api/proyectos");
      setProyectos(r.proyectos.filter((x) => x.versionActual > 0));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function elegirProyecto(id: string) {
    setProyecto(id);
    setEscena("");
    setEscenas(null);
    if (!id) return;
    try {
      setEscenas((await pedir<{ escenas: EscenaV[] }>(`/api/proyectos/${id}`)).escenas);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function poner() {
    setError(null);
    setEstado("enviando");
    try {
      await postJson("/api/escenas-3d/usar", { corrida, proyecto, escena });
      setEstado("listo");
    } catch (e) {
      setError((e as Error).message);
      setEstado("");
    }
  }
  if (!abierto) return <button type="button" className="boton text-xs" onClick={() => void abrir()}>Usar en un video</button>;
  if (estado === "listo") return <Aviso tipo="ok">Listo: ya está en la escena. <a className="underline" href={`/proyectos/${proyecto}`}>Abrir el video</a></Aviso>;
  return (
    <div className="w-full space-y-2 rounded border border-white/10 p-2 text-xs">
      <label className="block space-y-1">
        <span>1. ¿En qué video?</span>
        <select className="campo w-full" value={proyecto} onChange={(e) => void elegirProyecto(e.target.value)}>
          <option value="">Elige un video…</option>
          {proyectos?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
      </label>
      {proyectos?.length === 0 && <p className="text-tenue">Todavía no tienes videos: crea uno primero.</p>}
      {escenas && (
        <label className="block space-y-1">
          <span>2. ¿En qué escena? (reemplaza su imagen o video)</span>
          <select className="campo w-full" value={escena} onChange={(e) => setEscena(e.target.value)}>
            <option value="">Elige una escena…</option>
            {escenas.map((x) => <option key={x.id} value={x.id}>{`${x.indice + 1}. ${x.texto.slice(0, 70)}${x.texto.length > 70 ? "…" : ""}`}</option>)}
          </select>
        </label>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex gap-2">
        <button type="button" className="boton boton-primario" disabled={!escena || estado === "enviando"} onClick={() => void poner()}>{estado === "enviando" ? "Poniendo…" : "Poner aquí"}</button>
        <button type="button" className="boton" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      <p className="text-tenue">Puedes deshacerlo desde el historial del video.</p>
    </div>
  );
}

export function EnCurso({ trabajos, corridas, recargar }: { trabajos: TrabajoV[]; corridas: CorridaV[]; recargar: () => void }) {
  if (!trabajos.length) return null;
  return (
    <ul className="space-y-2" aria-live="polite">
      {trabajos.map((t) => {
        const c = corridas.find((x) => x.id === t.corrida);
        return (
          <li key={t.id} className="tarjeta space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{c?.titulo ?? "Escena 3D"}</span>
              <button type="button" className="boton text-xs" onClick={async () => { if (confirm("¿Cancelar esta escena 3D?")) { await postJson(`/api/trabajos/${t.id}`, { accion: "cancelar" }).catch(() => {}); recargar(); } }}>Cancelar</button>
            </div>
            <p className="text-xs text-tenue">{t.estado === "pendiente" ? "En espera: la tarjeta de video está ocupada con otra cosa." : t.etapa || "Empezando…"}</p>
            <Barra valor={t.progreso} />
          </li>
        );
      })}
    </ul>
  );
}

function TusEscenas({ corridas, ocupadas, recargar }: { corridas: CorridaV[]; ocupadas: Set<string>; recargar: () => void }) {
  const visibles = corridas.filter((c) => !ocupadas.has(c.id));
  if (!visibles.length) return <p className="text-sm text-tenue">Todavía no hiciste ninguna. Cuando crees una, aparece aquí.</p>;
  async function borrar(id: string) {
    if (!confirm("¿Borrar esta escena 3D? Los videos donde ya la usaste la conservan.")) return;
    await pedir(`/api/escenas-3d/${id}`, { method: "DELETE" }).catch((e: Error) => alert(e.message));
    recargar();
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visibles.map((c) => (
        <li key={c.id} className="tarjeta space-y-2 p-3 text-sm">
          {c.estado === "hecha" && c.imagen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={`max-h-80 w-full rounded object-contain ${c.pedido.fondo_salida === "transparente" ? "fondo-cuadros" : "bg-black"}`} src={archivo(c.imagen)} alt={c.titulo} />
          ) : c.estado === "hecha" && c.video ? (
            c.transparente ? (
              <video className="fondo-cuadros max-h-80 w-full rounded" src={archivo(c.transparente)} controls loop playsInline preload="none" />
            ) : (
              <video className="max-h-80 w-full rounded bg-black" src={archivo(c.video)} poster={c.portada ? archivo(c.portada) : undefined} controls loop playsInline preload="none" />
            )
          ) : c.estado === "fallida" ? (
            <Aviso tipo="error">No salió: {c.error ?? "error desconocido"}</Aviso>
          ) : (
            <p className="text-xs text-tenue">Se quedó a medias (¿se apagó la PC?). Bórrala y créala de nuevo.</p>
          )}
          <p className="font-medium">{c.titulo}</p>
          <p className="text-xs text-tenue">{FORMATOS_3D.find((f) => f.id === c.pedido.formato)?.titulo} · {c.imagen ? "imagen" : `${c.pedido.duracion} s`}{c.pedido.fondo_salida === "transparente" ? " · sin fondo" : ""} · {new Date(c.creada).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}</p>
          <div className="flex flex-wrap gap-2">
            {c.estado === "hecha" && (c.video || c.imagen) && <UsarEnVideo corrida={c.id} />}
            {c.estado === "hecha" && c.imagen && <a className="boton text-xs" href={archivo(c.imagen, true)}>Descargar imagen</a>}
            {c.estado === "hecha" && c.video && <a className="boton text-xs" href={archivo(c.video, true)}>{c.transparente ? "Descargar con fondo" : "Descargar"}</a>}
            {c.estado === "hecha" && c.transparente && <a className="boton text-xs" href={archivo(c.transparente, true)}>Descargar sin fondo</a>}
            <button type="button" className="boton text-xs" onClick={() => void borrar(c.id)}>Borrar</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Generadores 3D con IA en la nube: de pago, bloqueados (decisión del dueño, 2026-11-25). */
function DePago() {
  const servicios = [
    ["Meshy", "un objeto 3D desde una frase o una foto"],
    ["Tripo", "un objeto 3D desde una foto"],
    ["Hyper3D Rodin", "objetos 3D muy detallados"],
    ["World Labs", "un lugar completo en 3D desde una imagen"],
  ];
  return (
    <details className="tarjeta p-3 text-sm">
      <summary className="cursor-pointer text-tenue">🔒 Objetos 3D creados con IA en la nube (de pago, bloqueado)</summary>
      <div className="mt-2 space-y-2">
        <p className="text-tenue">
          Estos servicios crean objetos 3D con inteligencia artificial en internet. Cada uno cobra por uso con su propia cuenta, así que están
          bloqueados: Geeper hace todo gratis en tu PC. Si algún día quieres usar uno, hace falta tu clave de ese servicio y saber cuánto cuesta.
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {servicios.map(([n, q]) => (
            <li key={n} className="rounded border border-borde p-2 opacity-70">
              <span className="font-medium">{n}</span> <span className="text-xs text-amber-200">· de pago</span>
              <span className="block text-xs text-tenue">Crea {q}.</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function PaginaEscenas3d() {
  const { datos, error, recargar } = useEscenas3d(4000);
  const ocupadas = useMemo(() => new Set((datos?.trabajos ?? []).map((t) => t.corrida).filter(Boolean) as string[]), [datos]);
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Escenas 3D</h1>
        <p className="text-sm text-tenue">Videos e imágenes en 3D: un título, un gráfico con tus números, tu logo, tu producto o una caja sorpresa. Sirven para tus videos, portadas, publicaciones o para poner encima de otro video. Eliges, cambias el texto y los colores, y Geeper lo hace solo.</p>
      </header>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!datos && <p className="text-tenue">Cargando…</p>}
      {datos && !datos.blender.listo && <PrepararBlender datos={datos} recargar={() => void recargar()} />}
      {datos?.blender.listo && (
        <div className="tarjeta p-4">
          <CrearEscena3d alCrear={() => void recargar()} />
        </div>
      )}
      {datos && datos.trabajos.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-medium">Haciéndose ahora</h2>
          <EnCurso trabajos={datos.trabajos} corridas={datos.corridas} recargar={() => void recargar()} />
        </div>
      )}
      {datos && (
        <div className="space-y-2">
          <h2 className="font-medium">Tus escenas 3D</h2>
          <TusEscenas corridas={datos.corridas} ocupadas={ocupadas} recargar={() => void recargar()} />
        </div>
      )}
      <DePago />
    </section>
  );
}
