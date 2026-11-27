"use client";
import Link from "next/link";
import type { Recomendacion } from "@/lib/recomendaciones";
import { useSondeo } from "./comun";

/** Lo que devuelve /api/asistente (ver `siguientes` en src/lib/asistente.ts). */
interface Siguiente {
  proyecto: { id: string; nombre: string };
  recomendacion: Recomendacion;
  mas: number;
}

/**
 * Tarjeta de Inicio para quien no sabe por dónde seguir: lo más importante de cada proyecto reciente,
 * con un botón que lleva al asistente de ese proyecto (src/lib/recomendaciones.ts).
 */
export function LoSiguiente() {
  const { datos } = useSondeo<{ siguientes: Siguiente[] }>("/api/asistente", 30_000);
  if (!datos?.siguientes.length) return null;
  return (
    <section className="tarjeta mb-4 space-y-2 p-4" aria-labelledby="lo-siguiente-titulo">
      <h2 id="lo-siguiente-titulo" className="font-medium">Lo siguiente</h2>
      <p className="text-xs text-tenue">Lo que más mejoraría tus videos recientes. Dentro de cada proyecto, el «Asistente» te dice cómo.</p>
      <ul className="divide-y divide-borde">
        {datos.siguientes.map(({ proyecto, recomendacion: r, mas }) => (
          <li key={proyecto.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-56">
              <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs ${r.prioridad === "bloquea" ? "bg-red-900 text-red-100" : "bg-sky-800 text-sky-100"}`}>
                {r.prioridad === "bloquea" ? "Falta arreglar" : "Mejora"}
              </span>
              <span className="font-medium">{proyecto.nombre}:</span> {r.titulo}
              {mas > 0 && <span className="text-xs text-tenue"> · y {mas} {mas === 1 ? "cosa más" : "cosas más"}</span>}
            </span>
            <Link className="boton py-1 text-sm" href={`/proyectos/${proyecto.id}#asistente-titulo`}>Ver cómo</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
