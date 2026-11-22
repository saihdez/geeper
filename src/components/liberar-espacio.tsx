"use client";
/**
 * «Liberar espacio» en Sistema (UX-33): cuánto ocupa cada video y qué se puede borrar. Nada se borra solo:
 * cada botón pregunta antes, con cuánto se libera y que no se puede deshacer.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Espacio, QueLiberar } from "@/lib/liberar-espacio";
import { Aviso, Cargando, pedir, postJson } from "./comun";

/** Bytes en palabras: «1,4 GB», «320 MB», «12 KB». */
export function bytesLegibles(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("es", { maximumFractionDigits: 1 })} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6).toLocaleString("es")} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("es")} KB`;
  return `${n} bytes`;
}

/** Qué es cada cosa que se puede borrar, en palabras simples. */
export const QUE_ES: Record<QueLiberar, { titulo: string; detalle: (dias: number) => string; uno: string; varios: string }> = {
  renders: {
    titulo: "Videos viejos",
    detalle: (d) => `Videos que hiciste hace más de ${d} días y que ya cambiaste. Siempre se guardan el último de cada formato, el último que pasó la revisión y los que publicaste.`,
    uno: "video viejo",
    varios: "videos viejos",
  },
  crudos: {
    titulo: "Archivos de trabajo",
    detalle: (d) => `Copias intermedias que se usan para armar el video, de hace más de ${d} días. Si vuelves a crear el video, se rehacen solas.`,
    uno: "archivo de trabajo",
    varios: "archivos de trabajo",
  },
  papelera: {
    titulo: "Papelera",
    detalle: (d) => `Videos que eliminaste hace más de ${d} días. Lo que lleva menos tiempo se queda, por si lo quieres recuperar.`,
    uno: "video de la papelera",
    varios: "videos de la papelera",
  },
};

/** La pregunta antes de borrar: nombra cuánto y avisa que no tiene vuelta atrás. */
export function preguntaBorrar(que: QueLiberar, cuantos: number, bytes: number): string {
  const q = QUE_ES[que];
  return `Vas a borrar ${cuantos === 1 ? `1 ${q.uno}` : `${cuantos} ${q.varios}`} (${bytesLegibles(bytes)}). Esto no se puede deshacer. ¿Seguir?`;
}

export function LiberarEspacio() {
  const [datos, setDatos] = useState<Espacio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<QueLiberar | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedir<Espacio>("/api/sistema/espacio"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  async function borrar(que: QueLiberar) {
    const b = datos?.borrable[que];
    if (!b || b.cuantos === 0) return;
    if (!confirm(preguntaBorrar(que, b.cuantos, b.bytes))) return;
    setOcupado(que);
    setHecho(null);
    try {
      const r = await postJson<{ cuantos: number; bytes: number }>("/api/sistema/espacio", { que, confirmo: true });
      setHecho(`Listo: se liberaron ${bytesLegibles(r.bytes)}.`);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="liberar-espacio">
      <h2 id="liberar-espacio" className="font-medium">Liberar espacio</h2>
      <p className="text-sm text-tenue">Cuánto ocupa cada video en el disco. Mirar no borra nada: sólo se borra si tocas un botón y dices que sí.</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {hecho && <Aviso tipo="ok">{hecho}</Aviso>}
      {!datos && !error && <Cargando>Midiendo cuánto ocupa cada cosa…</Cargando>}
      {datos && (
        <>
          <ul className="space-y-2">
            {(Object.keys(QUE_ES) as QueLiberar[]).map((que) => {
              const b = datos.borrable[que];
              return (
                <li key={que} className="flex flex-wrap items-center gap-3 rounded-md border border-borde p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{QUE_ES[que].titulo}: {b.cuantos === 0 ? "nada para borrar" : bytesLegibles(b.bytes)}</p>
                    <p className="text-xs text-tenue">{QUE_ES[que].detalle(datos.dias)}</p>
                  </div>
                  <button type="button" className="boton" disabled={b.cuantos === 0 || ocupado !== null} onClick={() => void borrar(que)}>
                    {ocupado === que ? "Borrando…" : "Borrar"}
                  </button>
                </li>
              );
            })}
          </ul>
          {datos.proyectos.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-tenue hover:text-inherit">Cuánto ocupa cada video</summary>
              <ul className="mt-2 space-y-1">
                {datos.proyectos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-2">
                    <Link className="underline" href={`/proyectos/${p.id}`}>{p.nombre}</Link>
                    <span className="tabular-nums">{bytesLegibles(p.total)}</span>
                    <span className="text-xs text-tenue">(videos terminados {bytesLegibles(p.videos)} · archivos de trabajo {bytesLegibles(p.crudos)})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-tenue">Para quitar un video entero, elimínalo desde «Mis videos»: va a la papelera.</p>
            </details>
          )}
          {datos.papelera.elementos.length > 0 && (
            <p className="text-xs text-tenue">En la papelera hay {datos.papelera.elementos.length} {datos.papelera.elementos.length === 1 ? "video" : "videos"} ({bytesLegibles(datos.papelera.total)}).</p>
          )}
        </>
      )}
    </section>
  );
}
