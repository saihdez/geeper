"use client";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { mensajeHttp, traer } from "@/lib/conexion";
import type { FiltroAviso } from "@/lib/eventos-avisos";
import { canalDeLaPagina } from "@/lib/eventos-cliente";
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
 *
 * `avisos` (WEB-13): los cambios que le tocan («trabajos», «proyecto:<id>», «motor»…, ver
 * lib/eventos-avisos.ts). Con ellos, mientras el canal de avisos esté abierto pide sólo cuando llega uno
 * (y un respaldo cada minuto); si el canal se corta, vuelve a pedir cada `ms`. Sólo para datos que salen
 * de la base: lo que se lee de otro lado (una instalación en curso) no avisa.
 */
export function useSondeo<T>(url: string, ms: number | ((datos: T | null) => number) = 3000, avisos?: readonly FiltroAviso[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalo = useRef(ms);
  const sondeo = useRef<Sondeo | null>(null);
  useEffect(() => {
    intervalo.current = ms;
  });
  const claveAvisos = avisos?.join(" ") ?? "";
  useEffect(() => {
    const filtros = claveAvisos ? claveAvisos.split(" ") : [];
    const s = crearSondeo<T>({
      url,
      avisos: filtros.length ? { canal: canalDeLaPagina(), filtros } : null,
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
  }, [url, claveAvisos]);
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

/**
 * UX-09: el aviso antes de lo que usa toda la tarjeta de video (crear un video, animar, avatares, el
 * presentador, recetas, sonidos nuevos…). La PC del dueño se ha reiniciado sola con la tarjeta a tope: se
 * pide guardar antes, con las mismas palabras en todas las pantallas.
 */
export const AVISO_TARJETA = "Esto usa toda la tarjeta de video unos minutos. A veces la computadora se reinicia sola: guarda antes lo que tengas abierto.";
export const YA_GUARDE = "Ya guardé lo que tenía abierto";
/** Lo que va en «Para continuar falta: …» mientras la casilla está sin marcar. */
export const FALTA_GUARDAR = `marcar «${YA_GUARDE}»`;
const CLAVE_GUARDE = "geeper:ya-guarde";

// Marcada una vez, vale para toda la pestaña (sessionStorage) y para las otras acciones de tarjeta de la
// misma sesión, sin volver a pedirla. Si el navegador no deja guardar, se recuerda mientras la página viva.
let guardeEnMemoria = false;
const oyentesGuarde = new Set<() => void>();

export function leerGuarde(): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE_GUARDE) === "1" || guardeEnMemoria;
  } catch {
    return guardeEnMemoria;
  }
}

export function escribirGuarde(v: boolean) {
  guardeEnMemoria = v;
  try {
    if (v) window.sessionStorage.setItem(CLAVE_GUARDE, "1");
    else window.sessionStorage.removeItem(CLAVE_GUARDE);
  } catch {
    /* sin sessionStorage: queda en memoria */
  }
  for (const o of oyentesGuarde) o();
}

function suscribirGuarde(o: () => void) {
  oyentesGuarde.add(o);
  return () => {
    oyentesGuarde.delete(o);
  };
}

export interface GuardeAntes {
  /** Marcó «Ya guardé lo que tenía abierto» (en esta pestaña). */
  guardado: boolean;
  marcar: (v: boolean) => void;
  /** id del texto del aviso (lo nombra la casilla). */
  idAviso: string;
  /** id de la línea «Para continuar falta: …» (la nombra el botón con aria-describedby). */
  idFalta: string;
}

/** Estado de la casilla «Ya guardé…»: el botón de la acción queda apagado hasta que `guardado` sea true. */
export function useGuardeAntes(): GuardeAntes {
  const guardado = useSyncExternalStore(suscribirGuarde, leerGuarde, () => false);
  const base = useId();
  return { guardado, marcar: escribirGuarde, idAviso: `${base}-aviso-tarjeta`, idFalta: `${base}-falta` };
}

/** El aviso y la casilla. Va encima del botón de la acción. */
export function AvisoTarjeta({ g, children }: { g: GuardeAntes; children?: React.ReactNode }) {
  return (
    <Aviso tipo="alerta">
      <p id={g.idAviso} className="font-medium">{AVISO_TARJETA}</p>
      {children && <div className="mt-1">{children}</div>}
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={g.guardado} onChange={(e) => g.marcar(e.target.checked)} aria-describedby={g.idAviso} />
        {YA_GUARDE}
      </label>
    </Aviso>
  );
}

/**
 * «Volver a intentar» de un trabajo. Si usa la tarjeta y todavía no se marcó «Ya guardé…» en esta
 * pestaña, el primer clic muestra el aviso con la casilla; el reintento queda apagado hasta marcarla.
 */
export function BotonReintentar({ usaGpu, onClick, disabled, className = "boton" }: { usaGpu?: boolean; onClick: () => void; disabled?: boolean; className?: string }) {
  const g = useGuardeAntes();
  const [pidiendo, setPidiendo] = useState(false);
  if (!usaGpu || (g.guardado && !pidiendo)) {
    return <button type="button" className={className} disabled={disabled} onClick={onClick}>Volver a intentar</button>;
  }
  if (!pidiendo) {
    return <button type="button" className={className} disabled={disabled} aria-expanded={false} onClick={() => setPidiendo(true)}>Volver a intentar</button>;
  }
  const faltan = faltanConGuardar(g);
  return (
    <div className="w-full basis-full space-y-2">
      <AvisoTarjeta g={g} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={className} disabled={disabled || !g.guardado}
          aria-describedby={faltan.length ? g.idFalta : undefined}
          onClick={() => { setPidiendo(false); onClick(); }}>Volver a intentar</button>
        <button type="button" className="boton" onClick={() => setPidiendo(false)}>Ahora no</button>
      </div>
      <LineaFalta id={g.idFalta} faltan={faltan} />
    </div>
  );
}

/** «Para continuar falta: …» debajo del botón apagado (UX-31). No pinta nada si no falta nada. */
export function LineaFalta({ id, faltan }: { id: string; faltan: readonly string[] }) {
  if (!faltan.length) return null;
  return <p id={id} className="text-xs text-amber-300">Para continuar falta: {faltan.join(" · ")}.</p>;
}

/** Lo que falta para la acción: `otros` y, si la casilla está sin marcar, marcarla. */
export function faltanConGuardar(g: GuardeAntes, otros: readonly string[] = []): string[] {
  return g.guardado ? [...otros] : [...otros, FALTA_GUARDAR];
}
