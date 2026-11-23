"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SugerenciasBusqueda, cambiarUltimaLinea, ultimaLinea } from "./sugerencias-busqueda";
import { Aviso, postJson, useSondeo } from "./comun";
import { ESTILOS_GENERACION, tiempoEstimado, type EstiloGeneracion } from "@/lib/estilos-generacion";
import { FORMAS } from "@/lib/glosario";

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
  if (o.necesitaGpu && !o.aceptoGpu) falta.push("marcar la casilla de arriba");
  return falta;
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
  // Tu avatar en el video (actuar.ts): Geeper lo pone en las escenas que más ganan con él.
  const { datos: lib } = useSondeo<{ avatares: { id: string; nombre: string; retrato: string }[] }>("/api/avatares", 60_000);
  const [avatar, setAvatar] = useState<string | null>(null);
  // Qué tan real (estilos-generacion.ts): «Lo más real posible» anima cada escena con Wan.
  const [estilo, setEstilo] = useState<EstiloGeneracion>("rapido");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lista = temas.split("\n").map((t) => t.trim()).filter(Boolean);
  const importa = mptTaskId.trim().length > 0;
  const codigoMal = importa && !CODIGO_MPT.test(mptTaskId.trim());
  const necesitaGpu = !importa;
  const faltan = [...faltaNuevo({ temas: lista.length, necesitaGpu, aceptoGpu }), ...(codigoMal ? ["un código de video completo"] : [])];

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await postJson<{ proyectos: { id: string }[] }>("/api/proyectos", { temas, formato, plantilla, mptTaskId: mptTaskId.trim() || undefined, rehacerVoz, avatar: !importa && avatar ? avatar : undefined, estilo: importa ? undefined : estilo });
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
        <textarea id="temas" className="campo min-h-36 font-mono" value={temas} onChange={(e) => setTemas(e.target.value)}
          placeholder={"Por qué los faros siguen siendo importantes\nFaros que se convirtieron en hoteles"} required />
        <p className="mt-1 text-xs text-tenue">{lista.length === 0 ? "Sin temas todavía" : lista.length === 1 ? "1 video" : `${lista.length} videos (si se corta, se retoma sin repetir los terminados)`}</p>
        <SugerenciasBusqueda consulta={ultimaLinea(temas)} alElegir={(s) => setTemas(cambiarUltimaLinea(temas, s))} texto="Toca una para usarla como tema." />
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
        </div>
      </div>
      {!!lib?.avatares.length && !importa && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">¿Sale tu avatar? (opcional)</legend>
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
          {avatar && <p className="text-xs text-tenue">Geeper lo pone hablando en el gancho y en el cierre, y actuando en las escenas que hablan de personas. Suma unos 10 minutos por escena en la tarjeta de video; después puedes cambiarlo escena por escena.</p>}
        </fieldset>
      )}
      {!importa && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">¿Qué tan real?</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="¿Qué tan real?">
            {Object.values(ESTILOS_GENERACION).map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={estilo === d.id} onClick={() => setEstilo(d.id)}
                className="opcion-tarjeta p-3">
                <span className="block text-sm font-medium">{d.nombre}</span>
                <span className="block text-xs text-tenue">{d.descripcion}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-tenue">{tiempoEstimado(estilo)}</p>
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
        <Aviso tipo="alerta">
          <p className="font-medium">Crear el video usa la tarjeta de video (guion, imágenes y voz; unos 3 min por tema).</p>
          <p className="mt-1">Windows se ha reiniciado sin aviso durante generaciones: guarda tu trabajo antes. Si se reinicia, el trabajo queda «interrumpido» y lo vuelves a empezar tú desde Trabajos con «Volver a intentar»; nunca empieza solo otra vez.</p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={aceptoGpu} onChange={(e) => setAcepto(e.target.checked)} />
            Guardé mi trabajo; puedo generar.
          </label>
        </Aviso>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="space-y-1">
        <button className="boton boton-primario" disabled={enviando || faltan.length > 0} aria-describedby={faltan.length ? "nuevo-falta" : undefined}>
          {enviando ? "Creando…" : importa ? "Importar" : lista.length > 1 ? `Crear ${lista.length} videos` : "Crear el video"}
        </button>
        {faltan.length > 0 && <p id="nuevo-falta" className="text-xs text-amber-300">Para continuar falta: {faltan.join(" · ")}.</p>}
      </div>
    </form>
  );
}
