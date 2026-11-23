"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AvatarV } from "./avatares";
import { Aviso, AvisoTarjeta, Barra, LineaFalta, faltanConGuardar, pedir, postJson, useGuardeAntes, useSondeo } from "./comun";
import type { MotorVoz } from "./elegir-voz";
import { useMotorVivo } from "./motor";
import { enlaceAvatares } from "@/lib/asistente-avatar";
import type { Formato, Marco } from "@/lib/esquema";
import { metricas } from "@/lib/formatos";
import { cajaMarco } from "@/lib/marco";
import { resolverMarco, type Zona } from "@/lib/marco-auto";
import { minutosHablar } from "@/lib/tiempo-hablar";

interface PlanV { modo: string; escenas: { id: string; numero: number }[]; segundos: number; resolucion: string; notas: string[]; avisos: string[] }
interface Datos {
  wan2gp: { listo: boolean; falta: string | null; instalando: boolean };
  avatares: AvatarV[];
  formato: Formato;
  plataformas: NonNullable<Parameters<typeof metricas>[1]>["plataformas"];
  zonas: Zona[];
  vozVideo: { motor: string; voz: string; idioma: string };
  maxSegundos: number;
  calidades: { id: string; nombre: string }[];
  estado: { burbuja: boolean; escenas: string[]; viejoBurbuja: boolean; avatar: string | null };
  /** Dónde está ahora la burbuja ya generada (null si no hay). */
  marcoActual: Marco | null;
  plan: PlanV | null;
  error: string | null;
  trabajos: { id: string; estado: string; etapa: string; progreso: number }[];
}

type Modo = "burbuja" | "pantalla";
type Esquina = "auto" | "abajo-derecha" | "abajo-izquierda" | "arriba-derecha" | "arriba-izquierda";

