"use client";
import { useState } from "react";
import { pedir } from "./comun";

/** Estados de un trabajo en los que se ofrece «Cambiar el link». */
export const ESTADOS_CAMBIAR_LINK = ["fallido", "interrumpido", "cancelado"];

/** ¿Va el botón «Cambiar el link» en esta fila? Sólo en un video de página web que no llegó a armarse. */
export function ofreceCambiarLink(t: { tipo: string; estado: string }): boolean {
  return t.tipo === "demo.crear" && ESTADOS_CAMBIAR_LINK.includes(t.estado);
}

/**
 * Botón «Cambiar el link» (UX-17): vuelve a Nuevo → Desde una página web con el link, el texto y lo
 * elegido ya puestos, para corregir el link sin escribir todo otra vez. Va junto a «Volver a intentar».
 */
export function CambiarLink({ trabajoId }: { trabajoId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);
  async function ir() {
    setYendo(true);
    setError(null);
    try {
      const { enlace } = await pedir<{ enlace: string }>(`/api/demos/borrador?trabajo=${encodeURIComponent(trabajoId)}`);
      window.location.assign(enlace);
    } catch (e) {
      setError((e as Error).message);
      setYendo(false);
    }
  }
  return (
    <>
      <button type="button" className="boton" disabled={yendo} onClick={() => void ir()}>Cambiar el link</button>
      {error && <span role="alert" className="text-xs text-rose-300">{error}</span>}
    </>
  );
}
