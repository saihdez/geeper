"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorConexion, RECONECTANDO, mensajeHttp, traer } from "@/lib/conexion";

/** Pide JSON. Los errores salen en palabras simples: sin conexión, «ya no existe», o el texto del servidor. */
export async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await traer(url, init);
  const d = (await r.json().catch(() => ({}))) as T & { error?: unknown };
  if (!r.ok) throw new Error(mensajeHttp(r.status, d.error));
  return d;
}

export function postJson<T>(url: string, cuerpo: unknown): Promise<T> {
  return pedir<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
}

/** Trae datos y los refresca cada `ms` (más seguido si `rapido`). */
export function useSondeo<T>(url: string, ms = 3000) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  const cargar = useCallback(async () => {
    try {
      const d = await pedir<T>(url);
      if (vivo.current) {
        setDatos(d);
        setError(null);
      }
    } catch (e) {
      if (vivo.current) setError(e instanceof ErrorConexion ? RECONECTANDO : e instanceof Error ? e.message : String(e));
    }
  }, [url]);
  useEffect(() => {
    vivo.current = true;
    const primera = setTimeout(() => void cargar(), 0);
    const i = setInterval(() => void cargar(), ms);
    return () => {
      vivo.current = false;
      clearTimeout(primera);
      clearInterval(i);
    };
  }, [cargar, ms]);
  return { datos, error, recargar: cargar };
}

const COLORES: Record<string, string> = {
  pendiente: "bg-slate-700 text-slate-100",
  corriendo: "bg-sky-800 text-sky-100",
  hecho: "bg-emerald-800 text-emerald-100",
  fallido: "bg-red-900 text-red-100",
  interrumpido: "bg-amber-800 text-amber-100",
  cancelado: "bg-zinc-700 text-zinc-200",
  borrador: "bg-slate-700 text-slate-100",
  generando: "bg-sky-800 text-sky-100",
  ensamblado: "bg-indigo-800 text-indigo-100",
  qc: "bg-amber-800 text-amber-100",
  entregado: "bg-emerald-800 text-emerald-100",
  aprobado: "bg-emerald-800 text-emerald-100",
  rechazado: "bg-red-900 text-red-100",
  subiendo: "bg-sky-800 text-sky-100",
  procesando: "bg-indigo-800 text-indigo-100",
  publicada: "bg-emerald-800 text-emerald-100",
  fallida: "bg-red-900 text-red-100",
  cancelada: "bg-zinc-700 text-zinc-200",
  conectada: "bg-emerald-800 text-emerald-100",
  reconectar: "bg-amber-800 text-amber-100",
  desconectada: "bg-zinc-700 text-zinc-200",
  "en-revision": "bg-amber-800 text-amber-100",
  lista: "bg-emerald-800 text-emerald-100",
  activa: "bg-sky-800 text-sky-100",
  archivada: "bg-zinc-700 text-zinc-200",
};

const NOMBRES: Record<string, string> = {
  qc: "QC no aprobado",
  entregado: "Entregado",
  ensamblado: "Ensamblado",
  generando: "Generando",
  borrador: "Borrador",
  "en-revision": "En revisión",
  lista: "Lista para lanzar",
  activa: "Activa",
  archivada: "Archivada",
};

export function Estado({ valor }: { valor: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[valor] ?? "bg-slate-700"}`}>
      {NOMBRES[valor] ?? valor}
    </span>
  );
}

export function Barra({ valor }: { valor: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800" role="progressbar" aria-valuenow={Math.round(valor * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.round(valor * 100)}%` }} />
    </div>
  );
}

export function segundos(s: number | null | undefined) {
  if (s == null) return "—";
  return s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`;
}

/** En Windows el servidor arma rutas con «\» (path.relative): se parten igual, si no el navegador vería
 *  un solo segmento y los archivos relativos de la página (p. ej. la vista previa) apuntarían a otra carpeta. */
export function archivo(rutaRelativaADatos: string, descargar = false) {
  return `/api/archivos/${rutaRelativaADatos.split(/[\\/]/).map(encodeURIComponent).join("/")}${descargar ? "?descargar" : ""}`;
}

export function Aviso({ tipo = "info", children }: { tipo?: "info" | "error" | "ok" | "alerta"; children: React.ReactNode }) {
  const c = { info: "border-sky-800 bg-sky-950/50", error: "border-red-800 bg-red-950/50", ok: "border-emerald-800 bg-emerald-950/50", alerta: "border-amber-700 bg-amber-950/50" }[tipo];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`} role={tipo === "error" ? "alert" : "status"}>{children}</div>;
}
