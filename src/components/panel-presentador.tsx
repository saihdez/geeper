"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AvatarV } from "./avatares";
import { Aviso, Barra, postJson, useSondeo } from "./comun";
import type { MotorVoz } from "./elegir-voz";
import { useMotorVivo } from "./motor";
import type { Formato, Marco } from "@/lib/esquema";
import { metricas } from "@/lib/formatos";
import { cajaMarco } from "@/lib/marco";

interface PlanV { modo: string; escenas: { id: string; numero: number }[]; segundos: number; resolucion: string; notas: string[]; avisos: string[] }
interface Datos {
  wan2gp: { listo: boolean; falta: string | null; instalando: boolean };
  avatares: AvatarV[];
  formato: Formato;
  vozVideo: { motor: string; voz: string; idioma: string };
  maxSegundos: number;
  calidades: { id: string; nombre: string }[];
  estado: { burbuja: boolean; escenas: string[]; viejo: boolean; avatar: string | null };
  plan: PlanV | null;
  error: string | null;
  trabajos: { id: string; estado: string; etapa: string; progreso: number }[];
}

type Modo = "burbuja" | "pantalla";
type Esquina = "abajo-derecha" | "abajo-izquierda" | "arriba-derecha" | "arriba-izquierda";

const ESQUINAS: { id: Esquina; nombre: string }[] = [
  { id: "arriba-izquierda", nombre: "↖ Arriba a la izquierda" },
  { id: "arriba-derecha", nombre: "↗ Arriba a la derecha" },
  { id: "abajo-izquierda", nombre: "↙ Abajo a la izquierda" },
  { id: "abajo-derecha", nombre: "↘ Abajo a la derecha" },
];
/** Cómo habla: al modelo va el texto en inglés. */
const ACTITUDES = [
  { nombre: "Natural", prompt: "" },
  { nombre: "Alegre y con energía", prompt: "cheerful and energetic, smiling often" },
  { nombre: "Seria y profesional", prompt: "serious and professional, composed expression" },
  { nombre: "Tranquila y cálida", prompt: "calm and warm, gentle expressions" },
  { nombre: "Muy expresiva", prompt: "very enthusiastic and expressive, lively head movements" },
];

/** ¿Habla el video con esta voz? (MPT antepone «kokoro:»). */
const mismaVoz = (video: { motor: string; voz: string }, v: { motor: string; voz: string }) =>
  v.motor === "voxcpm" ? video.motor === "voxcpm" && video.voz === v.voz : video.motor !== "voxcpm" && video.voz.split(":").pop() === v.voz;

/** Vista previa a escala de dónde queda el avatar (la misma cuenta que el compilador). */
function Vista({ formato, modo, marco, retrato }: { formato: Formato; modo: Modo; marco: Marco; retrato?: string }) {
  const m = metricas(formato);
  const ancho = formato === "9:16" ? 108 : formato === "1:1" ? 150 : 192;
  const k = ancho / m.W;
  const c = cajaMarco(marco, m);
  const px = (n: number) => `${Math.round(n * k)}px`;
  return (
    <div className="relative shrink-0 overflow-hidden rounded border border-borde bg-gradient-to-b from-slate-600 to-slate-800" style={{ width: px(m.W), height: px(m.H) }} aria-label="Vista previa de dónde aparece el avatar" role="img">
      {modo === "pantalla" && retrato && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={retrato} alt="" className={`absolute inset-0 h-full w-full ${formato === "16:9" ? "object-contain" : "object-cover"}`} />
      )}
      <div className="absolute rounded bg-white/70" style={{ left: px(m.subs.x + m.subs.w * 0.15), top: px(m.subs.y + m.subs.h * 0.35), width: px(m.subs.w * 0.7), height: px(m.subs.h * 0.3) }} title="Subtítulos" />
      {modo === "burbuja" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={retrato} alt="" className="absolute border-2 border-white object-cover object-top" style={{ left: px(c.x), top: px(c.y), width: px(c.w), height: px(c.h), borderRadius: marco.forma === "circulo" ? "50%" : "18%" }} />
      )}
    </div>
  );
}

const TAMANOS = [
  { id: 0.26, nombre: "Chica" },
  { id: 0.34, nombre: "Mediana" },
  { id: 0.45, nombre: "Grande" },
];

