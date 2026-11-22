"use client";
import Link from "next/link";
import { AvisoEstudio } from "./aviso-estudio";
import { Aviso, Barra, Cargando, Estado, useSondeo } from "./comun";

interface Fila {
  id: string;
  slug: string;
  nombre: string;
  tema: string;
  formato: string;
  plantilla: string;
  estado: string;
  versionActual: number;
  creado: string;
  lote: { nombre: string } | null;
  renders: { estado: string; ruta: string; creado: string }[];
  trabajos: { tipo: string; estado: string; etapa: string; progreso: number }[];
}

/** El formato en palabras: quien no sabe de video no reconoce «9:16». */
export function nombreFormato(formato: string): string {
  return { "9:16": "Vertical (TikTok, Reels, Shorts)", "16:9": "Horizontal (YouTube)", "1:1": "Cuadrado" }[formato] ?? formato;
}

const VIDEO: Record<string, string> = { renderizado: "hecho, falta mirarlo", aprobado: "aprobado", rechazado: "descartado" };

export function ListaProyectos() {
  const { datos, error } = useSondeo<{ proyectos: Fila[] }>("/api/proyectos", 3000);
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Mis videos</h1>
        <Link href="/nuevo" className="boton boton-primario">Nuevo video</Link>
      </div>
      <AvisoEstudio />
      {error && (
        <Aviso tipo="error">
          No se pudo traer la lista de tus videos. Geeper lo vuelve a intentar solo en unos segundos.
          <details className="mt-1 text-xs text-tenue"><summary className="cursor-pointer">Detalle técnico</summary>{error}</details>
        </Aviso>
      )}
      {!datos && !error && <Cargando>Cargando tus videos…</Cargando>}
      {datos && datos.proyectos.length === 0 && (
        <div className="tarjeta p-6 text-center text-tenue">
          <p>Todavía no tienes videos.</p>
          <p className="mt-1">Eliges un tema y Geeper arma el video por ti. <Link className="text-acento underline" href="/nuevo">Haz el primero</Link>.</p>
        </div>
      )}
      {datos && datos.proyectos.length > 0 && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {datos.proyectos.map((p) => {
          const t = p.trabajos[0];
          const activo = t && (t.estado === "corriendo" || t.estado === "pendiente");
          const r = p.renders[0];
          return (
            <li key={p.id}>
              <Link href={`/proyectos/${p.id}`} className="tarjeta block h-full p-4 hover:border-sky-700">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h2 className="font-medium leading-snug">{p.nombre}</h2>
                  <Estado valor={p.estado} />
                </div>
                <p className="text-xs text-tenue">
                  {nombreFormato(p.formato)}
                  {p.lote ? ` · ${p.lote.nombre}` : ""}
                </p>
                {activo && (
                  <div className="mt-3 space-y-1">
                    <p className="truncate text-xs text-sky-200">{t.estado === "pendiente" ? "En la fila, esperando su turno" : t.etapa}</p>
                    <Barra valor={t.progreso} etiqueta={`Avance de «${p.nombre}»`} />
                  </div>
                )}
                {!activo && t && (t.estado === "fallido" || t.estado === "interrumpido") && (
                  <p className="mt-3 text-xs text-amber-300">{t.estado === "fallido" ? "No se pudo terminar" : "Se cortó a la mitad"}: ábrelo para ver qué pasó y volver a intentarlo.</p>
                )}
                {r && <p className="mt-3 text-xs text-tenue">Último video: {VIDEO[r.estado] ?? r.estado}</p>}
              </Link>
            </li>
          );
        })}
      </ul>}
    </section>
  );
}
