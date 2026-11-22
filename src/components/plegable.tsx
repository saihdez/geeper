"use client";
/**
 * Sección que se pliega (UX-08) y que, plegada, no monta lo de adentro: así un panel cerrado no sigue
 * pidiendo datos cada pocos segundos (WEB-10). Al abrirla se monta y pide lo suyo.
 */
import { useState } from "react";

export function Plegable({ id, titulo, detalle, inicial = false, abierto, alCambiar, children }: {
  id?: string;
  titulo: React.ReactNode;
  /** Una línea bajo el título que dice qué hay adentro. */
  detalle?: React.ReactNode;
  inicial?: boolean;
  /** Controlado desde afuera (si se pasa, `inicial` no cuenta). */
  abierto?: boolean;
  alCambiar?: (abierto: boolean) => void;
  children?: React.ReactNode;
}) {
  const [propio, setPropio] = useState(inicial);
  const open = abierto ?? propio;
  return (
    <details id={id} className="tarjeta scroll-mt-4 p-4" open={open}
      onToggle={(ev) => {
        const a = (ev.currentTarget as HTMLDetailsElement).open;
        if (a === open) return;
        setPropio(a);
        alCambiar?.(a);
      }}>
      <summary className="cursor-pointer select-none">
        <span className="font-medium">{titulo}</span>
        {detalle && <span className="block text-xs text-tenue">{detalle}</span>}
      </summary>
      {open && <div className="mt-3 space-y-4">{children}</div>}
    </details>
  );
}
