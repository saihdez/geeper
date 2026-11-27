"use client";
import Link from "next/link";
import { useSondeo } from "./comun";

interface Estado { disponible: boolean; corriendo: boolean; pasos: { estado: string }[] }

/** Cuántas cosas le faltan al equipo (0 si no es la app de escritorio o ya está todo). */
export function faltanEnEstudio(e: Estado | null): number {
  if (!e?.disponible) return 0;
  return e.pasos.filter((p) => p.estado === "falta" || p.estado === "error").length;
}

/**
 * Tarjeta de la portada que lleva a «Preparar el estudio» (en Sistema) cuando a este equipo le falta
 * algo para hacer videos. En un equipo recién instalado es lo primero que hay que hacer.
 */
export function AvisoEstudio() {
  const { datos: e } = useSondeo<Estado>("/api/sistema/estudio", 60_000);
  const faltan = faltanEnEstudio(e);
  if (!e || (faltan === 0 && !e.corriendo)) return null;
  return (
    <div className="tarjeta mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-700 p-4" role="status">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {e.corriendo ? "Geeper está preparando tu equipo." : `A tu equipo le ${faltan === 1 ? "falta 1 cosa" : `faltan ${faltan} cosas`} para hacer videos.`}
        </p>
        <p className="text-tenue">
          {e.corriendo
            ? "Puedes seguir usando Geeper mientras tanto."
            : "Se instala con un clic (la voz, los subtítulos y lo demás). Baja unos 3 GB la primera vez."}
        </p>
      </div>
      <Link href="/sistema#preparar-estudio" className="boton boton-primario">{e.corriendo ? "Ver cómo va" : "Preparar el estudio"}</Link>
    </div>
  );
}
