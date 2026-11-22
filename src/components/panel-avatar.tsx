"use client";
import Link from "next/link";
import { useState } from "react";
import type { AvatarV } from "./avatares";
import { Aviso, Barra, pedir, postJson, useSondeo } from "./comun";
import { enlaceAvatares } from "@/lib/asistente-avatar";

interface Datos {
  wan2gp: { listo: boolean; falta: string | null };
  avatares: AvatarV[];
  delVideo: { avatar: string; producto?: string } | null;
  encuadres: Record<Encuadre, string>;
  ejemplos: string[];
  propuesta: { escena: string; numero: number; tipo: "habla" | "accion"; encuadre: Encuadre; que: string; porque: string }[];
  trabajos: { id: string; tipo: string; estado: string; etapa: string; progreso: number; escena: string | null }[];
}
type Encuadre = "cara" | "medio" | "completo";

const DESCRIPCION_ENCUADRE: Record<Encuadre, string> = {
  cara: "Hombros y cara, como un presentador de noticias.",
  medio: "De la cintura para arriba: se ven sus manos y gestos.",
  completo: "De pies a cabeza: puede caminar y moverse.",
};

/** Las tarjetas para elegir avatar (o el aviso para crear uno). */
function ElegirAvatar({ avatares, elegido, elegir, proyectoId }: { avatares: AvatarV[]; elegido: string | null; elegir: (id: string) => void; proyectoId: string }) {
  if (!avatares.length) return <p className="text-xs">Primero crea un avatar (3 pasos, unos minutos). Después vuelves aquí y lo eliges. <Link className="text-acento underline" href={enlaceAvatares(proyectoId)}>Crear un avatar</Link></p>;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {avatares.map((a) => (
        <button key={a.id} type="button" aria-pressed={elegido === a.id} onClick={() => elegir(a.id)}
          className={`overflow-hidden rounded border text-left ${elegido === a.id ? "border-acento ring-2 ring-acento" : "border-borde"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.retrato} alt="" className="aspect-[2/3] w-full object-cover" />
          <span className="block truncate px-1 py-0.5 text-xs">{a.nombre}</span>
        </button>
      ))}
    </div>
  );
}

function Opciones<T extends string>({ valor, opciones, cambiar }: { valor: T; opciones: { id: T; titulo: string; texto?: string }[]; cambiar: (v: T) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={valor === o.id} onClick={() => cambiar(o.id)}
          className={`rounded border p-2 text-left ${valor === o.id ? "border-acento bg-acento/10" : "border-borde hover:border-acento/60"}`}>
          <span className="block text-sm font-medium">{o.titulo}</span>
          {o.texto && <span className="block text-xs text-tenue">{o.texto}</span>}
        </button>
      ))}
    </div>
  );
}

/** Sube la foto del producto al proyecto; devuelve su ruta. */
function SubirProducto({ proyectoId, producto, cambiar }: { proyectoId: string; producto: string | null; cambiar: (p: string | null) => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function subir(f: File) {
    setError(null);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.set("producto", f);
      const r = await pedir<{ producto: string }>(`/api/proyectos/${proyectoId}/avatar`, { method: "POST", body: fd });
      cambiar(r.producto);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="boton cursor-pointer">
          {subiendo ? "Subiendo…" : producto ? "Cambiar la foto del producto" : "Subir la foto de tu producto (opcional)"}
          <input type="file" className="sr-only" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
        </label>
        {producto && <button type="button" className="boton" onClick={() => cambiar(null)}>Sin producto</button>}
      </div>
      {producto && <p className="text-emerald-300">Listo: tu avatar lo va a mostrar. Mejor una foto del producto solo, sobre fondo liso.</p>}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}

/**
 * «Tu avatar en el video» (nivel proyecto): que Geeper lo ponga en las escenas que más ganan con él, o
 * encima de todo el video como un streamer (gameplay). Decisiones del dueño, 2026-11-21.
 */
export function PanelAvatarVideo({ proyectoId, ocupado }: { proyectoId: string; ocupado: boolean }) {
  const { datos, recargar } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/avatar`, 5000);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [modo, setModo] = useState<"escenas" | "streamer">("escenas");
  const [producto, setProducto] = useState<string | null>(null);
  const [encuadre, setEncuadre] = useState<"medio" | "completo">("medio");
  const [lado, setLado] = useState<"derecha" | "izquierda">("derecha");
  const [tamano, setTamano] = useState(0.4);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!datos) return null;
  const elegido = avatar ?? datos.delVideo?.avatar ?? datos.avatares[0]?.id ?? null;
  const nombre = datos.avatares.find((a) => a.id === elegido)?.nombre ?? "tu avatar";
  const enCurso = datos.trabajos.filter((t) => t.tipo !== "avatar.actuar");

  async function enviar() {
    if (!elegido) return;
    setError(null);
    setOk(null);
    setEnviando(true);
    try {
      if (modo === "escenas") await postJson(`/api/proyectos/${proyectoId}/avatar`, { accion: "proponer", avatar: elegido, ...(producto ? { producto } : {}) });
      else await postJson(`/api/proyectos/${proyectoId}/avatar`, { accion: "streamer", pedido: { avatar: elegido, encuadre, lado, tamano } });
      setOk(modo === "escenas" ? `Listo: ${nombre} va entrando escena por escena. Cada una queda como versión nueva.` : `Listo: ${nombre} va a aparecer recortado sobre todo el video.`);
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="tarjeta space-y-4 p-4" aria-label="Tu avatar en el video">
      <div>
        <h2 className="text-lg font-semibold">Tu avatar en el video</h2>
        <p className="text-sm text-tenue">Tu avatar actúa en el video como una persona: habla a cámara, hace cosas, muestra tu producto o comenta encima de un gameplay. En cada escena puedes cambiar lo que hace («Tu avatar en esta escena»).</p>
      </div>
      {!datos.wan2gp.listo && <Aviso tipo="alerta">Para esto hace falta Wan2GP: instálalo desde <Link className="underline" href="/sistema">Sistema</Link>.</Aviso>}
      {enCurso.map((t) => (
        <div key={t.id} className="space-y-1">
          <p className="text-xs">{t.estado === "pendiente" ? "En espera: la tarjeta de video está ocupada." : t.etapa || "Trabajando…"}</p>
          <Barra valor={t.progreso} />
        </div>
      ))}
      <fieldset className="space-y-2">
        <legend className="font-medium">1. ¿Quién?</legend>
        <ElegirAvatar avatares={datos.avatares} elegido={elegido} elegir={setAvatar} proyectoId={proyectoId} />
      </fieldset>
      {elegido && (
        <>
          <fieldset className="space-y-2">
            <legend className="font-medium">2. ¿Cómo aparece?</legend>
            <Opciones valor={modo} cambiar={setModo} opciones={[
              { id: "escenas", titulo: "Geeper elige dónde (recomendado)", texto: "Habla en el gancho y en el cierre, y actúa en las escenas que hablan de personas." },
              { id: "streamer", titulo: "Como streamer, todo el video", texto: "Recortado encima del video (ideal para gameplay), hablando y gesticulando." },
            ]} />
          </fieldset>
          {modo === "escenas" ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">3. Esto propone Geeper</p>
              <ul className="space-y-1 text-xs">
                {datos.propuesta.map((p) => (
                  <li key={p.escena}>Escena {p.numero}: {p.tipo === "habla" ? "habla a cámara" : p.que} · {datos.encuadres[p.encuadre].toLowerCase()} <span className="text-tenue">({p.porque})</span></li>
                ))}
              </ul>
              <SubirProducto proyectoId={proyectoId} producto={producto} cambiar={setProducto} />
              <p className="text-xs text-tenue">Cada escena tarda entre 5 y 15 minutos en la tarjeta de video. La primera vez baja los modelos (varios GB).</p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <fieldset className="space-y-2">
                <legend className="font-medium">3. ¿Cuánto se le ve?</legend>
                <Opciones valor={encuadre} cambiar={setEncuadre} opciones={[
                  { id: "medio", titulo: "Medio cuerpo", texto: DESCRIPCION_ENCUADRE.medio },
                  { id: "completo", titulo: "Cuerpo completo", texto: DESCRIPCION_ENCUADRE.completo },
                ]} />
              </fieldset>
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="mb-1 font-medium">4. ¿Dónde?</legend>
                <Opciones valor={lado} cambiar={setLado} opciones={[{ id: "izquierda", titulo: "↙ Abajo a la izquierda" }, { id: "derecha", titulo: "↘ Abajo a la derecha" }]} />
                <label className="flex items-center gap-2 text-xs">Tamaño
                  <input type="range" min={0.25} max={0.6} step={0.05} value={tamano} onChange={(e) => setTamano(Number(e.target.value))} />
                </label>
              </fieldset>
              <p className="text-xs text-tenue">Habla con la voz de todo el video. Tarda unos 7 minutos más ~20 s por cada segundo de voz. Para que tu avatar salga <b>dentro</b> del juego, usa en la escena «Rehacer la toma» → «Cambiar la persona».</p>
            </div>
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
          {ok && <Aviso tipo="ok">{ok}</Aviso>}
          <button type="button" className="boton boton-primario" disabled={enviando || ocupado || !datos.wan2gp.listo || enCurso.length > 0} onClick={() => void enviar()}>
            {enviando ? "Enviando…" : modo === "escenas" ? `Poner a ${nombre} en esas escenas` : `Poner a ${nombre} como streamer`}
          </button>
        </>
      )}
    </section>
  );
}

/** «Tu avatar en esta escena»: qué hace, cómo se ve y dónde. Se carga al abrirlo. */
export function PanelAvatarEscena({ proyectoId, escena, numero, ocupado }: { proyectoId: string; escena: string; numero: number; ocupado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <details className="text-sm" open={abierto} onToggle={(ev) => setAbierto((ev.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-tenue">Tu avatar en esta escena <span className="text-xs">(que hable, que haga algo, que muestre tu producto)</span></summary>
      {abierto && <FormAvatarEscena proyectoId={proyectoId} escena={escena} numero={numero} ocupado={ocupado} />}
    </details>
  );
}

function FormAvatarEscena({ proyectoId, escena, numero, ocupado }: { proyectoId: string; escena: string; numero: number; ocupado: boolean }) {
  const { datos, recargar } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/avatar`, 4000);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [tipo, setTipo] = useState<"habla" | "accion">("habla");
  const [encuadre, setEncuadre] = useState<Encuadre>("medio");
  const [lugar, setLugar] = useState<"escena" | "estudio" | "describir">("escena");
  const [donde, setDonde] = useState("");
  const [que, setQue] = useState("");
  const [producto, setProducto] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  if (!datos) return <p className="mt-2 text-xs text-tenue">Cargando…</p>;
  const elegido = avatar ?? datos.delVideo?.avatar ?? datos.avatares[0]?.id ?? null;
  const trabajo = datos.trabajos.find((t) => t.escena === escena);
  const falta = tipo === "accion" && !que.trim() ? "Escribe qué hace (o toca un ejemplo)." : lugar === "describir" && !donde.trim() ? "Escribe dónde está." : null;

  async function enviar() {
    if (!elegido) return;
    setError(null);
    setEnviando(true);
    try {
      await postJson(`/api/proyectos/${proyectoId}/avatar`, {
        accion: "escena",
        escena,
        pedido: { avatar: elegido, tipo, encuadre, que: que.trim(), lugar, donde: donde.trim(), ...(producto ? { producto } : {}) },
      });
      setEnviado(true);
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-3 space-y-4 rounded border border-borde p-3">
      {trabajo ? (
        <div className="space-y-1">
          <p className="text-xs">{trabajo.estado === "pendiente" ? "En espera: la tarjeta de video está ocupada." : trabajo.etapa || "Trabajando…"}</p>
          <Barra valor={trabajo.progreso} />
          <p className="text-xs text-tenue">Cuando termine, la escena {numero} cambia sola. Si no te gusta, vuelve atrás en el historial.</p>
        </div>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="font-medium">1. ¿Quién?</legend>
            <ElegirAvatar avatares={datos.avatares} elegido={elegido} elegir={setAvatar} proyectoId={proyectoId} />
          </fieldset>
          {elegido && (
            <>
              <fieldset className="space-y-2">
                <legend className="font-medium">2. ¿Qué hace?</legend>
                <Opciones valor={tipo} cambiar={setTipo} opciones={[
                  { id: "habla", titulo: "Habla a cámara", texto: "Dice lo de esta escena con la voz del video, moviendo la boca." },
                  { id: "accion", titulo: "Hace algo", texto: "Camina, juega, celebra, muestra tu producto… (sin hablar)." },
                ]} />
                {tipo === "accion" && (
                  <div className="space-y-2">
                    <input className="campo" maxLength={400} value={que} onChange={(e) => setQue(e.target.value)} placeholder="Ej.: camina hacia la cámara sonriendo" aria-label="Qué hace tu avatar" />
                    <div className="flex flex-wrap gap-1">
                      {datos.ejemplos.map((x) => <button key={x} type="button" className="rounded-full border border-borde px-2 py-0.5 text-xs hover:border-acento" onClick={() => setQue(x)}>{x}</button>)}
                    </div>
                  </div>
                )}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-medium">3. ¿Cuánto se le ve?</legend>
                <Opciones valor={encuadre} cambiar={setEncuadre} opciones={(["cara", "medio", "completo"] as const).map((k) => ({ id: k, titulo: datos.encuadres[k], texto: DESCRIPCION_ENCUADRE[k] }))} />
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-medium">4. ¿Dónde está?</legend>
                <Opciones valor={lugar} cambiar={setLugar} opciones={[
                  { id: "escena", titulo: "En el lugar de esta escena", texto: "Lo pone dentro de la imagen que ya tiene la escena." },
                  { id: "estudio", titulo: "Fondo de estudio", texto: "Fondo liso, como en una entrevista." },
                  { id: "describir", titulo: "Otro lugar", texto: "Lo describes tú (una calle, un gimnasio, un mundo de videojuego…)." },
                ]} />
                {lugar === "describir" && <input className="campo" maxLength={300} value={donde} onChange={(e) => setDonde(e.target.value)} placeholder="Ej.: una ciudad futurista de noche, estilo videojuego" aria-label="Dónde está tu avatar" />}
              </fieldset>
              <SubirProducto proyectoId={proyectoId} producto={producto} cambiar={setProducto} />
              <p className="text-xs text-tenue">Usa la tarjeta de video: unos {tipo === "habla" ? "8 a 12" : "5 a 10"} minutos (la primera vez, más: baja los modelos).</p>
              {(error || falta) && <Aviso tipo={error ? "error" : "info"}>{error ?? falta}</Aviso>}
              {enviado ? (
                <Aviso tipo="ok">Listo: está en camino. Lo ves avanzar aquí mismo.</Aviso>
              ) : (
                <button type="button" className="boton boton-primario" disabled={!!falta || enviando || ocupado || !datos.wan2gp.listo} onClick={() => void enviar()}>
                  {enviando ? "Enviando…" : `5. Poner a tu avatar en la escena ${numero}`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
