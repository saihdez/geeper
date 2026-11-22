"use client";
import Link from "next/link";
import { useState } from "react";
import { Aviso, Barra, postJson, useSondeo } from "./comun";
import { textoEspera, useMotorVivo } from "./motor";

interface AvatarV { id: string; nombre: string; retrato: string; estiloNombre: string }
interface MovimientoV { id: number; nombre: string; vista: string }
interface PlanV { ok: boolean; error?: string; notas?: string[]; segundos?: number }
interface Datos {
  wan2gp: { listo: boolean; falta: string | null };
  avatares: AvatarV[];
  movimientos: MovimientoV[];
  limites: { persona: number; camara: number };
  planes: { persona: PlanV; camara: PlanV };
  trabajos: { id: string; estado: string; etapa: string; progreso: number; escena: string | null }[];
}

type Modo = "persona" | "camara";

/**
 * «Rehacer la toma» (comfy-openjutsu y comfy-reshoot en Geeper): cambiar a la persona del video por un
 * avatar, o volver a filmar la escena con otro movimiento de cámara. Solo aparece en escenas con video.
 */
export function PanelRehacer({ proyectoId, escena, numero, ocupado, miniatura }: { proyectoId: string; escena: string; numero: number; ocupado: boolean; miniatura: string }) {
  const [abierto, setAbierto] = useState(false);
  const { datos, recargar } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/rehacer?escena=${encodeURIComponent(escena)}`, abierto ? 3000 : 15_000);
  const [modo, setModo] = useState<Modo | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [reiluminar, setReiluminar] = useState(true);
  const [movimiento, setMovimiento] = useState<number | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const motorVivo = useMotorVivo();
  const trabajo = datos?.trabajos.find((t) => t.escena === escena) ?? null;
  const plan = modo ? datos?.planes[modo] : null;
  const listo = modo === "persona" ? !!avatar : modo === "camara" ? movimiento !== null : false;

  async function rehacer() {
    if (!modo) return;
    setError(null);
    setEnviando(true);
    try {
      const pedido = modo === "persona" ? { tipo: "persona", avatar, reiluminar } : { tipo: "camara", movimiento, ...(descripcion.trim() ? { descripcion: descripcion.trim() } : {}) };
      await postJson(`/api/proyectos/${proyectoId}/rehacer`, { escena, pedido });
      setEnviado(true);
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <details className="text-sm" open={abierto} onToggle={(ev) => setAbierto((ev.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-tenue">
        Rehacer la toma con IA <span className="text-xs">(cambiar la persona o mover la cámara{trabajo ? ` · ${trabajo.estado === "pendiente" ? "en espera" : trabajo.etapa || "trabajando"}` : ""})</span>
      </summary>
      {abierto && datos && (
        <div className="mt-3 space-y-4 rounded border border-borde p-3">
          {!datos.wan2gp.listo && <Aviso tipo="alerta">Para esto hace falta Wan2GP: instálalo desde <Link className="underline" href="/sistema">Sistema</Link>.</Aviso>}
          {trabajo ? (
            <div className="space-y-1">
              <p className="text-xs">{trabajo.estado === "pendiente" ? textoEspera(motorVivo) : trabajo.etapa || "Trabajando…"}</p>
              <Barra valor={trabajo.progreso} etiqueta={`Avance de la escena ${numero}`} />
              <p className="text-xs text-tenue">Cuando termine, la escena {numero} cambia sola. Si no te gusta, vuelve atrás en el historial.</p>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="font-medium">1. ¿Qué quieres cambiar?</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {([["persona", "Cambiar la persona", "Pon a uno de tus avatares en lugar de quien sale. Copia sus movimientos, sus gestos y su boca."], ["camara", "Mover la cámara", "La misma toma, filmada otra vez con otro movimiento de cámara."]] as const).map(([id, titulo, texto]) => (
                    <button key={id} type="button" aria-pressed={modo === id} onClick={() => { setModo(id); setEnviado(false); setError(null); }}
                      className={`rounded border p-3 text-left ${modo === id ? "border-acento bg-acento/10" : "border-borde hover:border-acento/60"}`}>
                      <span className="block font-medium">{titulo}</span>
                      <span className="block text-xs text-tenue">{texto}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {plan && !plan.ok && <Aviso tipo="info">{plan.error}</Aviso>}

              {modo === "persona" && plan?.ok && (
                <fieldset className="space-y-2">
                  <legend className="font-medium">2. ¿Quién aparece en su lugar?</legend>
                  {datos.avatares.length === 0 ? (
                    <p className="text-xs">Todavía no tienes avatares. <Link className="text-acento underline" href="/avatares">Crea uno</Link> y vuelve aquí.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {datos.avatares.map((a) => (
                        <button key={a.id} type="button" aria-pressed={avatar === a.id} onClick={() => setAvatar(a.id)}
                          className={`overflow-hidden rounded border text-left ${avatar === a.id ? "border-acento ring-2 ring-acento" : "border-borde"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.retrato} alt="" className="aspect-[2/3] w-full object-cover" />
                          <span className="block truncate px-1 py-0.5 text-xs">{a.nombre}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={reiluminar} onChange={(e) => setReiluminar(e.target.checked)} />
                    <span>Igualar la luz de la escena (recomendado: así el avatar no parece pegado)</span>
                  </label>
                </fieldset>
              )}

              {modo === "camara" && plan?.ok && (
                <fieldset className="space-y-2">
                  <legend className="font-medium">2. ¿Cómo se mueve la cámara? <span className="text-xs font-normal text-tenue">(cada cuadro muestra el movimiento)</span></legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {datos.movimientos.map((m) => (
                      <button key={m.id} type="button" aria-pressed={movimiento === m.id} onClick={() => setMovimiento(m.id)}
                        className={`overflow-hidden rounded border text-left ${movimiento === m.id ? "border-acento ring-2 ring-acento" : "border-borde"}`}>
                        <span className="block aspect-video overflow-hidden bg-black">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={miniatura} alt="" className="vista-camara h-full w-full object-cover" style={{ animationName: `cam-${m.vista}` }} />
                        </span>
                        <span className="block px-1 py-0.5 text-xs">{m.nombre}</span>
                      </button>
                    ))}
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-tenue">Más opciones</summary>
                    <label className="mt-2 block space-y-1">
                      <span>Qué se ve en la toma (opcional; en inglés sale mejor)</span>
                      <textarea className="campo min-h-16" maxLength={600} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="A lighthouse on a cliff at sunset, waves crashing" />
                    </label>
                  </details>
                </fieldset>
              )}

              {plan?.ok && (
                <>
                  {plan.notas?.map((n) => <p key={n} className="text-xs text-tenue">{n}</p>)}
                  <p className="text-xs text-tenue">
                    Usa la tarjeta de video y tarda varios minutos{modo === "persona" ? " (más cuanto más larga sea la escena)" : ""}. La primera vez baja el modelo ({modo === "persona" ? "unos 23 GB" : "unos 3 GB"}).
                  </p>
                  {error && <Aviso tipo="error">{error}</Aviso>}
                  {enviado ? (
                    <Aviso tipo="ok">Listo: está en camino. Lo ves avanzar aquí mismo.</Aviso>
                  ) : (
                    <button type="button" className="boton boton-primario" disabled={!listo || enviando || ocupado || !datos.wan2gp.listo} onClick={() => void rehacer()}>
                      {enviando ? "Enviando…" : `3. Rehacer la escena ${numero}`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
