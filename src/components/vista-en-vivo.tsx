"use client";
/**
 * Vista previa en vivo del geeper.json actual con <hyperframes-player> (el player oficial de Hyperframes
 * 0.9.27): sin renderizar, se ve cada cambio en cuanto se guarda la versión.
 */
import { createElement, useEffect, useRef, useState } from "react";
import { archivo, Aviso, segundos } from "./comun";

interface Vista {
  ruta: string;
  version: number;
  ancho: number;
  alto: number;
  duracion: number;
}

/** Lo que usa este componente del elemento <hyperframes-player>. */
interface Player extends HTMLElement {
  currentTime: number;
  duration: number;
  ready: boolean;
  seek(t: number): void;
  play(): void;
  pause(): void;
}

/** Un salto pedido desde fuera: «muéstrame cómo quedó la escena que empieza en `segundo`». `vez` cambia en cada pedido. */
export interface IrA {
  segundo: number;
  vez: number;
}

/**
 * UX-37: tramo que se reproduce al guardar un cambio de escena: desde 1 s antes de que empiece y durante 3 s,
 * sin salirse del video.
 */
export function tramoDeEscena(inicio: number, duracion: number): { desde: number; hasta: number } {
  const fin = Number.isFinite(duracion) && duracion > 0 ? duracion : Infinity;
  const desde = Math.min(Math.max(0, Number.isFinite(inicio) ? inicio - 1 : 0), Number.isFinite(fin) ? Math.max(0, fin - 0.1) : Infinity);
  return { desde, hasta: Math.min(desde + 3, fin) };
}

/** Texto mientras se prepara la versión nueva (antes no se decía nada y se veía la anterior). */
export function textoPreparando(hayVistaAnterior: boolean): string {
  return hayVistaAnterior ? "Actualizando la vista previa…" : "Preparando la vista previa…";
}

/**
 * Dónde retomar al recargar la vista tras guardar (REN-06): el mismo segundo, sin pasarse del final
 * de la versión nueva (que puede durar menos). Antes volvía siempre al segundo 0.
 */
export function tiempoAlVolver(antes: number, duracion: number): number {
  if (!Number.isFinite(antes) || antes <= 0) return 0;
  if (!Number.isFinite(duracion) || duracion <= 0) return antes;
  return Math.min(antes, Math.max(0, duracion - 0.1));
}

/**
 * UX-37: qué hacer cuando el player queda listo. Un salto pendiente se aplica sólo en el player de la versión
 * al día; si no hay salto, se retoma el segundo visto únicamente en un player recién montado (`clave` nueva).
 * Antes, cada cambio de `version` o de `irA` volvía a hacer seek en el mismo player (un tirón sin motivo).
 */
export function accionAlListo(a: { clave: string; montado: string | null; irA?: IrA; aplicado: number; versionVista: number; version: number }): "tramo" | "retomar" | "nada" {
  if (a.irA && a.irA.vez !== a.aplicado && a.versionVista === a.version) return "tramo";
  return a.montado === a.clave ? "nada" : "retomar";
}

