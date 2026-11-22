"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Trabajo {
  id: string;
  tipo: string;
  nombre: string;
  estado: string;
  etapa: string;
  progreso: number;
  error: string | null;
  creado: string;
  iniciado: string | null;
  terminado: string | null;
  proyecto: { id: string; nombre: string } | null;
}
interface Datos { ahora: number; workerVivo: boolean; trabajos: Trabajo[] }

const CLAVE = "geeper.tareas.abierto";
const enCurso = (t: Trabajo) => t.estado === "pendiente" || t.estado === "corriendo";

function transcurrido(desde: string | null, ahora: number): string {
  if (!desde) return "";
  const s = Math.max(0, Math.round((ahora - new Date(desde).getTime()) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

function Fila({ t, ahora }: { t: Trabajo; ahora: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, t.progreso)) * 100);
  const fallo = t.estado === "fallido" || t.estado === "interrumpido";
  const hecho = t.estado === "hecho";
  const texto = t.estado === "pendiente" ? (t.etapa || "En la fila, esperando su turno")
    : fallo ? (t.error ?? "Falló")
    : hecho ? "Terminado"
    : t.estado === "cancelado" ? "Cancelado"
    : t.etapa || "Trabajando…";
  return (
    <li className="space-y-1 py-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{t.nombre}</span>
        {t.proyecto && <Link href={`/proyectos/${t.proyecto.id}`} className="min-w-0 truncate text-xs text-tenue underline hover:text-white">{t.proyecto.nombre}</Link>}
        <span className="ml-auto shrink-0 text-xs text-tenue">{enCurso(t) ? (t.estado === "corriendo" ? `${pct}%` : "") : ""}</span>
      </div>
      <p className={`line-clamp-2 text-xs ${fallo ? "text-red-300" : hecho ? "text-emerald-300" : "text-tenue"}`}>
        {fallo ? "✗ " : hecho ? "✓ " : ""}{texto}
        {t.estado === "corriendo" && <span className="text-tenue"> · {transcurrido(t.iniciado, ahora)}</span>}
      </p>
      {enCurso(t) && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800" role="progressbar" aria-label={t.nombre} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          {t.estado === "corriendo"
            ? <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
            : <div className="h-full w-1/4 animate-pulse bg-slate-600" />}
        </div>
      )}
    </li>
  );
}

/**
 * Panel flotante (abajo a la derecha, en todas las páginas) con las tareas en curso y su avance. Aparece
 * solo cuando hay algo trabajando o que acaba de terminar; se puede achicar a una pastilla. Consulta cada
 * 2 s mientras hay tareas y cada 10 s si no, y nada mientras la pestaña está oculta.
 */
export function TrabajosFlotantes() {
  const [datos, setDatos] = useState<Datos | null>(null);
  // Lo que se eligió la última vez (no se dibuja nada hasta que llegan datos: no choca con el servidor).
  const [abierto, setAbierto] = useState(() => {
    try {
      return typeof window === "undefined" || localStorage.getItem(CLAVE) !== "0";
    } catch {
      return true;
    }
  });
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let hay = false;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/trabajos/activos", { cache: "no-store" });
          if (r.ok) {
            const d = (await r.json()) as Datos;
            if (!vivo.current) return;
            setDatos(d);
            hay = d.trabajos.length > 0;
          }
        } catch { /* el servidor se está reiniciando: se reintenta */ }
      }
      if (vivo.current) t = setTimeout(() => void tick(), hay ? 2000 : 10_000);
    };
    void tick();
    const alVolver = () => { if (document.visibilityState === "visible") { clearTimeout(t); void tick(); } };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo.current = false;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  const cambiar = (v: boolean) => {
    setAbierto(v);
    try { localStorage.setItem(CLAVE, v ? "1" : "0"); } catch { /* sin almacenamiento */ }
  };

  const lista = datos?.trabajos ?? [];
  if (!lista.length) return null;
  const activos = lista.filter(enCurso);
  const corriendo = activos.filter((t) => t.estado === "corriendo");
  const promedio = corriendo.length ? corriendo.reduce((s, t) => s + Math.min(1, Math.max(0, t.progreso)), 0) / corriendo.length : 0;
  const titulo = activos.length
    ? `${activos.length} tarea${activos.length === 1 ? "" : "s"} en curso`
    : "Tareas terminadas";

  return (
    <aside aria-label="Tareas en curso" className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-borde bg-[#0f131a]/95 shadow-2xl backdrop-blur">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" aria-expanded={abierto} onClick={() => cambiar(!abierto)}>
        {activos.length > 0 && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" aria-hidden />}
        <span className="font-medium">{titulo}</span>
        {!abierto && corriendo.length > 0 && <span className="text-xs text-tenue">{Math.round(promedio * 100)}%</span>}
        <span className="ml-auto text-xs text-tenue">{abierto ? "▾ achicar" : "▴ ver"}</span>
      </button>
      {!abierto && corriendo.length > 0 && (
        <div className="mx-3 mb-2 h-1 overflow-hidden rounded bg-slate-800"><div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.max(2, Math.round(promedio * 100))}%` }} /></div>
      )}
      {abierto && (
        <div className="border-t border-borde px-3">
          {datos && !datos.workerVivo && activos.length > 0 && (
            <p className="pt-2 text-xs text-amber-300">El procesador de tareas no responde: si no avanza en un minuto, cierra y vuelve a abrir Geeper.</p>
          )}
          <ul className="max-h-[50vh] divide-y divide-borde overflow-y-auto">
            {lista.map((t) => <Fila key={t.id} t={t} ahora={datos!.ahora} />)}
          </ul>
          <div className="py-2 text-right text-xs"><Link href="/trabajos" className="text-tenue underline hover:text-white">Ver todas en Trabajos</Link></div>
        </div>
      )}
    </aside>
  );
}