const ESQUINAS: { id: Esquina; nombre: string }[] = [
  { id: "auto", nombre: "✦ Automático (donde no tape caras)" },
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
function Vista({ formato, plataformas, zonas, modo, marco, retrato }: { formato: Formato; plataformas: Datos["plataformas"]; zonas: Zona[]; modo: Modo; marco: Marco; retrato?: string }) {
  const base = metricas(formato, { plataformas });
  const ancho = formato === "9:16" ? 108 : formato === "1:1" ? 150 : 192;
  const k = ancho / base.W;
  const r = resolverMarco(marco, base, zonas);
  const c = cajaMarco(r, base);
  // Con la burbuja abajo, los subtítulos se corren a su lado (como en el video).
  const m = modo === "burbuja" && r.esquina.startsWith("abajo") ? metricas(formato, { plataformas, burbuja: c }) : base;
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
 * «Presentador»: un avatar de la biblioteca comenta el video en una ventana encima, todo el video: en una
 * burbuja o recortado sin fondo, como un streamer (actuar.ts). Que el avatar salga en las escenas, en lugar
 * de las imágenes, es «Tu avatar en el video» (pedido del dueño, 2026-11-22). Actitud en «Más opciones».
 */

export function PanelPresentador({ proyectoId, ocupado, alCambiar, usarVoz }: {
  proyectoId: string; escenas: { id: string; numero: number; texto: string }[]; ocupado: boolean; alCambiar: () => void;
  /** Cambia la voz del video (y ofrece decirla de nuevo), como en la sección de voz. */
  usarVoz: (motor: MotorVoz, voz: string, nombre: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const modo: Modo = "burbuja";
  const [ventana, setVentana] = useState<"burbuja" | "streamer">("burbuja");
  const [sEncuadre, setSEncuadre] = useState<"medio" | "completo">("medio");
  const [sLado, setSLado] = useState<"derecha" | "izquierda">("derecha");
  const [sTamano, setSTamano] = useState(0.4);
  const [streamerOk, setStreamerOk] = useState<string | null>(null);
  const [esquina, setEsquina] = useState<Esquina>("auto");
  const [forma, setForma] = useState<"circulo" | "redondeado">("circulo");
  const [tamano, setTamano] = useState(0.34);
  const [actitud, setActitud] = useState("");
  const [otraActitud, setOtraActitud] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const guarde = useGuardeAntes();
  const faltaGuardar = faltanConGuardar(guarde);
  const describe = faltaGuardar.length ? guarde.idFalta : undefined;
  // El avatar elegido; sin elegir, el que ya está en el video o el primero de la biblioteca.
  const [base, setBase] = useState<Datos | null>(null);
  const elegido = avatar ?? (base?.estado.avatar && base.avatares.some((a) => a.id === base.estado.avatar) ? base.estado.avatar : base?.avatares[0]?.id ?? null);

  const opciones = useMemo(() => {
    if (!elegido) return null;
    const o: Record<string, unknown> = { avatar: elegido, modo, marco: { esquina, forma, tamano } };
    const prompt = otraActitud.trim() || actitud;
    if (prompt) o.prompt = prompt;
    return o;
  }, [elegido, modo, esquina, forma, tamano, actitud, otraActitud]);
  const [pedidas, setPedidas] = useState(opciones);
  useEffect(() => {
    const t = setTimeout(() => setPedidas(opciones), 400);
    return () => clearTimeout(t);
  }, [opciones]);
  const url = `/api/proyectos/${proyectoId}/presentador${pedidas ? `?opciones=${encodeURIComponent(JSON.stringify(pedidas))}` : ""}`;
  // Como «Animar» y «Rehacer la toma»: cerrado sólo pide mientras hay un presentador en curso.
  const enCurso = (t: { estado: string }) => t.estado === "pendiente" || t.estado === "corriendo";
  const { datos: d, recargar } = useSondeo<Datos>(url, (x) =>
    abierto ? 4000 : x?.trabajos.some((t) => t.estado === "pendiente" || t.estado === "corriendo") ? 10_000 : Infinity);
  // El streamer va por la API del avatar (actuar.ts): su avance se sigue aparte. Cerrado y sin streamer en
  // curso no pregunta; el aviso de trabajos nuevos del proyecto lo despierta (WEB-13).
  const { datos: av, recargar: recargarAv } = useSondeo<{ trabajos: { id: string; tipo: string; estado: string; etapa: string; progreso: number }[] }>(
    `/api/proyectos/${proyectoId}/avatar`,
    (x) => (abierto ? 5000 : x?.trabajos.some((t) => t.tipo === "avatar.streamer" && enCurso(t)) ? 10_000 : Infinity),
    [`trabajos:${proyectoId}`],
  );
  const motorVivo = useMotorVivo();
  const trabajo = d?.trabajos[0] ?? av?.trabajos.find((t) => t.tipo === "avatar.streamer") ?? null;
  if (d && base !== d && !base) {
    setBase(d);
    // Los controles arrancan donde está la burbuja que ya tiene el video.
    const ma = d.marcoActual;
    if (ma) {
      setEsquina(ma.esquina as Esquina);
      if (ma.forma === "circulo" || ma.forma === "redondeado") setForma(ma.forma);
      setTamano(ma.tamano);
    }
  }

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
      await Promise.all([recargar(), recargarAv()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Con la burbuja ya generada (mismo avatar y misma forma de hablar), cambiar esquina, tamaño o forma no
  // necesita la tarjeta gráfica: se mueve al instante (PATCH, presentador-ubicar.ts).
  const ma = d?.marcoActual ?? null;
  const puedeMover = Boolean(d && ventana === "burbuja" && d.estado.burbuja && ma && (ma.forma === "circulo" || ma.forma === "redondeado") && elegido === d.estado.avatar && !actitud && !otraActitud.trim());
  const cambioUbicacion = Boolean(puedeMover && ma && (ma.esquina !== esquina || ma.forma !== forma || Math.abs(ma.tamano - tamano) > 1e-6));
  const [movido, setMovido] = useState<string | null>(null);

  async function mover() {
    setError(null);
    setMovido(null);
    setEnviando(true);
    try {
      const r = await pedir<{ version: number }>(`/api/proyectos/${proyectoId}/presentador`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ marco: { esquina, forma, tamano } }) });
      setMovido(`Listo: el presentador quedó en su lugar nuevo (versión ${r.version}). Míralo en la vista «En vivo».`);
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function generar() {
    if (!opciones || !elegido) return;
    setError(null);
    setStreamerOk(null);
    setEnviando(true);
    try {
      if (ventana === "streamer") {
        const prompt = otraActitud.trim() || actitud;
        await postJson(`/api/proyectos/${proyectoId}/avatar`, { accion: "streamer", pedido: { avatar: elegido, encuadre: sEncuadre, lado: sLado, tamano: sTamano, ...(prompt ? { actitud: prompt } : {}) } });
        setStreamerOk("Listo: está en camino. Cuando termine aparece recortado encima de todo el video, como una versión nueva.");
        await recargarAv();
      } else {
        await postJson(`/api/proyectos/${proyectoId}/presentador`, { opciones });
        await recargar();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const resumen = trabajo ? ` · ${trabajo.estado === "pendiente" ? "en espera" : trabajo.etapa || "generando"}` : d?.estado.viejoBurbuja ? " · hay que actualizarlo" : d?.estado.burbuja ? " · en el video" : "";
  return (
    <section className="tarjeta p-4">
      <details open={abierto} onToggle={(ev) => {
        const abre = (ev.target as HTMLDetailsElement).open;
        setAbierto(abre);
        if (abre) void recargar(); // al abrir, datos frescos y vuelve el ritmo de 4 s
        if (abre) void recargarAv();
      }}>
        <summary className="cursor-pointer font-medium">
          Presentador <span className="text-xs font-normal text-tenue">(tu avatar en una ventana, comentando encima del video{resumen})</span>
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
                <p>Primero crea un avatar (3 pasos, unos minutos). Después vuelves aquí y lo eliges.</p>
                <a className="boton boton-primario inline-block" href={enlaceAvatares(proyectoId)}>Crear un avatar</a>
              </div>
            ) : (
              <>
                {(() => {
                  const sel = d.avatares.find((a) => a.id === elegido);
                  if (!sel) return null;
                  if (!sel.voz) return <Aviso tipo="info">{sel.nombre} todavía no tiene voz elegida: va a hablar con la voz del video. <a className="underline" href={enlaceAvatares(proyectoId)}>Elegirle una voz</a></Aviso>;
                  if (mismaVoz(d.vozVideo, sel.voz)) return null;
                  const v = sel.voz;
                  return (
                    <Aviso tipo="alerta">
                      <p>El video habla con otra voz, no con la de {sel.nombre} ({v.nombre}). Para que cuadre, primero pon su voz en el video; cuando termine, pon el presentador.</p>
                      <button type="button" className="boton mt-2" disabled={ocupado} onClick={() => void usarVoz(v.motor, v.voz, v.nombre)}>Usar la voz de {sel.nombre} en el video</button>
                    </Aviso>
                  );
                })()}
                {d.estado.viejoBurbuja && <Aviso tipo="alerta">Cambiaste lo que se dice después de poner el presentador: genéralo otra vez para que la boca siga a la voz.</Aviso>}
                <fieldset className="space-y-2">
                  <legend className="font-medium">1. ¿Quién presenta?</legend>
                  <div className="flex flex-wrap gap-3">
                    {d.avatares.map((a) => (
                      <button key={a.id} type="button" aria-pressed={elegido === a.id} onClick={() => setAvatar(a.id)}
                        className="opcion-tarjeta w-24 overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.retrato} alt="" className="aspect-[832/1216] w-full object-cover" />
                        <span className="block truncate px-1 py-0.5 text-xs">{a.nombre}</span>
                      </button>
                    ))}
                    <a href={enlaceAvatares(proyectoId)} className="flex w-24 items-center justify-center rounded-lg border border-dashed border-borde text-center text-xs text-tenue hover:text-white">＋ Otro avatar</a>
                  </div>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="font-medium">2. ¿Dónde aparece?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" aria-pressed={ventana === "burbuja"} onClick={() => setVentana("burbuja")} className="opcion-tarjeta p-3">
                      <span className="block font-medium">En una burbuja, todo el video</span>
                      <span className="block text-xs text-tenue">Las imágenes siguen detrás y el avatar comenta desde una esquina.</span>
                    </button>
                    <button type="button" aria-pressed={ventana === "streamer"} onClick={() => setVentana("streamer")} className="opcion-tarjeta p-3">
                      <span className="block font-medium">Recortado, como streamer</span>
                      <span className="block text-xs text-tenue">Sin fondo, encima del video (ideal para gameplay), hablando y gesticulando.</span>
                    </button>
                  </div>
                  <p className="text-xs text-tenue">¿Quieres que salga en las escenas, en lugar de las imágenes? Eso es «Tu avatar en el video», más arriba.</p>
                  {ventana === "burbuja" ? (
                  <div className="flex flex-wrap items-start gap-4">
                  <Vista formato={d.formato} plataformas={d.plataformas} zonas={d.zonas} modo={modo} marco={{ esquina, forma, tamano } satisfies Marco} retrato={d.avatares.find((a) => a.id === elegido)?.retrato} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-3">
                      <label className="space-y-1"><span className="block text-xs text-tenue">Esquina</span>
                        <select className="campo w-auto" value={esquina} onChange={(ev) => setEsquina(ev.target.value as Esquina)}>
                          {ESQUINAS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                        </select>
                        {esquina === "auto" && (
                          <span className="block text-xs text-tenue">
                            Queda {ESQUINAS.find((x) => x.id === resolverMarco({ esquina, forma, tamano } satisfies Marco, metricas(d.formato, { plataformas: d.plataformas }), d.zonas).esquina)?.nombre.slice(2).toLowerCase()}
                          </span>
                        )}
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
                  </div>
                  </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <label className="space-y-1"><span className="block text-xs text-tenue">Cuánto se le ve</span>
                        <select className="campo w-auto" value={sEncuadre} onChange={(ev) => setSEncuadre(ev.target.value as "medio" | "completo")}>
                          <option value="medio">Medio cuerpo</option>
                          <option value="completo">Cuerpo completo</option>
                        </select>
                      </label>
                      <label className="space-y-1"><span className="block text-xs text-tenue">Lado</span>
                        <select className="campo w-auto" value={sLado} onChange={(ev) => setSLado(ev.target.value as "derecha" | "izquierda")}>
                          <option value="izquierda">↙ Abajo a la izquierda</option>
                          <option value="derecha">↘ Abajo a la derecha</option>
                        </select>
                      </label>
                      <label className="space-y-1"><span className="block text-xs text-tenue">Tamaño</span>
                        <input type="range" className="block" min={0.25} max={0.6} step={0.05} value={sTamano} onChange={(ev) => setSTamano(Number(ev.target.value))} />
                      </label>
                    </div>
                  )}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="font-medium">3. ¿Cómo habla?</legend>
                  <div className="flex flex-wrap gap-2">
                    {ACTITUDES.map((x) => (
                      <button key={x.nombre} type="button" aria-pressed={!otraActitud && actitud === x.prompt} onClick={() => { setActitud(x.prompt); setOtraActitud(""); }}
                        className="opcion">{x.nombre}</button>
                    ))}
                  </div>
                </fieldset>

                <details>
                  <summary className="cursor-pointer text-tenue">Más opciones</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1"><span className="block text-xs text-tenue">Otra forma de hablar, escrita (en inglés funciona mejor)</span>
                      <input className="campo" maxLength={300} value={otraActitud} onChange={(ev) => setOtraActitud(ev.target.value)} placeholder="nods often, friendly smile" />
                    </label>
                  </div>
                </details>

                {d.error && <Aviso tipo="alerta">{d.error}</Aviso>}
                {ventana === "streamer" && <p className="text-xs text-tenue">Habla con la voz de todo el video. Tarda unos 7 minutos más ~40 s por cada segundo de voz (un short de 30 s, ~23 minutos).</p>}
                {streamerOk && <Aviso tipo="ok">{streamerOk}</Aviso>}
                {ventana === "burbuja" && d.plan && (
                  <div className="space-y-1 text-xs text-tenue">
                    <p>Va a hablar {Math.round(d.plan.segundos)} s. Tarda unos {minutosHablar(d.plan.segundos)} minutos (la primera vez, más: baja el modelo, unos 28 GB).</p>
                    {d.plan.notas.map((n) => <p key={n}>{n}</p>)}
                    {d.plan.avisos.map((n) => <p key={n} className="text-amber-300">{n}</p>)}
                  </div>
                )}
                {!trabajo && <AvisoTarjeta g={guarde}>{puedeMover ? "Sólo para generarlo otra vez: moverlo no usa la tarjeta." : null}</AvisoTarjeta>}
                {error && <Aviso tipo="error">{error}</Aviso>}
                {trabajo ? (
                  <div className="space-y-1">
                    <p>{trabajo.estado === "pendiente" ? (motorVivo === false ? "En espera: Geeper está en pausa (mira el aviso de arriba)." : "En espera: la tarjeta de video está ocupada.") : trabajo.etapa || "Generando…"}</p>
                    <Barra valor={trabajo.progreso} etiqueta="Avance del presentador" />
                    <p className="text-xs text-tenue">Puedes seguir editando; cuando termine aparece en el video como una versión nueva (se deshace desde «Historial»).</p>
                    <button type="button" className="boton" onClick={() => void cancelar()}>Cancelar</button>
                  </div>
                ) : puedeMover ? (
                  <div className="space-y-2">
                    {movido && <Aviso tipo="ok">{movido}</Aviso>}
                    <div className="flex flex-wrap gap-2">
                      <button className="boton boton-primario" disabled={ocupado || enviando || !cambioUbicacion} onClick={() => void mover()}>
                        {cambioUbicacion ? "Aplicar la ubicación (al instante)" : "Ya está en ese lugar"}
                      </button>
                      <button className="boton" disabled={ocupado || enviando || !d.plan || faltaGuardar.length > 0} aria-describedby={describe} onClick={() => void generar()}>Generar el presentador otra vez</button>
                    </div>
                    <LineaFalta id={guarde.idFalta} faltan={faltaGuardar} />
                    <p className="text-xs text-tenue">Mover, agrandar o cambiar la forma no vuelve a generar el avatar: se aplica en segundos. Generarlo otra vez sólo hace falta si cambias el avatar, cómo habla o lo que dice.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <button className="boton boton-primario" disabled={ocupado || enviando || (ventana === "burbuja" && !d.plan) || faltaGuardar.length > 0}
                      aria-describedby={describe} onClick={() => void generar()}>
                      {ventana === "streamer" ? "Poner el presentador recortado" : d.estado.burbuja ? "Generar el presentador otra vez" : "Poner el presentador"}
                    </button>
                    <LineaFalta id={guarde.idFalta} faltan={faltaGuardar} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
