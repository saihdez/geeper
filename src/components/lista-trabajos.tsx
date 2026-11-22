"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { etapaSimple, explicarError, nombreTipo } from "@/lib/textos";
import { Aviso, Barra, Estado, postJson, segundos, useSondeo } from "./comun";

interface Trabajo {
  id: string;
  tipo: string;
  motor: string;
  estado: string;
  etapa: string;
  progreso: number;
  error: string | null;
  intentos: number;
  usaGpu: boolean;
  creado: string;
  iniciado: string | null;
  terminado: string | null;
  proyecto: { nombre: string; slug: string } | null;
  proyectoId: string | null;
}

function duracion(t: Trabajo, ahora: number) {
  if (!t.iniciado) return "";
  const fin = t.terminado ? new Date(t.terminado).getTime() : ahora;
  return segundos(Math.max(0, (fin - new Date(t.iniciado).getTime()) / 1000));
}

function Log({ id, vivo }: { id: string; vivo: boolean }) {
  const [texto, setTexto] = useState("Cargando…");
  useEffect(() => {
    let activo = true;
    const cargar = () =>
      fetch(`/api/trabajos/${id}/log?lineas=300`).then((r) => r.text()).then((t) => activo && setTexto(t)).catch(() => undefined);
    void cargar();
    const i = vivo ? setInterval(cargar, 2000) : undefined;
    return () => {
      activo = false;
      if (i) clearInterval(i);
    };
  }, [id, vivo]);
  return <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-black/60 p-3 text-xs leading-relaxed text-slate-300">{texto}</pre>;
}

/** UX-14: el error en palabras simples; el texto tal cual, plegado, para quien dé soporte. */
export function ErrorTrabajo({ error }: { error: string }) {
  const { simple, detalle } = explicarError(error);
  return (
    <div className="mt-2 text-sm text-red-200">
      <p>{simple}</p>
      {detalle && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-tenue">Ver detalle técnico</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-black/60 p-2 text-red-300">{detalle}</pre>
        </details>
      )}
    </div>
  );
}

export function ListaTrabajos({ proyectoId }: { proyectoId?: string }) {
  const { datos, error, recargar } = useSondeo<{ trabajos: Trabajo[]; workerVivo: boolean; ahora: number }>(
    `/api/trabajos${proyectoId ? `?proyecto=${proyectoId}` : ""}`,
    2000,
  );
  const [abierto, setAbierto] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const workerVivo = datos?.workerVivo;

  async function accion(id: string, a: "relanzar" | "cancelar") {
    setFallo(null);
    try {
      await postJson(`/api/trabajos/${id}`, { accion: a });
      await recargar();
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3">
      {datos && !workerVivo && (
        <Aviso tipo="alerta">
          <p className="font-medium">El motor de Geeper está apagado, así que nada avanza.</p>
          <p className="mt-1">Cierra Geeper y ábrelo otra vez con <code>pnpm run dev:up</code> (enciende la web y el motor juntos).</p>
        </Aviso>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {fallo && <Aviso tipo="error">{fallo}</Aviso>}
      {datos?.trabajos.length === 0 && <p className="text-sm text-tenue">Todavía no hay nada: aquí verás cada cosa que Geeper haga por ti.</p>}
      <ul className="space-y-2">
        {datos?.trabajos.map((t) => {
          const vivo = t.estado === "corriendo" || t.estado === "pendiente";
          return (
            <li key={t.id} className="tarjeta p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Estado valor={t.estado} />
                <span className="font-medium">{nombreTipo(t.tipo)}</span>
                {!proyectoId && t.proyecto && (
                  <Link href={`/proyectos/${t.proyectoId}`} className="truncate text-sm text-acento hover:underline">{t.proyecto.nombre}</Link>
                )}
                <span className="text-xs text-tenue">{duracion(t, datos.ahora)}</span>
                <span className="ml-auto flex gap-2">
                  {["fallido", "interrumpido", "cancelado"].includes(t.estado) && (
                    <button type="button" className="boton" onClick={() => void accion(t.id, "relanzar")}>Volver a intentar</button>
                  )}
                  {vivo && <button type="button" className="boton boton-peligro" onClick={() => void accion(t.id, "cancelar")}>Cancelar</button>}
                  <button type="button" className="boton" aria-expanded={abierto === t.id} onClick={() => setAbierto(abierto === t.id ? null : t.id)}>
                    {abierto === t.id ? "Ocultar el registro" : "Ver el registro"}
                  </button>
                </span>
              </div>
              {t.estado === "corriendo" && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-sky-200">{etapaSimple(t.etapa, t.estado)}</p>
                  <Barra valor={t.progreso} etiqueta={`Avance: ${nombreTipo(t.tipo)}`} />
                </div>
              )}
              {t.error && <ErrorTrabajo error={t.error} />}
              {abierto === t.id && <Log id={t.id} vivo={vivo} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
