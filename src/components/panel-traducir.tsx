"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Aviso, AvisoTarjeta, LineaFalta, faltanConGuardar, postJson, useGuardeAntes } from "./comun";

const IDIOMAS = [
  { id: "es", nombre: "Español", ejemplo: "Los faros todavía guían a los barcos…" },
  { id: "en", nombre: "Inglés", ejemplo: "Lighthouses still guide ships…" },
  { id: "pt", nombre: "Portugués (Brasil)", ejemplo: "Os faróis ainda guiam os navios…" },
  { id: "fr", nombre: "Francés", ejemplo: "Les phares guident encore les navires…" },
  { id: "it", nombre: "Italiano", ejemplo: "I fari guidano ancora le navi…" },
] as const;

/**
 * «Hacer una versión en otro idioma»: crea una copia traducida (el original no cambia) y lleva a ella
 * para ver el avance. Pensado para quien no sabe de video: un idioma, un botón, qué va a pasar y cuánto tarda.
 */
export function PanelTraducir({ proyectoId, idiomaActual, ocupado }: { proyectoId: string; idiomaActual: string; ocupado: boolean }) {
  const router = useRouter();
  const opciones = IDIOMAS.filter((x) => x.id !== idiomaActual);
  const [idioma, setIdioma] = useState<string>(opciones[0]?.id ?? "en");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elegido = IDIOMAS.find((x) => x.id === idioma)!;
  const guarde = useGuardeAntes();
  const faltaGuardar = faltanConGuardar(guarde);

  async function crear() {
    setEnviando(true);
    setError(null);
    try {
      const r = await postJson<{ proyecto: { id: string } }>(`/api/proyectos/${proyectoId}/traducir`, { idioma });
      router.push(`/proyectos/${r.proyecto.id}`);
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="titulo-traducir">
      <div>
        <h2 id="titulo-traducir" className="font-medium">Hacer una versión en otro idioma</h2>
        <p className="text-sm text-tenue">
          Geeper traduce lo que se dice, lo graba con una voz nueva en ese idioma, acomoda los subtítulos y lo renderiza.
          Las imágenes y la música son las mismas. <strong>Este video no cambia</strong>: la traducción queda como un proyecto aparte.
        </p>
      </div>
      <fieldset>
        <legend className="etiqueta">¿A qué idioma?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {opciones.map((x) => (
            <label key={x.id} className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 ${idioma === x.id ? "border-sky-500 bg-sky-950/40" : "border-borde hover:bg-white/5"}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name="idioma-traducir" value={x.id} checked={idioma === x.id} onChange={() => setIdioma(x.id)} disabled={enviando} />
                <span className="font-medium">{x.nombre}</span>
              </span>
              <span className="pl-6 text-xs italic text-tenue">{x.ejemplo}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <AvisoTarjeta g={guarde}>
        No tienes que hacer nada mientras tanto. La traducción la hace la IA de esta computadora: si la tarjeta de video está
        ocupada con otro video, espera su turno. La voz tendrá el mismo tipo (mujer u hombre) que la original.
      </AvisoTarjeta>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="space-y-1">
        <button type="button" className="boton boton-primario" disabled={ocupado || enviando || faltaGuardar.length > 0}
          aria-describedby={faltaGuardar.length ? guarde.idFalta : undefined} onClick={() => void crear()}>
          {enviando ? "Creando la versión…" : `Crear versión en ${elegido.nombre.split(" ")[0]!.toLowerCase()}`}
        </button>
        <LineaFalta id={guarde.idFalta} faltan={faltaGuardar} />
      </div>
    </section>
  );
}

export interface AjusteV {
  escena: string;
  acciones: ("acortada" | "lento" | "repite")[];
  velocidad?: number;
}
export interface InformeTraduccionV {
  de: { id: string; nombre: string };
  idioma: string;
  ajustes: AjusteV[];
  sinTraducir: string[];
}

function explicar(a: AjusteV): string {
  const partes: string[] = [];
  if (a.acciones.includes("acortada")) partes.push("la frase traducida era muy larga y se dijo más corta: escúchala para confirmar que dice lo mismo");
  if (a.acciones.includes("repite")) partes.push("aun así la voz dura más que el video de la escena, así que el video vuelve a empezar: cámbialo por otro clip o recorta palabras");
  else if (a.acciones.includes("lento")) partes.push(`el video va un poco más lento (${String(a.velocidad ?? "")}×) para que alcance a cubrir la voz`);
  const t = partes.join("; ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

/** Lo que hizo la traducción y qué conviene revisar, en palabras simples. */
export function InformeTraduccion({ informe, escenas }: { informe: InformeTraduccionV; escenas: { id: string; numero: number }[] }) {
  const nombre = IDIOMAS.find((x) => x.id === informe.idioma)?.nombre.toLowerCase() ?? informe.idioma;
  const numero = (id: string) => escenas.find((e) => e.id === id)?.numero;
  const revisar = informe.ajustes.filter((a) => a.acciones.includes("acortada") || a.acciones.includes("repite"));
  const lentas = informe.ajustes.filter((a) => !revisar.includes(a));
  return (
    <Aviso tipo={revisar.length || informe.sinTraducir.length ? "alerta" : "ok"}>
      <p>
        Ésta es la versión en {nombre} de <a className="underline" href={`/proyectos/${informe.de.id}`}>«{informe.de.nombre}»</a>.
        La voz y los subtítulos son nuevos; las imágenes y la música, las del original.
        {!revisar.length && !informe.sinTraducir.length && " Todo entró en su tiempo: mírala una vez antes de publicar."}
      </p>
      {(revisar.length > 0 || lentas.length > 0) && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {[...revisar, ...lentas].map((a) => (
            <li key={a.escena}>
              <a className="underline" href={`#escena-${a.escena}`}>Escena {numero(a.escena) ?? a.escena}</a>: {explicar(a)}
            </li>
          ))}
        </ul>
      )}
      {informe.sinTraducir.length > 0 && (
        <p className="mt-2">
          No se pudieron traducir estos textos en pantalla y quedaron en español: {informe.sinTraducir.map((t) => `«${t}»`).join(", ")}.
          Edítalos en «Textos en pantalla».
        </p>
      )}
    </Aviso>
  );
}
