"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
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

const TIPOS: Record<string, string> = {
  "mpt.generar": "Generar con MPT",
  "proyecto.importar": "Importar y alinear",
  "voz.regenerar": "Regenerar voz",
  "voz.disenar": "Diseñar una voz",
  "plano.generar": "Animar escena",
  "avatar.proponer": "Crear avatar",
  "avatar.retocar": "Retocar avatar",
  "presentador.generar": "Presentador (avatar que habla)",
  "avatar.actuar": "Tu avatar en una escena",
  "avatar.streamer": "Tu avatar como streamer",
  "avatar.escenas": "Tu avatar en el video nuevo",
  "escena.rehacer": "Rehacer la toma",
  "workflow.correr": "Workflow de ComfyUI",
  "render.entregar": "Render y QC",
  "escenas.animar": "Animando las escenas",
  "demo.crear": "Demo de una página web",
};

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
              {abierto === t.id && <Log id={t.id} vivo={vivo} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
