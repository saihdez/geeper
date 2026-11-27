/**
 * Un solo canal de avisos (EventSource a /api/eventos, WEB-13) para toda la página, lo usen cuantas
 * pantallas lo usen. Con la pestaña oculta se cierra (no ocupa una de las 6 conexiones del navegador) y
 * se reabre al volver. Sin EventSource, o si el servidor no lo acepta, queda cerrado y cada sondeo sigue
 * preguntando como siempre.
 */
import { coincide, type Cambio } from "./eventos-avisos";
import type { Visibilidad } from "./sondeo";

/** Lo mínimo de EventSource que hace falta (en pruebas se pasa uno falso). */
export interface FuenteEventos {
  readonly readyState: number;
  addEventListener(tipo: string, f: (e: { data?: unknown }) => void): void;
  close(): void;
}

export interface CanalAvisos {
  /** ¿Llegan los avisos ahora? Si no, el sondeo pregunta a su ritmo de siempre. */
  abierto(): boolean;
  /** `alAviso` por cada cambio que coincide con algún filtro; `alEstado` cuando se abre o se corta. */
  escuchar(filtros: readonly string[], alAviso: () => void, alEstado: () => void): () => void;
}

export interface OpcionesCanal {
  url?: string;
  crearFuente?: ((url: string) => FuenteEventos) | null;
  visibilidad?: Visibilidad | null;
  /** Si el servidor cierra del todo (no reconecta solo), cuánto esperar para probar otra vez. */
  reintentoMs?: number;
  /** Al irse la última pantalla, cuánto esperar antes de cerrar (al cambiar de página llega otra enseguida). */
  graciaMs?: number;
}

const CERRADO = 2;

interface Escucha {
  filtros: readonly string[];
  alAviso: () => void;
  alEstado: () => void;
}

export function crearCanal(o: OpcionesCanal = {}): CanalAvisos {
  const url = o.url ?? "/api/eventos";
  const crearFuente = o.crearFuente === undefined
    ? (typeof EventSource === "undefined" ? null : (u: string) => new EventSource(u) as unknown as FuenteEventos)
    : o.crearFuente;
  const visibilidad = o.visibilidad === undefined ? (typeof document === "undefined" ? null : document) : o.visibilidad;
  const reintentoMs = o.reintentoMs ?? 60_000;
  const graciaMs = o.graciaMs ?? 3000;
  const escuchas = new Set<Escucha>();
  let fuente: FuenteEventos | null = null;
  let estaAbierto = false;
  let huboCorte = false;
  let reintento: ReturnType<typeof setTimeout> | null = null;
  let gracia: ReturnType<typeof setTimeout> | null = null;
  let mirando = false;

  const ponerEstado = (abierto: boolean) => {
    if (abierto === estaAbierto) return;
    estaAbierto = abierto;
    for (const e of [...escuchas]) e.alEstado();
  };

  function cerrar() {
    if (reintento) clearTimeout(reintento);
    reintento = null;
    fuente?.close();
    fuente = null;
    ponerEstado(false);
  }

  function abrir() {
    if (!crearFuente || fuente || !escuchas.size || visibilidad?.hidden) return;
    let f: FuenteEventos;
    try {
      f = crearFuente(url);
    } catch {
      return;
    }
    fuente = f;
    f.addEventListener("open", () => {
      if (fuente !== f) return;
      ponerEstado(true);
      // Tras un corte pudo haberse perdido un aviso: todos piden una vez.
      if (huboCorte) for (const e of [...escuchas]) e.alAviso();
      huboCorte = false;
    });
    f.addEventListener("error", () => {
      if (fuente !== f) return;
      huboCorte = true;
      ponerEstado(false);
      // CERRADO: el navegador no reintenta solo (p. ej. respuesta que no es un canal). Se prueba más tarde.
      if (f.readyState === CERRADO) {
        f.close();
        fuente = null;
        reintento = setTimeout(() => {
          reintento = null;
          abrir();
        }, reintentoMs);
      }
    });
    f.addEventListener("cambio", (ev) => {
      if (fuente !== f || typeof ev.data !== "string") return;
      let c: Cambio;
      try {
        c = JSON.parse(ev.data) as Cambio;
      } catch {
        return;
      }
      for (const e of [...escuchas]) if (e.filtros.some((x) => coincide(x, c))) e.alAviso();
    });
  }

  const alCambiarVisibilidad = () => {
    if (visibilidad?.hidden) cerrar();
    else abrir();
  };

  return {
    abierto: () => estaAbierto,
    escuchar(filtros, alAviso, alEstado) {
      const e: Escucha = { filtros, alAviso, alEstado };
      escuchas.add(e);
      if (gracia) clearTimeout(gracia);
      gracia = null;
      if (!mirando && visibilidad) {
        visibilidad.addEventListener("visibilitychange", alCambiarVisibilidad);
        mirando = true;
      }
      abrir();
      return () => {
        escuchas.delete(e);
        if (escuchas.size) return;
        if (gracia) clearTimeout(gracia);
        gracia = setTimeout(() => {
          gracia = null;
          if (escuchas.size) return;
          cerrar();
          if (mirando && visibilidad) visibilidad.removeEventListener("visibilitychange", alCambiarVisibilidad);
          mirando = false;
        }, graciaMs);
      };
    },
  };
}

let delNavegador: CanalAvisos | null = null;

/** El canal de esta página (uno solo, creado al primer uso). */
export function canalDeLaPagina(): CanalAvisos {
  return (delNavegador ??= crearCanal());
}
