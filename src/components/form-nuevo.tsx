"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SugerenciasBusqueda, cambiarUltimaLinea, ultimaLinea } from "./sugerencias-busqueda";
import { Aviso, postJson, useSondeo } from "./comun";
import { ESTILOS_GENERACION, pasosDe, tiempoEstimado, type EstiloGeneracion } from "@/lib/estilos-generacion";
import { mismoSetup, type SetupVideo } from "@/lib/setup-video";
import { PanelSetup } from "./panel-setup";

interface Plantilla {
  slug: string;
  nombre: string;
  datos: { descripcion: string };
}

export function FormNuevo() {
  const router = useRouter();
  const { datos } = useSondeo<{ plantillas: Plantilla[] }>("/api/plantillas", 60_000);
  const [temas, setTemas] = useState("");
  const [formato, setFormato] = useState("9:16");
  const [plantilla, setPlantilla] = useState("gta-vi-shorts");
  const [mptTaskId, setMpt] = useState("");
  const [rehacerVoz, setRehacerVoz] = useState(true);
  const [aceptoGpu, setAcepto] = useState(false);
  // Tu avatar en el video (protagonista.ts): protagoniza cada escena, dentro de su fondo, y es la única persona.
  const { datos: lib } = useSondeo<{ avatares: { id: string; nombre: string; retrato: string }[] }>("/api/avatares", 60_000);
  const [avatar, setAvatar] = useState<string | null>(null);
  // Qué tan real (estilos-generacion.ts): «Máxima calidad» anima cada escena con Wan 2.2 y la interpola a 32 fps.
  const [estilo, setEstilo] = useState<EstiloGeneracion>("rapido");
  // El setup del preset (setup-video.ts): elegir un preset lo reinicia; «Personalizar el setup» lo cambia.
  const [setup, setSetup] = useState<SetupVideo>(ESTILOS_GENERACION.rapido.setup);
  const elegirEstilo = (id: EstiloGeneracion) => { setEstilo(id); setSetup(ESTILOS_GENERACION[id].setup); };
  const personalizado = !mismoSetup(setup, ESTILOS_GENERACION[estilo].setup);
  const [cuerpo, setCuerpo] = useState<"medio" | "completo">("medio");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lista = temas.split("\n").map((t) => t.trim()).filter(Boolean);
  const importa = mptTaskId.trim().length > 0;
  const necesitaGpu = !importa;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await postJson<{ proyectos: { id: string }[] }>("/api/proyectos", { temas, formato, plantilla, mptTaskId: mptTaskId || undefined, rehacerVoz, avatar: !importa && avatar ? avatar : undefined, estilo: importa ? undefined : estilo, setup: !importa && personalizado ? setup : undefined, cuerpo: !importa && avatar ? cuerpo : undefined });
      router.push(r.proyectos.length === 1 ? `/proyectos/${r.proyectos[0]!.id}` : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">Nuevo proyecto o lote</h1>
      <div>
        <label className="etiqueta" htmlFor="temas">Tema (uno por línea: varias líneas crean un lote)</label>
        <textarea id="temas" className="campo min-h-36 font-mono" value={temas} onChange={(e) => setTemas(e.target.value)}
          placeholder={"Por qué los faros siguen siendo importantes\nFaros que se convirtieron en hoteles"} required />
        <p className="mt-1 text-xs text-tenue">{lista.length === 0 ? "Sin temas todavía" : lista.length === 1 ? "1 proyecto" : `Lote de ${lista.length} proyectos (si se corta, se retoma sin repetir los terminados)`}</p>
        <SugerenciasBusqueda consulta={ultimaLinea(temas)} alElegir={(s) => setTemas(cambiarUltimaLinea(temas, s))} texto="Toca una para usarla como tema." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="etiqueta">Formato</legend>
          <div className="flex gap-2">
            {["9:16", "16:9", "1:1"].map((f) => (
              <label key={f} className={`boton cursor-pointer ${formato === f ? "boton-primario" : ""}`}>
                <input type="radio" name="formato" value={f} checked={formato === f} onChange={() => setFormato(f)} className="sr-only" />
                {f}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="etiqueta" htmlFor="plantilla">Plantilla de canal</label>
          <select id="plantilla" className="campo" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
            {datos?.plantillas.map((p) => <option key={p.slug} value={p.slug}>{p.nombre}</option>)}
          </select>
          <p className="mt-1 text-xs text-tenue">{datos?.plantillas.find((p) => p.slug === plantilla)?.datos.descripcion}</p>
          <a href="/plantillas?nueva=1" className="mt-1 inline-block text-xs text-cyan-300 underline">¿Ninguna es tuya? Crea una con tu marca</a>
        </div>
      {!!lib?.avatares.length && !importa && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">¿Tu avatar protagoniza el video? (opcional)</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!avatar} onClick={() => setAvatar(null)}
              className={`flex h-24 w-20 items-center justify-center rounded border text-center text-xs ${!avatar ? "border-acento ring-2 ring-acento" : "border-borde"}`}>Sin avatar</button>
            {lib.avatares.map((a) => (
              <button key={a.id} type="button" aria-pressed={avatar === a.id} onClick={() => setAvatar(a.id)}
                className={`w-20 overflow-hidden rounded border text-left ${avatar === a.id ? "border-acento ring-2 ring-acento" : "border-borde"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.retrato} alt="" className="h-[4.5rem] w-full object-cover" />
                <span className="block truncate px-1 text-xs">{a.nombre}</span>
              </button>
            ))}
          </div>
          {avatar && (
            <div className="flex flex-wrap items-center gap-2 text-sm" role="radiogroup" aria-label="¿Cómo sale tu avatar?">
              <span className="text-xs text-tenue">¿Cómo sale?</span>
              {([["medio", "De la cintura para arriba"], ["completo", "Cuerpo completo"]] as const).map(([id, nombre]) => (
                <button key={id} type="button" role="radio" aria-checked={cuerpo === id} onClick={() => setCuerpo(id)}
                  className={`boton ${cuerpo === id ? "boton-primario" : ""}`}>{nombre}</button>
              ))}
            </div>
          )}
          {avatar && cuerpo === "completo" && <p className="text-xs text-tenue">De cuerpo entero habla gesticulando con todo el cuerpo, como una persona frente a la cámara.</p>}
          {avatar && <p className="text-xs text-tenue">Sale en todas las escenas, dentro del fondo que se genera para cada una, y es la única persona del video: habla a cámara con su voz y gesticula como un humano. Suma unos 35 minutos en un short de 30 segundos y unos 55 en uno de un minuto. Para que comente en una ventana encima del video, usa «Presentador» en el editor.</p>}
        </fieldset>
      )}
      </div>
      {!importa && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">¿Qué tan real?</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="¿Qué tan real?">
            {Object.values(ESTILOS_GENERACION).map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={estilo === d.id} onClick={() => elegirEstilo(d.id)}
                className={`tarjeta p-3 text-left ${estilo === d.id ? "ring-2 ring-cyan-600" : "hover:bg-white/5"}`}>
                <span className="block text-sm font-medium">
                  {d.nombre}
                  {d.recomendado && <span className="ml-1 rounded bg-cyan-900/60 px-1.5 py-0.5 text-[10px] font-normal text-cyan-200">Recomendado</span>}
                </span>
                <span className="block text-xs text-tenue">{d.descripcion}</span>
                {/* Los workflows de cada paso (estilos-generacion.ts): qué usa, sin jerga de nodos. */}
                <dl className="mt-2 space-y-0.5 border-t border-borde pt-2 text-[11px] leading-snug">
                  {pasosDe(d.id, !!avatar).map((x) => (
                    <div key={x.paso} className="flex gap-1">
                      <dt className="shrink-0 text-tenue">{x.paso}:</dt>
                      <dd className="min-w-0">{x.workflow}</dd>
                    </div>
                  ))}
                </dl>
              </button>
            ))}
          </div>
          {estilo !== "3d" && <PanelSetup setup={setup} preset={ESTILOS_GENERACION[estilo].setup} nombrePreset={ESTILOS_GENERACION[estilo].nombre} conAvatar={!!avatar} alCambiar={setSetup} />}
          <p className="text-xs text-tenue">{estilo === "3d" ? `${tiempoEstimado("3d")} Necesita Blender (se instala con un clic en Sistema).` : avatar ? "Con tu avatar de protagonista el video ya es video de verdad: esto sólo cambia el acabado (grano, viñeta) y no suma tiempo." : tiempoEstimado(setup)}</p>
        </fieldset>
      )}
      <details className="tarjeta p-3">
        <summary className="cursor-pointer text-sm">Importar un short que MPT ya generó (sin usar la GPU)</summary>
        <label className="etiqueta mt-3" htmlFor="mpt">task_id de MoneyPrinterTurbo</label>
        <input id="mpt" className="campo font-mono" value={mptTaskId} onChange={(e) => setMpt(e.target.value)} placeholder="c721927b-353e-4dce-9bbb-8ce7d33ed5f2" />
        <p className="mt-1 text-xs text-tenue">Usa la primera línea de «Tema» como nombre.</p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rehacerVoz} onChange={(e) => setRehacerVoz(e.target.checked)} />
          Rehacer la voz con la de la plantilla (Kokoro en CPU; los shorts viejos de MPT van muy rápido para el QC)
        </label>
      </details>
      {necesitaGpu && (
        <Aviso tipo="alerta">
          <p className="font-medium">Generar usa la GPU (guion, imágenes y voz con MPT, unos 3 min por tema).</p>
          <p className="mt-1">Windows se ha reiniciado sin aviso durante generaciones: guarda tu trabajo antes. Si se reinicia, el trabajo queda «interrumpido» y lo relanzas tú desde Trabajos; nunca se reintenta solo.</p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={aceptoGpu} onChange={(e) => setAcepto(e.target.checked)} />
            Guardé mi trabajo; puedo generar.
          </label>
        </Aviso>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <button className="boton boton-primario" disabled={enviando || lista.length === 0 || (necesitaGpu && !aceptoGpu)}>
        {enviando ? "Creando…" : importa ? "Importar" : lista.length > 1 ? `Crear lote de ${lista.length}` : "Crear y generar"}
      </button>
    </form>
  );
}