/**
 * «Presentador»: un avatar de la biblioteca dice la voz del video. En una burbuja durante todo el video o
 * a pantalla completa en las escenas elegidas. Lo simple a la vista; calidad y actitud en «Más opciones».
 */
/**
 * Minutos que tarda en la RTX 5080 a 480p (medido 2026-11-21: 3,2 s de voz → 497 s; 10,4 s → 622 s, con
 * el modelo ya bajado): unos 7 minutos fijos más ~18 s por cada segundo de voz.
 */
const minutosHablar = (segundos: number) => Math.max(8, Math.ceil((440 + 18 * segundos) / 60));

export function PanelPresentador({ proyectoId, escenas, ocupado, alCambiar, usarVoz }: {
  proyectoId: string; escenas: { id: string; numero: number; texto: string }[]; ocupado: boolean; alCambiar: () => void;
  /** Cambia la voz del video (y ofrece decirla de nuevo), como en la sección de voz. */
  usarVoz: (motor: MotorVoz, voz: string, nombre: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("burbuja");
  const [elegidas, setElegidas] = useState<string[]>(() => escenas.slice(0, 1).map((e) => e.id));
  const [esquina, setEsquina] = useState<Esquina>("abajo-derecha");
  const [forma, setForma] = useState<"circulo" | "redondeado">("circulo");
  const [tamano, setTamano] = useState(0.34);
  const [calidad, setCalidad] = useState("normal");
  const [actitud, setActitud] = useState("");
  const [otraActitud, setOtraActitud] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // El avatar elegido; sin elegir, el que ya está en el video o el primero de la biblioteca.
  const [base, setBase] = useState<Datos | null>(null);
  const elegido = avatar ?? (base?.estado.avatar && base.avatares.some((a) => a.id === base.estado.avatar) ? base.estado.avatar : base?.avatares[0]?.id ?? null);

  const opciones = useMemo(() => {
    if (!elegido) return null;
    const o: Record<string, unknown> = { avatar: elegido, modo };
    if (modo === "pantalla") {
      o.escenas = elegidas;
      if (calidad !== "normal") o.calidad = calidad;
    } else o.marco = { esquina, forma, tamano };
    const prompt = otraActitud.trim() || actitud;
    if (prompt) o.prompt = prompt;
    return o;
  }, [elegido, modo, elegidas, esquina, forma, tamano, calidad, actitud, otraActitud]);
  const [pedidas, setPedidas] = useState(opciones);
  useEffect(() => {
    const t = setTimeout(() => setPedidas(opciones), 400);
    return () => clearTimeout(t);
  }, [opciones]);
  const url = `/api/proyectos/${proyectoId}/presentador${pedidas ? `?opciones=${encodeURIComponent(JSON.stringify(pedidas))}` : ""}`;
  const { datos: d, recargar } = useSondeo<Datos>(url, abierto ? 4000 : 15_000);
  const motorVivo = useMotorVivo();
  const trabajo = d?.trabajos[0] ?? null;
  if (d && base !== d && !base) setBase(d);

  // Al terminar un trabajo, el editor recarga el proyecto (versión nueva).
  const habia = useRef<string | null>(null);
  useEffect(() => {
    if (trabajo) habia.current = trabajo.id;
    else if (habia.current) {
      habia.current = null;
      alCambiar();
    }
  }, [trabajo, alCambiar]);

  async function cancelar() {
    if (!trabajo || !confirm("¿Cancelar el presentador? Lo que lleva hecho se pierde.")) return;
    try {
      await postJson(`/api/trabajos/${trabajo.id}`, { accion: "cancelar" });
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function generar() {
    if (!opciones) return;
    setError(null);
    setEnviando(true);
    try {
      await postJson(`/api/proyectos/${proyectoId}/presentador`, { opciones });
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const resumen = trabajo ? ` · ${trabajo.estado === "pendiente" ? "en espera" : trabajo.etapa || "generando"}` : d?.estado.viejo ? " · hay que actualizarlo" : d?.estado.burbuja || d?.estado.escenas.length ? " · en el video" : "";
  return (
    <section className="tarjeta p-4">
      <details open={abierto} onToggle={(ev) => setAbierto((ev.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer font-medium">
          Presentador <span className="text-xs font-normal text-tenue">(un avatar que dice la voz del video{resumen})</span>
        </summary>
        {abierto && !d && <p className="mt-2 text-xs text-tenue">Cargando…</p>}
        {abierto && d && (
          <div className="mt-3 space-y-4 text-sm">
            {!d.wan2gp.listo ? (
              <div className="space-y-2">
                <Aviso tipo="info">Para el presentador hace falta instalar una vez Wan2GP (el mismo programa de «Animar esta escena»).</Aviso>
                <a className="boton boton-primario inline-block" href="/sistema#wan2gp">Ir a Sistema para instalarlo</a>
              </div>
            ) : d.avatares.length === 0 ? (
              <div className="space-y-2">
                <p>Todavía no tienes avatares. Crea uno (realista o animado) y vuelve aquí.</p>
                <a className="boton boton-primario inline-block" href="/avatares">Crear un avatar</a>
              </div>
            ) : (
              <>
                {(() => {
                  const sel = d.avatares.find((a) => a.id === elegido);
                  if (!sel) return null;
                  if (!sel.voz) return <Aviso tipo="info">{sel.nombre} todavía no tiene voz elegida: va a hablar con la voz del video. <a className="underline" href="/avatares">Elegirle una voz</a></Aviso>;
                  if (mismaVoz(d.vozVideo, sel.voz)) return null;
                  const v = sel.voz;
                  return (
                    <Aviso tipo="alerta">
                      <p>El video habla con otra voz, no con la de {sel.nombre} ({v.nombre}). Para que cuadre, primero pon su voz en el video; cuando termine, pon el presentador.</p>
                      <button type="button" className="boton mt-2" disabled={ocupado} onClick={() => void usarVoz(v.motor, v.voz, v.nombre)}>Usar la voz de {sel.nombre} en el video</button>
                    </Aviso>
                  );
                })()}
                {d.estado.viejo && <Aviso tipo="alerta">Cambiaste lo que se dice después de poner el presentador: genéralo otra vez para que la boca siga a la voz.</Aviso>}
                <fieldset className="space-y-2">
                  <legend className="font-medium">1. ¿Quién presenta?</legend>
                  <div className="flex flex-wrap gap-3">
                    {d.avatares.map((a) => (
                      <button key={a.id} type="button" aria-pressed={elegido === a.id} onClick={() => setAvatar(a.id)}
                        className={`w-24 overflow-hidden rounded-lg border text-left ${elegido === a.id ? "border-cyan-400 outline outline-2 outline-cyan-500" : "border-borde"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.retrato} alt="" className="aspect-[832/1216] w-full object-cover" />
                        <span className="block truncate px-1 py-0.5 text-xs">{a.nombre}</span>
                      </button>
                    ))}
                    <a href="/avatares" className="flex w-24 items-center justify-center rounded-lg border border-dashed border-borde text-center text-xs text-tenue hover:text-white">＋ Otro avatar</a>
                  </div>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="font-medium">2. ¿Dónde aparece?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" aria-pressed={modo === "burbuja"} onClick={() => setModo("burbuja")} className={`tarjeta p-3 text-left ${modo === "burbuja" ? "outline outline-2 outline-cyan-500" : ""}`}>
                      <span className="block font-medium">En una burbuja, todo el video</span>
                      <span className="block text-xs text-tenue">Las imágenes siguen detrás y el avatar habla en una esquina.</span>
                    </button>
                    <button type="button" aria-pressed={modo === "pantalla"} onClick={() => setModo("pantalla")} className={`tarjeta p-3 text-left ${modo === "pantalla" ? "outline outline-2 outline-cyan-500" : ""}`}>
                      <span className="block font-medium">A pantalla completa</span>
                      <span className="block text-xs text-tenue">El avatar reemplaza la imagen de las escenas que elijas (por ejemplo, la primera y la última).</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-start gap-4">
                  <Vista formato={d.formato} modo={modo} marco={{ esquina, forma, tamano } satisfies Marco} retrato={d.avatares.find((a) => a.id === elegido)?.retrato} />
                  <div className="min-w-0 flex-1">
                  {modo === "burbuja" ? (
                    <div className="flex flex-wrap gap-3">
                      <label className="space-y-1"><span className="block text-xs text-tenue">Esquina</span>
                        <select className="campo w-auto" value={esquina} onChange={(ev) => setEsquina(ev.target.value as Esquina)}>
                          {ESQUINAS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1"><span className="block text-xs text-tenue">Forma</span>
                        <select className="campo w-auto" value={forma} onChange={(ev) => setForma(ev.target.value as "circulo" | "redondeado")}>
                          <option value="circulo">Círculo</option>
                          <option value="redondeado">Rectángulo redondeado</option>
                        </select>
                      </label>
                      <label className="space-y-1"><span className="block text-xs text-tenue">Tamaño</span>
                        <select className="campo w-auto" value={String(tamano)} onChange={(ev) => setTamano(Number(ev.target.value))}>
                          {TAMANOS.map((x) => <option key={x.id} value={String(x.id)}>{x.nombre}</option>)}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="max-h-56 space-y-1 overflow-auto rounded border border-borde p-2">
                      {escenas.map((e) => (
                        <label key={e.id} className="flex items-start gap-2">
                          <input type="checkbox" className="mt-1" checked={elegidas.includes(e.id)}
                            onChange={(ev) => setElegidas((xs) => (ev.target.checked ? [...xs, e.id] : xs.filter((x) => x !== e.id)))} />
                          <span><b>Escena {e.numero}:</b> <span className="text-tenue">{e.texto.slice(0, 90)}{e.texto.length > 90 ? "…" : ""}</span></span>
                        </label>
                      ))}
                    </div>
                  )}
                  </div>
                  </div>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="font-medium">3. ¿Cómo habla?</legend>
                  <div className="flex flex-wrap gap-2">
                    {ACTITUDES.map((x) => (
                      <button key={x.nombre} type="button" aria-pressed={!otraActitud && actitud === x.prompt} onClick={() => { setActitud(x.prompt); setOtraActitud(""); }}
                        className={`boton ${!otraActitud && actitud === x.prompt ? "boton-primario" : ""}`}>{x.nombre}</button>
                    ))}
                  </div>
                </fieldset>

                <details>
                  <summary className="cursor-pointer text-tenue">Más opciones</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1"><span className="block text-xs text-tenue">Otra forma de hablar, escrita (en inglés funciona mejor)</span>
                      <input className="campo" maxLength={300} value={otraActitud} onChange={(ev) => setOtraActitud(ev.target.value)} placeholder="nods often, friendly smile" />
                    </label>
                    {modo === "pantalla" && (
                      <label className="space-y-1"><span className="block text-xs text-tenue">Calidad</span>
                        <select className="campo" value={calidad} onChange={(ev) => setCalidad(ev.target.value)}>
                          {d.calidades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </details>

                {d.error && <Aviso tipo="alerta">{d.error}</Aviso>}
                {d.plan && (
                  <div className="space-y-1 text-xs text-tenue">
                    <p>Va a hablar {Math.round(d.plan.segundos)} s{d.plan.modo === "pantalla" ? ` en ${d.plan.escenas.length === 1 ? "la escena" : "las escenas"} ${d.plan.escenas.map((x) => x.numero).join(", ")}` : ""}. Usa la tarjeta de video y tarda unos {minutosHablar(d.plan.segundos)} minutos (la primera vez, más: baja el modelo, unos 28 GB).</p>
                    {d.plan.notas.map((n) => <p key={n}>{n}</p>)}
                    {d.plan.avisos.map((n) => <p key={n} className="text-amber-300">{n}</p>)}
                  </div>
                )}
                {error && <Aviso tipo="error">{error}</Aviso>}
                {trabajo ? (
                  <div className="space-y-1">
                    <p>{trabajo.estado === "pendiente" ? (motorVivo === false ? "En espera: Geeper está en pausa (mira el aviso de arriba)." : "En espera: la tarjeta de video está ocupada.") : trabajo.etapa || "Generando…"}</p>
                    <Barra valor={trabajo.progreso} etiqueta="Avance del presentador" />
                    <p className="text-xs text-tenue">Puedes seguir editando; cuando termine aparece en el video como una versión nueva (se deshace desde «Historial»).</p>
                    <button type="button" className="boton" onClick={() => void cancelar()}>Cancelar</button>
                  </div>
                ) : (
                  <button className="boton boton-primario" disabled={ocupado || enviando || !d.plan || (modo === "pantalla" && !elegidas.length)} onClick={() => void generar()}>
                    {d.estado.burbuja || d.estado.escenas.length ? "Generar el presentador otra vez" : "Poner el presentador"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
