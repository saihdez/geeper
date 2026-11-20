"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Aviso, Barra, Estado, postJson, useSondeo } from "./comun";

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

const TIPOS: Record<string, string> = {
  "mpt.generar": "Generar con MPT",
  "proyecto.importar": "Importar y alinear",
  "voz.regenerar": "Regenerar voz",
  "render.entregar": "Render y QC",
};

function duracion(t: Trabajo, ahora: number) {
  if (!t.iniciado) return "";
  const fin = t.terminado ? new Date(t.terminado).getTime() : ahora;
  const s = Math.max(0, (fin - new Date(t.iniciado).getTime()) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`;
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

interface FilaPaso {
  nombre: string;
  nivel: number;
  duracionMs: number;
  estado: "ok" | "error" | "sin-estado";
  detalle: string;
}

function segundos(ms: number) {
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** Cuánto tardó cada paso (de las trazas). No aparece si el trabajo no dejó trazas. */
function Pasos({ id, vivo }: { id: string; vivo: boolean }) {
  const [filas, setFilas] = useState<FilaPaso[] | null>(null);
  useEffect(() => {
    let activo = true;
    const cargar = () =>
      fetch(`/api/trabajos/${id}/pasos`).then((r) => r.json() as Promise<{ pasos: FilaPaso[] }>).then((d) => activo && setFilas(d.pasos)).catch(() => undefined);
    void cargar();
    const i = vivo ? setInterval(cargar, 4000) : undefined;
    return () => {
      activo = false;
      if (i) clearInterval(i);
    };
  }, [id, vivo]);
  if (!filas?.length) return null;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="mb-1 text-left text-tenue">Pasos</caption>
        <thead>
          <tr className="text-tenue">
            <th scope="col" className="py-1 pr-3 font-normal">Paso</th>
            <th scope="col" className="py-1 pr-3 text-right font-normal">Tiempo</th>
            <th scope="col" className="py-1 font-normal">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="py-1 pr-3" style={{ paddingLeft: `${f.nivel * 1}rem` }}>
                <span className={f.estado === "error" ? "text-red-300" : undefined}>{f.estado === "error" ? "✗ " : ""}{f.nombre}</span>
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">{segundos(f.duracionMs)}</td>
              <td className="py-1 text-tenue break-words">{f.detalle}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <Aviso tipo="alerta">El worker no está corriendo: los trabajos no avanzan. Arráncalo con <code>pnpm run dev:up</code> o <code>pnpm run worker</code>.</Aviso>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {fallo && <Aviso tipo="error">{fallo}</Aviso>}
      {datos?.trabajos.length === 0 && <p className="text-sm text-tenue">Sin trabajos.</p>}
      <ul className="space-y-2">
        {datos?.trabajos.map((t) => {
          const vivo = t.estado === "corriendo" || t.estado === "pendiente";
          return (
            <li key={t.id} className="tarjeta p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Estado valor={t.estado} />
                <span className="font-medium">{TIPOS[t.tipo] ?? t.tipo}</span>
                {!proyectoId && t.proyecto && (
                  <Link href={`/proyectos/${t.proyectoId}`} className="truncate text-sm text-acento hover:underline">{t.proyecto.nombre}</Link>
                )}
                <span className="text-xs text-tenue">{t.usaGpu ? "GPU · " : ""}{duracion(t, datos.ahora)}</span>
                <span className="ml-auto flex gap-2">
                  {["fallido", "interrumpido", "cancelado"].includes(t.estado) && (
                    <button type="button" className="boton" onClick={() => void accion(t.id, "relanzar")}>Relanzar</button>
                  )}
                  {vivo && <button type="button" className="boton boton-peligro" onClick={() => void accion(t.id, "cancelar")}>Cancelar</button>}
                  <button type="button" className="boton" aria-expanded={abierto === t.id} onClick={() => setAbierto(abierto === t.id ? null : t.id)}>
                    {abierto === t.id ? "Ocultar log" : "Log"}
                  </button>
                </span>
              </div>
              {t.estado === "corriendo" && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-sky-200">{t.etapa}</p>
                  <Barra valor={t.progreso} />
                </div>
              )}
              {t.error && <p className="mt-2 whitespace-pre-wrap text-xs text-red-300">{t.error.split("\n").slice(0, 4).join("\n")}</p>}
              {abierto === t.id && (
                <>
                  <Pasos id={t.id} vivo={vivo} />
                  <Log id={t.id} vivo={vivo} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
