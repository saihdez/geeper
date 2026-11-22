"use client";
import { AvisoPrivados } from "./aviso-privados";
import { useCallback, useEffect, useRef, useState } from "react";
import { Aviso, pedir } from "./comun";
import { InstalarPhotocraft } from "./instalar-photocraft";
import { InstalarHerramienta } from "./instalar-herramienta";
import { InstalarWan2gp } from "./instalar-wan2gp";
import { Novedades } from "./novedades";
import { PrepararEstudio } from "./preparar-estudio";

interface Chequeo { nombre: string; ok: boolean; aviso?: boolean; detalle: string; arreglo?: string }

interface Revision { chequeos: Chequeo[]; revisado: string }

/** Revisa al entrar y con «Volver a revisar» (sin repetir solo: cada revisión lanza varios programas). */
function useRevision() {
  const [datos, setDatos] = useState<Revision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);
  const turno = useRef(0);
  const revisar = useCallback(async (forzar: boolean) => {
    const mio = ++turno.current;
    setRevisando(true);
    try {
      const d = await pedir<Revision>(`/api/sistema${forzar ? "?forzar" : ""}`);
      if (turno.current === mio) {
        setDatos(d);
        setError(null);
      }
    } catch (e) {
      if (turno.current === mio) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (turno.current === mio) setRevisando(false);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void revisar(false), 0);
    const contador = turno; // al salir, cualquier respuesta pendiente queda descartada
    return () => {
      clearTimeout(t);
      contador.current++;
    };
  }, [revisar]);
  return { datos, error, revisando, recargar: () => revisar(true) };
}

/** Estado de un chequeo con signo y en palabras: el signo solo es mudo para el lector de pantalla. */
export function estadoChequeo(c: Pick<Chequeo, "ok" | "aviso">): { signo: string; texto: string; clase: string } {
  if (c.ok) return { signo: "✓", texto: "Listo", clase: "text-emerald-400" };
  if (c.aviso) return { signo: "!", texto: "Con aviso", clase: "text-amber-300" };
  return { signo: "✗", texto: "Falta o falla", clase: "text-red-400" };
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

export function Sistema() {
  const { datos, error, revisando, recargar } = useRevision();
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold">Sistema</h1>
      <p className="text-sm text-tenue">Revisa qué programas están instalados y si funcionan. Mirar no cambia nada; sólo cambian cosas los botones de instalar o arreglar.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="boton" disabled={revisando} onClick={() => void recargar()}>
          {revisando ? "Revisando…" : "Volver a revisar"}
        </button>
        {datos && <span className="text-xs text-tenue" role="status">Revisado a las {hora(datos.revisado)}</span>}
      </div>
      <PrepararEstudio alTerminar={() => void recargar()} />
      <AvisoPrivados alCambiar={() => void recargar()} />
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!datos && !error && <p className="text-tenue">Revisando… puede tardar unos segundos.</p>}
      <ul className="space-y-2">
        {datos?.chequeos.map((c) => {
          const e = estadoChequeo(c);
          return (
            <li key={c.nombre} id={c.nombre.startsWith("Wan2GP") ? "wan2gp" : undefined} className="tarjeta scroll-mt-4 p-3 text-sm [overflow-wrap:anywhere]">
              <span aria-hidden className={e.clase}>{e.signo}</span> <span className="sr-only">{e.texto}:</span>{" "}
              <span className="font-medium">{c.nombre}</span>: <span className="text-tenue">{c.detalle}</span>
              {c.arreglo && (!c.ok || c.aviso) && <p className="mt-1 font-mono text-xs text-amber-200">→ {c.arreglo}</p>}
              {c.nombre.startsWith("PhotoCraft") && !c.ok && <InstalarPhotocraft />}
              {c.nombre.startsWith("Wan2GP") && !c.ok && <InstalarWan2gp alTerminar={() => void recargar()} />}
              {c.nombre.startsWith("VectorCraft") && !c.ok && (
                <InstalarHerramienta api="/api/sistema/vectorcraft" paraQue="Sirve para usar logos de Illustrator, PDF, EPS o Affinity (los convierte a SVG nítido) y para vectorizar un logo PNG. Es gratuita y de código abierto; ocupa unos 160 MB." />
              )}
            </li>
          );
        })}
      </ul>
      <div className="pt-4">
        <Novedades />
      </div>
    </section>
  );
}
