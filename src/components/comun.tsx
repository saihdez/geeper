"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeHttp, traer } from "@/lib/conexion";
import { crearSondeo, type Sondeo } from "@/lib/sondeo";
import { ESTADOS, nombreEstado } from "@/lib/textos";

/**
 * A11-08: los pasos (Clips, Avatares) se marcan igual que en Anuncios: el actual en negrita con su número en
 * celeste, los hechos con ✓ en verde. Sin el borde celeste, que es de las opciones elegidas.
 */
export const CLASE_PASO = { actual: "font-semibold text-white", hecho: "text-tenue hover:text-white", pendiente: "text-tenue opacity-60" } as const;
export const CIRCULO_PASO = { actual: "bg-cyan-500 text-black", hecho: "bg-emerald-700 text-white", pendiente: "bg-slate-800 text-slate-400" } as const;

/**
 * GPU-09: lo que se muestra junto al botón mientras se espera a la IA local, que puede estar cargando el
 * modelo. Copia de AVISO_DESPERTANDO de @/lib/llm-local (ése es del servidor: no se importa aquí).
 */
export const AVISO_DESPERTANDO = "La IA está despertando: puede tardar hasta 3 min.";

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

/**
 * Trae datos y los refresca `ms` después de cada respuesta (o lo que diga `ms(datos)`, para ir más
 * lento en reposo). No pide con la pestaña oculta, no repinta si nada cambió y descarta respuestas
 * viejas (ver lib/sondeo.ts).
 */
export function useSondeo<T>(url: string, ms: number | ((datos: T | null) => number) = 3000) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalo = useRef(ms);
  const sondeo = useRef<Sondeo | null>(null);
  useEffect(() => {
    intervalo.current = ms;
  });
  useEffect(() => {
    const s = crearSondeo<T>({
      url,
      intervalo: (d) => {
        const m = intervalo.current;
        return typeof m === "function" ? m(d) : m;
      },
      alDatos: setDatos,
      alError: setError,
    });
    sondeo.current = s;
    s.iniciar();
    return () => {
      s.detener();
      if (sondeo.current === s) sondeo.current = null;
    };
  }, [url]);
  // Si cambia un intervalo fijo (p. ej. un panel que se abre), la próxima consulta se reprograma.
  const fijo = typeof ms === "number" ? ms : null;
  useEffect(() => {
    if (fijo !== null) sondeo.current?.reprogramar();
  }, [fijo]);
  const recargar = useCallback(() => sondeo.current?.recargar() ?? Promise.resolve(), []);
  return { datos, error, recargar };
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

/** Nombres en palabras simples (sin «QC», «render» ni «ensamblado»): ver lib/textos.ts (UX-15). */
export const NOMBRES = ESTADOS;

export function Estado({ valor }: { valor: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[valor] ?? "bg-slate-700"}`}>
      {nombreEstado(valor)}
    </span>
  );
}

/** Barra de avance. `etiqueta` dice de qué es («Avance: instalando PhotoCraft») para el lector de pantalla. */
export function Barra({ valor, etiqueta = "Avance" }: { valor: number; etiqueta?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800" role="progressbar" aria-label={etiqueta} aria-valuenow={Math.round(valor * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.round(valor * 100)}%` }} />
    </div>
  );
}

/** Duraciones, números y fechas: una sola forma en toda la app (A11-11, ver lib/formato.ts). */
export { fecha, haceCuanto, hora, numero, segundos } from "@/lib/formato";

/** En Windows el servidor arma rutas con «\» (path.relative): se parten igual, si no el navegador vería
 *  un solo segmento y los archivos relativos de la página (p. ej. la vista previa) apuntarían a otra carpeta. */
export function archivo(rutaRelativaADatos: string, descargar = false) {
  return `/api/archivos/${rutaRelativaADatos.split(/[\\/]/).map(encodeURIComponent).join("/")}${descargar ? "?descargar" : ""}`;
}

export function Aviso({ tipo = "info", children }: { tipo?: "info" | "error" | "ok" | "alerta"; children: React.ReactNode }) {
  const c = { info: "border-sky-800 bg-sky-950/50", error: "border-red-800 bg-red-950/50", ok: "border-emerald-800 bg-emerald-950/50", alerta: "border-amber-700 bg-amber-950/50" }[tipo];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`} role={tipo === "error" ? "alert" : "status"}>{children}</div>;
}

/**
 * El motor (worker) no da señales. En la app de escritorio basta con cerrarla y abrirla; en desarrollo,
 * `pnpm run dev:up` enciende la web y el motor juntos (UX-15).
 */
export function MotorApagado({ escritorio }: { escritorio?: boolean }) {
  return (
    <Aviso tipo="alerta">
      <p className="font-medium">El motor de Geeper está apagado, así que nada avanza.</p>
      {escritorio
        ? <p className="mt-1">Cierra Geeper y ábrelo otra vez.</p>
        : <p className="mt-1">Cierra Geeper y ábrelo otra vez con <code>pnpm run dev:up</code> (enciende la web y el motor juntos).</p>}
    </Aviso>
  );
}

/** «Cargando…» igual en todas las pantallas, y anunciado al lector de pantalla. */
export function Cargando({ children = "Cargando…" }: { children?: React.ReactNode }) {
  return <p className="text-sm text-tenue" role="status">{children}</p>;
}
