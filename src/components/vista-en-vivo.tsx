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

export function VistaEnVivo({ proyectoId, version }: { proyectoId: string; version: number }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  /** Último segundo visto: sobrevive al cambio de versión, que monta un player nuevo. */
  const tiempo = useRef(0);

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
    if (!el) return;
    const desde = tiempo.current;
    const alListo = () => {
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
      el.removeEventListener("ready", alListo);
      el.removeEventListener("timeupdate", alAvanzar);
    };
  }, [vista, listo]);

  if (error) return <Aviso tipo="error">No se pudo preparar la vista previa: {error}</Aviso>;
  if (!vista || !listo) return <p className="text-sm text-tenue">Preparando la vista previa…</p>;
  const vertical = vista.alto > vista.ancho;
  return (
    <div className="space-y-2">
      <div ref={caja} className={`mx-auto w-full overflow-hidden rounded bg-black ${vertical ? "max-w-sm" : ""}`} style={{ aspectRatio: `${vista.ancho} / ${vista.alto}` }}>
        {createElement("hyperframes-player", {
          key: `${vista.ruta}-${vista.version}`,
          src: `${archivo(vista.ruta)}?v=${vista.version}`,
          width: vista.ancho,
          height: vista.alto,
          controls: true,
          style: { display: "block", width: "100%", height: "100%" },
        })}
      </div>
      <p className="text-xs text-tenue">
        En vivo · versión {vista.version} · {segundos(vista.duracion)}. Es la composición sin renderizar: el QC y la descarga son del render.
      </p>
    </div>
  );
}
