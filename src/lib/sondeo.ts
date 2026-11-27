/**
 * Sondeo de una URL sin React (lo usa `useSondeo` de components/comun.tsx):
 * - espera la respuesta antes de programar la siguiente (cadena de setTimeout, nunca se enciman);
 * - no pide con la pestaña oculta y pide enseguida al volver a ella;
 * - no avisa si el texto de la respuesta no cambió (así la pantalla no se repinta en vano);
 * - descarta la respuesta de una petición anterior (AbortController) al recargar o al cerrarse;
 * - con `avisos` (WEB-13): mientras el canal de avisos está abierto pide al llegar un aviso que le toca y,
 *   por si alguno se pierde, cada RESPALDO_MS como mínimo; si el canal se corta, vuelve a su ritmo.
 */
import { ErrorConexion, RECONECTANDO, errorDelCuerpo, mensajeHttp, traer } from "./conexion";
import type { CanalAvisos } from "./eventos-cliente";

/** Con el canal de avisos abierto, el sondeo de respaldo no pide más seguido que esto. */
export const RESPALDO_MS = 60_000;
/** Entre dos pedidos por aviso, al menos esto (el vigía del servidor avisa como mucho una vez por segundo). */
export const ENTRE_AVISOS_MS = 1000;

/** Lo mínimo de `document` que hace falta (en pruebas se pasa uno falso). */
export interface Visibilidad {
  readonly hidden: boolean;
  addEventListener(tipo: "visibilitychange", f: () => void): void;
  removeEventListener(tipo: "visibilitychange", f: () => void): void;
}

export interface OpcionesSondeo<T> {
  url: string;
  /** Milisegundos hasta la próxima consulta, según los últimos datos (permite ir más lento en reposo). */
  intervalo: (datos: T | null) => number;
  alDatos: (datos: T) => void;
  alError: (mensaje: string | null) => void;
  visibilidad?: Visibilidad | null;
  /** Avisos que le tocan a esta consulta (ver lib/eventos-avisos.ts) y el canal por donde llegan. */
  avisos?: { canal: CanalAvisos; filtros: readonly string[] } | null;
  /** Para pruebas: trae el texto de la respuesta. */
  pedirTexto?: (url: string, signal: AbortSignal) => Promise<string>;
}

export interface Sondeo {
  iniciar(): void;
  /** Pide ya (cancela la que esté en vuelo) y sigue el ciclo. */
  recargar(): Promise<void>;
  /** Reprograma la próxima consulta con el intervalo actual (sin pedir). */
  reprogramar(): void;
  detener(): void;
}

async function pedirTextoPorDefecto(url: string, signal: AbortSignal): Promise<string> {
  const r = await traer(url, { signal, cache: "no-store" });
  const texto = await r.text();
  if (!r.ok) throw new Error(mensajeHttp(r.status, errorDelCuerpo(texto)));
  return texto;
}

export function crearSondeo<T>(o: OpcionesSondeo<T>): Sondeo {
  const visibilidad = o.visibilidad === undefined ? (typeof document === "undefined" ? null : document) : o.visibilidad;
  const pedirTexto = o.pedirTexto ?? pedirTextoPorDefecto;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enVuelo: AbortController | null = null;
  let ultimoTexto: string | null = null;
  let ultimos: T | null = null;
  let conError = false;
  let detenido = false;
  let otraVez = false; // llegó un aviso con una consulta en vuelo: pedir de nuevo al terminar
  let ultimoInicio = -Infinity;
  let bajaAvisos: (() => void) | null = null;
  const avisos = o.avisos ?? null;

  const oculto = () => !!visibilidad?.hidden;

  function programar() {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    if (detenido || oculto()) return;
    let ms = o.intervalo(ultimos);
    if (!Number.isFinite(ms)) return; // Infinity: no volver a pedir solo (sólo con recargar o al volver a la pestaña)
    if (avisos?.canal.abierto()) ms = Math.max(ms, RESPALDO_MS);
    temporizador = setTimeout(() => void ciclo(), Math.max(250, ms));
  }

  /** Pide por un aviso, sin cortar la que está en vuelo y sin pedir más seguido que su ritmo (mínimo ENTRE_AVISOS_MS). */
  function porAviso() {
    if (detenido || oculto()) return;
    if (enVuelo) {
      otraVez = true;
      return;
    }
    // Nunca más seguido que el ritmo propio de la pantalla: con un trabajo en curso el worker escribe en
    // cada etapa y en cada lease, y una pantalla de 15 s no debe pasar a pedir cada segundo.
    const base = o.intervalo(ultimos);
    const entre = Math.max(ENTRE_AVISOS_MS, Number.isFinite(base) ? base : 0);
    const falta = ultimoInicio + entre - Date.now();
    if (falta <= 0) {
      void ciclo();
      return;
    }
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => void ciclo(), falta);
  }

  async function ciclo(): Promise<void> {
    if (detenido) return;
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    enVuelo?.abort();
    otraVez = false;
    ultimoInicio = Date.now();
    const c = new AbortController();
    enVuelo = c;
    try {
      const texto = await pedirTexto(o.url, c.signal);
      if (detenido || c.signal.aborted) return;
      if (texto !== ultimoTexto) {
        let d: T;
        try {
          d = JSON.parse(texto) as T;
        } catch {
          d = {} as T;
        }
        ultimoTexto = texto;
        ultimos = d;
        o.alDatos(d);
      }
      if (conError) {
        conError = false;
        o.alError(null);
      }
    } catch (e) {
      if (detenido || c.signal.aborted) return;
      conError = true;
      o.alError(e instanceof ErrorConexion ? RECONECTANDO : e instanceof Error ? e.message : String(e));
    } finally {
      if (enVuelo === c) enVuelo = null;
    }
    if (detenido || c.signal.aborted) return;
    if (otraVez) {
      otraVez = false;
      porAviso();
    } else programar();
  }

  const alCambiarVisibilidad = () => {
    if (detenido) return;
    if (oculto()) {
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
    } else if (!enVuelo) {
      void ciclo();
    }
  };

  return {
    iniciar() {
      visibilidad?.addEventListener("visibilitychange", alCambiarVisibilidad);
      // Al abrirse o cortarse el canal cambia el ritmo: se reprograma la próxima consulta.
      if (avisos) bajaAvisos = avisos.canal.escuchar(avisos.filtros, porAviso, () => { if (!enVuelo) programar(); });
      // Aunque la pestaña esté oculta se pide una vez, para no dejar la pantalla vacía al volver.
      void ciclo();
    },
    recargar: () => ciclo(),
    reprogramar() {
      if (!enVuelo) programar();
    },
    detener() {
      detenido = true;
      visibilidad?.removeEventListener("visibilitychange", alCambiarVisibilidad);
      bajaAvisos?.();
      bajaAvisos = null;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      enVuelo?.abort();
      enVuelo = null;
    },
  };
}