export function VistaEnVivo({ proyectoId, version, irA }: { proyectoId: string; version: number; irA?: IrA }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  /** Último segundo visto: sobrevive al cambio de versión, que monta un player nuevo. */
  const tiempo = useRef(0);
  /** Último salto ya aplicado (UX-37): cada pedido se aplica una vez, en el player de la versión al día. */
  const aplicado = useRef(0);
  /** Player en el que ya se retomó el segundo (UX-37): el mismo player no vuelve a saltar. */
  const montado = useRef<string | null>(null);
  /** UX-37: cuando la vista sale de la pantalla se muestra en pequeño, fija abajo a la derecha (el mismo player). */
  const lugar = useRef<HTMLDivElement>(null);
  const [fuera, setFuera] = useState(false);
  const [sinFlotante, setSinFlotante] = useState(false);

  useEffect(() => {
    const el = lugar.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => setFuera(Boolean(e && !e.isIntersecting && e.boundingClientRect.top < 0)), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [vista, listo]);

  useEffect(() => {
    // El elemento se registra sólo en el navegador.
    void import("@hyperframes/player").then(() => setListo(true));
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/proyectos/${proyectoId}/vista-previa`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as Vista & { error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (vivo) {
          setVista(j);
          setError(null);
        }
      })
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [proyectoId, version]);

  useEffect(() => {
    const el = caja.current?.querySelector("hyperframes-player") as Player | null | undefined;
    if (!el || !vista) return;
    const desde = tiempo.current;
    const clave = `${vista.ruta}-${vista.version}`;
    let corte: ReturnType<typeof setTimeout> | undefined;
    // Sólo se salta en el player de la versión recién guardada, no en el anterior que sigue a la vista.
    const accion = accionAlListo({ clave, montado: montado.current, irA, aplicado: aplicado.current, versionVista: vista.version, version });
    const alListo = () => {
      montado.current = clave;
      if (accion === "tramo" && irA) {
        const s = irA;
        aplicado.current = s.vez;
        const { desde: d, hasta } = tramoDeEscena(s.segundo, el.duration);
        el.seek(d);
        el.play();
        corte = setTimeout(() => el.pause(), Math.max(0, hasta - d) * 1000);
        return;
      }
      if (accion === "nada") return;
      const t = tiempoAlVolver(desde, el.duration);
      if (t > 0) el.seek(t);
    };
    const alAvanzar = () => {
      if (Number.isFinite(el.currentTime)) tiempo.current = el.currentTime;
    };
    if (el.ready) alListo();
    else el.addEventListener("ready", alListo, { once: true });
    el.addEventListener("timeupdate", alAvanzar);
    return () => {
      if (corte) clearTimeout(corte);
      el.removeEventListener("ready", alListo);
      el.removeEventListener("timeupdate", alAvanzar);
    };
  }, [vista, listo, version, irA]);

  if (error) return <Aviso tipo="error">No se pudo preparar la vista previa: {error}</Aviso>;
  if (!vista || !listo) return <p className="text-sm text-tenue" role="status">{textoPreparando(false)}</p>;
  const vertical = vista.alto > vista.ancho;
  const actualizando = vista.version !== version;
  const flotante = fuera && !sinFlotante;
  return (
    <div className="space-y-2">
      {actualizando && <p className="text-sm text-amber-300" role="status">{textoPreparando(true)}</p>}
      {/* El lugar guarda el alto de la vista para que la página no salte cuando el player pasa a flotar. */}
      <div ref={lugar} className={`mx-auto w-full ${vertical ? "max-w-sm" : ""}`} style={{ aspectRatio: `${vista.ancho} / ${vista.alto}` }}>
      <div ref={caja}
        className={flotante
          ? `fixed bottom-4 right-4 z-40 overflow-hidden rounded bg-black shadow-xl ring-1 ring-white/20 ${vertical ? "w-32 sm:w-40" : "w-56 sm:w-72"}`
          : "h-full w-full overflow-hidden rounded bg-black"}
        style={flotante ? { aspectRatio: `${vista.ancho} / ${vista.alto}` } : undefined}>
        {createElement("hyperframes-player", {
          key: `${vista.ruta}-${vista.version}`,
          src: `${archivo(vista.ruta)}?v=${vista.version}`,
          width: vista.ancho,
          height: vista.alto,
          controls: true,
          "aria-label": `Vista en vivo del video (versión ${vista.version})`,
          style: { display: "block", width: "100%", height: "100%" },
        })}
        {flotante && (
          <button type="button" aria-label="Ocultar la vista pequeña" title="Ocultar la vista pequeña"
            className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-sm text-white hover:bg-black"
            onClick={() => setSinFlotante(true)}>×</button>
        )}
      </div>
      </div>
      <p className="text-xs text-tenue">
        En vivo · versión {vista.version} · {segundos(vista.duracion)}. Muestra tus cambios al momento: la revisión y la descarga son del último video creado.
      </p>
    </div>
  );
}
