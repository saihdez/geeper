/**
 * Sondeo de una URL sin React (lo usa `useSondeo` de components/comun.tsx):
 * - espera la respuesta antes de programar la siguiente (cadena de setTimeout, nunca se enciman);
 * - no pide con la pestaña oculta y pide enseguida al volver a ella;
 * - no avisa si el texto de la respuesta no cambió (así la pantalla no se repinta en vano);
 * - descarta la respuesta de una petición anterior (AbortController) al recargar o al cerrarse.
 */
import { ErrorConexion, RECONECTANDO, errorDelCuerpo, mensajeHttp, traer } from "./conexion";

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

  const oculto = () => !!visibilidad?.hidden;

  function programar() {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    if (detenido || oculto()) return;
    const ms = o.intervalo(ultimos);
    if (!Number.isFinite(ms)) return; // Infinity: no volver a pedir solo (sólo con recargar o al volver a la pestaña)
    temporizador = setTimeout(() => void ciclo(), Math.max(250, ms));
  }

  async function ciclo(): Promise<void> {
    if (detenido) return;
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    enVuelo?.abort();
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
    if (!detenido && !c.signal.aborted) programar();
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
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      enVuelo?.abort();
      enVuelo = null;
    },
  };
}
