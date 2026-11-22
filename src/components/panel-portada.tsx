"use client";
import { useEffect, useRef, useState } from "react";
import { Aviso, archivo, postJson, useSondeo } from "./comun";

interface Opcion {
  archivo: string;
  titulo: string;
  escena: number;
  version: number;
  creada: string;
  estilo: string;
  avisos: string[];
  achicados: Record<string, number>;
  desbordan: string[];
}
interface Propuesta { titulos: string[]; fuente: "ia" | "sugeridos"; motivo?: string }
interface Estado {
  elegida: Opcion | null;
  opciones: Opcion[];
  titulos: Propuesta | null;
  escenas: { escena: number; miniatura: string }[];
  estilos: { id: string; nombre: string; descripcion: string }[];
  estilo: string;
  disenoPropio: boolean;
  herramienta: boolean;
}

/** Avisos de una opción, en palabras simples. */
function avisosDe(o: Opcion): string[] {
  const out: string[] = [];
  if (o.desbordan.length) out.push("El título es muy largo y no entra entero: acórtalo.");
  for (const a of o.avisos) {
    const fuente = /font family `([^`]+)`/i.exec(a);
    out.push(fuente ? `La letra «${fuente[1]}» no está en esta computadora: se usó una parecida.` : a);
  }
  return out;
}

/**
 * Portada del video en 3 pasos: elegir la imagen (una por escena), elegir hasta 3 títulos (la IA local
 * propone) y crear las portadas para quedarse con una. Se compone con PhotoCraft, en un segundo.
 */
export function PanelPortada({ proyectoId, nombre, version, vertical, alDia = (n) => n === version }: {
  proyectoId: string; nombre: string; version: number; vertical: boolean;
  /** UX-21: si la versión de la portada tiene el mismo contenido que la actual (por hash). */
  alDia?: (version: number) => boolean;
}) {
  const { datos: e, recargar } = useSondeo<Estado>(`/api/proyectos/${proyectoId}/portada`, 120_000);
  const [escena, setEscena] = useState<number | null>(null);
  const [titulos, setTitulos] = useState<string[] | null>(null);
  const [estilo, setEstilo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"titulos" | "crear" | "elegir" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const pedidoAuto = useRef(false);

  const escenaSel = escena ?? e?.elegida?.escena ?? e?.opciones[0]?.escena ?? (e ? Math.floor(e.escenas.length * 0.3) : 0);
  const estiloSel = estilo ?? e?.estilo ?? "abajo";
  const lista = titulos ?? (e?.titulos?.titulos.length ? e.titulos.titulos : [nombre]);
  const campos = [...lista, "", "", ""].slice(0, 3);

  async function proponer() {
    setOcupado("titulos");
    setError(null);
    try {
      const r = await postJson<Propuesta>(`/api/proyectos/${proyectoId}/portada`, { accion: "titulos" });
      setTitulos([...r.titulos]);
      setNota(r.fuente === "ia" ? "La IA propuso estos títulos. Cámbialos como quieras." : `No se usó la IA: ${r.motivo ?? ""} Te dejamos títulos sugeridos.`);
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    } finally {
      setOcupado(null);
    }
  }

  // La primera vez, la IA propone títulos sola (si no hay propuesta guardada).
  useEffect(() => {
    if (!e || pedidoAuto.current) return;
    pedidoAuto.current = true;
    // Fuera del efecto (setTimeout): proponer() cambia estado. Sin limpiar: en modo estricto se cancelaría.
    if (!e.titulos && !e.opciones.length && !e.elegida) setTimeout(() => void proponer(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo una vez, cuando llegan los datos
  }, [e]);

  async function crear() {
    const validos = campos.map((t) => t.trim()).filter(Boolean);
    if (!validos.length) {
      setError("Escribe al menos un título.");
      return;
    }
    setOcupado("crear");
    setError(null);
    try {
      await postJson(`/api/proyectos/${proyectoId}/portada`, { accion: "crear", titulos: validos, escena: escenaSel, ...(e?.disenoPropio ? {} : { estilo: estiloSel }) });
      await recargar();
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    } finally {
      setOcupado(null);
    }
  }

  async function elegir(indice: number) {
    setOcupado("elegir");
    setError(null);
    try {
      await postJson(`/api/proyectos/${proyectoId}/portada`, { accion: "elegir", indice });
      await recargar();
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    } finally {
      setOcupado(null);
    }
  }

  if (!e) return null;

  return (
    <section className="tarjeta space-y-5 p-4" aria-labelledby="titulo-portada">
      <div>
        <h2 id="titulo-portada" className="font-medium">Portada del video</h2>
        <p className="text-sm text-tenue">La imagen que la gente ve antes de darle play. Hazla en tres pasos.</p>
      </div>

      {!e.herramienta && (
        <Aviso tipo="alerta">
          Falta la herramienta que arma las portadas. <a className="underline" href="/sistema">Instálala con un clic en Sistema</a> y vuelve aquí.
        </Aviso>
      )}

      {e.elegida && (
        <div className="flex flex-wrap items-start gap-4 rounded border border-emerald-700/50 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- archivo local servido por /api/archivos */}
          <img src={`${archivo(e.elegida.archivo)}?v=${encodeURIComponent(e.elegida.creada)}`} alt={`Portada elegida: ${e.elegida.titulo}`} className={vertical ? "h-56 rounded" : "w-72 rounded"} />
          <div className="space-y-2 text-sm">
            <p><span aria-hidden className="text-emerald-400">✓</span> <strong>Esta es la portada del video.</strong> Se usa al publicar en YouTube.</p>
            {!alDia(e.elegida.version) && <p className="text-amber-300">El video cambió desde que la hiciste: conviene crearla otra vez.</p>}
            <a className="boton inline-block" href={archivo(e.elegida.archivo, true)}>Descargar</a>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">1. Elige la imagen</h3>
        {e.escenas.length === 0 ? (
          <p className="text-sm text-tenue">Las imágenes aparecen cuando el video termine de prepararse.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Imagen de la portada">
            {e.escenas.map((s) => (
              <button
                key={s.escena}
                type="button"
                role="radio"
                aria-checked={s.escena === escenaSel}
                aria-label={`Escena ${s.escena + 1}`}
                onClick={() => setEscena(s.escena)}
                className={`relative shrink-0 overflow-hidden rounded border-2 ${s.escena === escenaSel ? "border-sky-400" : "border-transparent opacity-80 hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local */}
                <img src={s.miniatura} alt="" className={vertical ? "h-28" : "h-20"} loading="lazy" />
                <span className="absolute bottom-0 left-0 bg-black/70 px-1 text-xs">{s.escena + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">2. Elige los títulos (hasta 3, uno por portada)</h3>
          <button type="button" className="boton" disabled={!!ocupado} onClick={() => void proponer()}>
            {ocupado === "titulos" ? "Pensando títulos…" : "✨ Proponer otros con IA"}
          </button>
        </div>
        {nota && <p className="text-xs text-tenue">{nota}</p>}
        <div className="grid gap-2">
          {campos.map((t, i) => (
            <input
              key={i}
              className="campo"
              aria-label={`Título ${i + 1}`}
              placeholder={i === 0 ? "Título de la portada" : "Otro título (opcional)"}
              value={t}
              maxLength={90}
              onChange={(ev) => {
                const n = [...campos];
                n[i] = ev.target.value;
                setTitulos(n);
              }}
            />
          ))}
        </div>
        <p className="text-xs text-tenue">Los títulos cortos se leen mejor: menos de 50 letras es ideal.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">3. Elige el diseño</h3>
        {e.disenoPropio ? (
          <p className="text-sm text-tenue">Este canal usa su propio diseño de portada (se cambia en Plantillas).</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Diseño de la portada">
            {e.estilos.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === estiloSel}
                onClick={() => setEstilo(s.id)}
                title={s.descripcion}
                className={`rounded border px-3 py-2 text-left text-sm ${s.id === estiloSel ? "border-sky-400 bg-sky-400/10" : "border-borde"}`}
              >
                <span className="block font-medium">{s.nombre}</span>
                <span className="block text-xs text-tenue">{s.descripcion}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="boton boton-primario" disabled={!!ocupado || !e.herramienta || e.escenas.length === 0} onClick={() => void crear()}>
        {ocupado === "crear" ? "Creando portadas…" : "Crear portadas"}
      </button>
      {error && <Aviso tipo="error">{error}</Aviso>}

      {e.opciones.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Elige tu favorita</h3>
          <div className={`grid gap-3 ${vertical ? "grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
            {e.opciones.map((o, i) => {
              const esElegida = !!e.elegida && e.elegida.titulo === o.titulo && e.elegida.escena === o.escena && e.elegida.estilo === o.estilo;
              return (
                <figure key={o.archivo} className={`space-y-2 rounded border p-2 ${esElegida ? "border-emerald-500" : "border-borde"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- archivo local servido por /api/archivos */}
                  <img src={archivo(o.archivo)} alt={`Opción ${i + 1}: ${o.titulo}`} className={vertical ? "mx-auto max-h-96 rounded" : "w-full rounded"} />
                  {avisosDe(o).map((a) => <p key={a} className="text-xs text-amber-300">{a}</p>)}
                  {o.achicados.titulo && !o.desbordan.length && <p className="text-xs text-tenue">La letra se achicó un poco para que entre el título.</p>}
                  <button type="button" className={`boton w-full ${esElegida ? "" : "boton-primario"}`} disabled={!!ocupado || esElegida} onClick={() => void elegir(i)}>
                    {esElegida ? "✓ Elegida" : "Usar esta"}
                  </button>
                </figure>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

