"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SugerenciasBusqueda, cambiarUltimaLinea, ultimaLinea } from "./sugerencias-busqueda";
import { Aviso, AvisoTarjeta, FALTA_GUARDAR, LineaFalta, postJson, useGuardeAntes, useSondeo } from "./comun";
import { ESTILOS_GENERACION, pasosDe, tiempoEstimado, type EstiloGeneracion } from "@/lib/estilos-generacion";
import { mismoSetup, type SetupVideo } from "@/lib/setup-video";
import { PanelSetup } from "./panel-setup";
import { FORMAS } from "@/lib/glosario";
import { leerTabla, pareceTabla } from "@/lib/tabla-videos";
import { TablaVideos } from "./tabla-videos";

interface Plantilla {
  slug: string;
  nombre: string;
  datos: { descripcion: string };
}

/** El código (task_id) de un video de MoneyPrinterTurbo, como lo valida el servidor (servicios.ts). */
export const CODIGO_MPT = /^[0-9a-f-]{36}$/;

/** Lo que falta para poder enviar, en palabras de la persona (UX-31): va debajo del botón apagado. */
export function faltaNuevo(o: { temas: number; necesitaGpu: boolean; aceptoGpu: boolean }): string[] {
  const falta: string[] = [];
  if (o.temas === 0) falta.push("escribir el tema");
  if (o.necesitaGpu && !o.aceptoGpu) falta.push(FALTA_GUARDAR);
  return falta;
}

