"use client";
/**
 * UX-19: el aviso de «guardado» o de error del editor, en una franja fija abajo de la pantalla, cerca de
 * donde se edita (antes salía arriba, a varias pantallas de las escenas). Los éxitos se van solos; los
 * errores quedan hasta cerrarlos.
 */
import { useEffect } from "react";

export interface MensajeEditor {
  tipo: "ok" | "error";
  texto: string;
  /** Botón al lado del texto (p. ej. «Crear el video» tras guardar). */
  accion?: { texto: string; hacer: () => void };
}

/** Cuánto queda a la vista: los éxitos 6 s; los errores, hasta que la persona los cierre. */
export function duracionAviso(tipo: MensajeEditor["tipo"]): number | null {
  return tipo === "ok" ? 6000 : null;
}

export function FranjaAviso({ msg, cerrar }: { msg: MensajeEditor | null; cerrar: () => void }) {
  useEffect(() => {
    const ms = msg ? duracionAviso(msg.tipo) : null;
    if (ms === null) return;
    const t = setTimeout(cerrar, ms);
    return () => clearTimeout(t);
  }, [msg, cerrar]);
  if (!msg) return null;
  const error = msg.tipo === "error";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div role={error ? "alert" : "status"}
        className={`pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${error ? "border-red-800 bg-red-950" : "border-emerald-800 bg-emerald-950"}`}>
        <p className="min-w-0 flex-1">{msg.texto}</p>
        {msg.accion && (
          <button type="button" className="boton py-1" onClick={() => { msg.accion!.hacer(); cerrar(); }}>{msg.accion.texto}</button>
        )}
        <button type="button" className="boton py-1" onClick={cerrar} aria-label="Cerrar el aviso">{error ? "Cerrar" : "✕"}</button>
      </div>
    </div>
  );
}