export function FormNuevo() {
  const router = useRouter();
  const { datos } = useSondeo<{ plantillas: Plantilla[] }>("/api/plantillas", 60_000);
  const [temas, setTemas] = useState("");
  // Varios videos desde una tabla (tabla-videos.ts): si hay tabla, manda ella.
  const [tabla, setTabla] = useState("");
  const [verTabla, setVerTabla] = useState(false);
  const [formato, setFormato] = useState("9:16");
  const [plantilla, setPlantilla] = useState("gta-vi-shorts");
  const [mptTaskId, setMpt] = useState("");
  const [rehacerVoz, setRehacerVoz] = useState(true);
  const guarde = useGuardeAntes();
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
  const importa = mptTaskId.trim().length > 0;
  const filas = tabla.trim() && !importa ? leerTabla(tabla).filas : [];
  const lista = filas.length ? filas.map((f) => f.tema) : temas.split("\n").map((t) => t.trim()).filter(Boolean);
  const codigoMal = importa && !CODIGO_MPT.test(mptTaskId.trim());
  const necesitaGpu = !importa;
  const faltan = [...faltaNuevo({ temas: lista.length, necesitaGpu, aceptoGpu: guarde.guardado }), ...(codigoMal ? ["un código de video completo"] : [])];

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await postJson<{ proyectos: { id: string }[] }>("/api/proyectos", { temas: filas.length ? lista.join("\n") : temas, filas: filas.length ? filas : undefined, formato, plantilla, mptTaskId: mptTaskId.trim() || undefined, rehacerVoz, avatar: !importa && avatar ? avatar : undefined, estilo: importa ? undefined : estilo, setup: !importa && personalizado ? setup : undefined, cuerpo: !importa && avatar ? cuerpo : undefined });
      router.push(r.proyectos.length === 1 ? `/proyectos/${r.proyectos[0]!.id}` : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      <div>
        <label className="etiqueta" htmlFor="temas">Tema (uno por línea: cada línea es un video)</label>
        {filas.length > 0 ? (
          <p className="campo text-sm text-tenue">Los temas salen de la tabla de abajo ({filas.length === 1 ? "1 video" : `${filas.length} videos`}).</p>
        ) : (
          <textarea id="temas" className="campo min-h-36 font-mono" value={temas}
            onChange={(e) => {
              // Una tabla pegada aquí (con tabuladores, desde Excel o Sheets) va a la tabla.
              if (pareceTabla(e.target.value) && e.target.value.includes("\n")) {
                setTabla(e.target.value);
                setVerTabla(true);
              } else setTemas(e.target.value);
            }}
            placeholder={"Por qué los faros siguen siendo importantes\nFaros que se convirtieron en hoteles"} required={!filas.length} />
        )}
        <p className="mt-1 text-xs text-tenue">{lista.length === 0 ? "Sin temas todavía" : lista.length === 1 ? "1 video" : `${lista.length} videos (si se corta, se retoma sin repetir los terminados)`}</p>
        {!filas.length && <SugerenciasBusqueda consulta={ultimaLinea(temas)} alElegir={(s) => setTemas(cambiarUltimaLinea(temas, s))} texto="Toca una para usarla como tema." />}
        {!importa && (
          <details className="mt-2 rounded-lg border border-borde p-3" open={verTabla || !!tabla} onToggle={(e) => setVerTabla((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-sm font-medium">¿Muchos videos con su propio título o guion? Úsalos desde una tabla (Excel o Google Sheets)</summary>
            <div className="mt-2"><TablaVideos texto={tabla} alCambiar={setTabla} /></div>
          </details>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="etiqueta">Forma del video</legend>
          <div className="flex gap-2">
            {(["9:16", "16:9", "1:1"] as const).map((f) => (
              <label key={f} className="opcion">
                <input type="radio" name="formato" value={f} checked={formato === f} onChange={() => setFormato(f)} className="sr-only" />
                {FORMAS[f].nombre} <span className="text-xs text-tenue">{f}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="etiqueta" htmlFor="plantilla">Estilo del canal</label>
          <select id="plantilla" className="campo" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
            {datos?.plantillas.map((p) => <option key={p.slug} value={p.slug}>{p.nombre}</option>)}
          </select>
          <p className="mt-1 text-xs text-tenue">{datos?.plantillas.find((p) => p.slug === plantilla)?.datos.descripcion}</p>
          <a href="/plantillas?nueva=1" className="mt-1 inline-block text-xs text-cyan-300 underline">¿Ninguno es tuyo? Crea uno con tu marca</a>
        </div>
      </div>
      {!!lib?.avatares.length && !importa && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">¿Tu avatar protagoniza el video? (opcional)</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!avatar} onClick={() => setAvatar(null)}
              className="opcion-tarjeta flex h-24 w-20 items-center justify-center text-center text-xs">Sin avatar</button>
            {lib.avatares.map((a) => (
              <button key={a.id} type="button" aria-pressed={avatar === a.id} onClick={() => setAvatar(a.id)}
                className="opcion-tarjeta w-20 overflow-hidden">
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
                  className="opcion">{nombre}</button>
              ))}
            </div>
          )}
          {avatar && cuerpo === "completo" && <p className="text-xs text-tenue">De cuerpo entero habla gesticulando con todo el cuerpo, como una persona frente a la cámara.</p>}
          {avatar && <p className="text-xs text-tenue">Sale en todas las escenas, dentro del fondo que se genera para cada una, y es la única persona del video: habla a cámara con su voz y gesticula como un humano. Suma unos 35 minutos en un short de 30 segundos y unos 55 en uno de un minuto. Para que comente en una ventana encima del video, usa «Presentador» en el editor.</p>}
        </fieldset>
      )}
      {!importa && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">¿Qué tan real?</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="¿Qué tan real?">
            {Object.values(ESTILOS_GENERACION).map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={estilo === d.id} onClick={() => elegirEstilo(d.id)}
                className="opcion-tarjeta p-3">
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
      {/* Para quien instaló MoneyPrinterTurbo (UX-39): queda guardado en «Más opciones». */}
      <details className="tarjeta p-3" open={importa || undefined}>
        <summary className="cursor-pointer text-sm">Más opciones</summary>
        <p className="mt-3 text-sm font-medium">Usar un video que ya hice con MoneyPrinterTurbo</p>
        <p className="text-xs text-tenue">No usa la tarjeta de video: Geeper toma ese video y lo deja listo para editar.</p>
        <label className="etiqueta mt-2" htmlFor="mpt">Código del video (como el de ejemplo, con guiones)</label>
        <input id="mpt" className="campo font-mono" value={mptTaskId} onChange={(e) => setMpt(e.target.value)} placeholder="c721927b-353e-4dce-9bbb-8ce7d33ed5f2"
          aria-invalid={codigoMal || undefined} aria-describedby="mpt-ayuda" autoComplete="off" spellCheck={false} />
        <p id="mpt-ayuda" className={`mt-1 text-xs ${codigoMal ? "text-red-400" : "text-tenue"}`}>
          {codigoMal ? "Ese código no está completo: son 32 letras y números en 5 partes separadas por guiones, como el de ejemplo. " : ""}
          Lo ves en MoneyPrinterTurbo al terminar un video, y es el nombre de su carpeta dentro de storage/tasks. El nombre del proyecto sale de la primera línea de «Tema».
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rehacerVoz} onChange={(e) => setRehacerVoz(e.target.checked)} />
          Rehacer la voz con la del estilo del canal (sin la tarjeta de video; las voces viejas de MoneyPrinterTurbo hablan muy rápido para la revisión)
        </label>
      </details>
      {necesitaGpu && (
        <AvisoTarjeta g={guarde}>
          Crear el video tarda unos 3 min por tema. Si se corta, queda «interrumpido» y lo vuelves a empezar tú desde Trabajos con «Volver a intentar»; nunca empieza solo otra vez.
        </AvisoTarjeta>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="space-y-1">
        <button className="boton boton-primario" disabled={enviando || faltan.length > 0} aria-describedby={faltan.length ? guarde.idFalta : undefined}>
          {enviando ? "Creando…" : importa ? "Importar" : lista.length > 1 ? `Crear ${lista.length} videos` : "Crear el video"}
        </button>
        <LineaFalta id={guarde.idFalta} faltan={faltan} />
      </div>
    </form>
  );
}
