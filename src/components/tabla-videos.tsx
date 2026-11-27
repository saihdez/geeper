"use client";
import { useRef } from "react";
import { Aviso } from "./comun";
import { EJEMPLO_CSV, leerTabla, MAX_FILAS, type Lectura } from "@/lib/tabla-videos";

/**
 * Varios videos desde una tabla: se pega desde Excel o Google Sheets, o se sube un .csv. Muestra qué
 * entendió (una fila por video) antes de crear nada.
 */
export function TablaVideos({ texto, alCambiar }: { texto: string; alCambiar: (texto: string) => void }) {
  const archivo = useRef<HTMLInputElement>(null);
  const lectura: Lectura | null = texto.trim() ? leerTabla(texto) : null;

  async function subir(f: File | undefined) {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      alert("Ese es un archivo de Excel. En Excel: Archivo → Guardar como → «CSV». O más fácil: selecciona las filas, cópialas y pégalas en el cuadro de abajo.");
      return;
    }
    alCambiar(await f.text());
    if (archivo.current) archivo.current.value = "";
  }

  const ejemplo = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${EJEMPLO_CSV}`)}`;
  return (
    <div className="space-y-2">
      <p className="text-sm text-tenue">
        Una fila por video. Columnas: <strong>Tema</strong> (la única obligatoria), <strong>Título</strong>, <strong>Guion</strong> (lo que se
        dice, palabra por palabra; si lo dejas vacío, se escribe solo) y <strong>Final</strong> (la frase del cierre, p. ej. «Síguenos para más»).
        Hasta {MAX_FILAS} videos por tanda.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a className="boton" href={ejemplo} download="videos-ejemplo.csv">Descargar un ejemplo para llenar</a>
        <button type="button" className="boton" onClick={() => archivo.current?.click()}>Subir la tabla (.csv)</button>
        <input ref={archivo} type="file" accept=".csv,.tsv,.txt,text/csv,.xlsx,.xls" className="sr-only" aria-label="Subir la tabla" onChange={(e) => void subir(e.target.files?.[0])} />
        {texto && <button type="button" className="boton" onClick={() => alCambiar("")}>Quitar la tabla</button>}
      </div>
      <label className="block">
        <span className="text-xs text-tenue">O selecciona las filas en Excel o Google Sheets, cópialas y pégalas aquí (con la fila de títulos):</span>
        <textarea className="campo min-h-24 font-mono text-xs" value={texto} onChange={(e) => alCambiar(e.target.value)} placeholder={"Tema\tTítulo\tGuion\tFinal"} aria-label="Tabla de videos" />
      </label>
      {lectura && (
        <>
          {lectura.filas.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-sm font-medium">Se van a crear {lectura.filas.length === 1 ? "1 video" : `${lectura.filas.length} videos`}:</p>
              <table className="mt-1 w-full text-left text-xs">
                <thead className="text-tenue"><tr><th className="pr-2">#</th><th className="pr-2">Tema</th><th className="pr-2">Título</th><th className="pr-2">Guion</th><th>Final</th></tr></thead>
                <tbody>
                  {lectura.filas.slice(0, 8).map((f, i) => (
                    <tr key={i} className="border-t border-borde align-top">
                      <td className="pr-2">{i + 1}</td>
                      <td className="max-w-48 truncate pr-2">{f.tema}</td>
                      <td className="max-w-40 truncate pr-2">{f.titulo ?? <span className="text-tenue">el tema</span>}</td>
                      <td className="max-w-40 truncate pr-2">{f.guion ? `${f.guion.slice(0, 50)}${f.guion.length > 50 ? "…" : ""}` : <span className="text-tenue">se escribe solo</span>}</td>
                      <td className="max-w-32 truncate">{f.cta ?? <span className="text-tenue">la del estilo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lectura.filas.length > 8 && <p className="text-xs text-tenue">…y {lectura.filas.length - 8} más.</p>}
            </div>
          )}
          {lectura.filas.length === 0 && <Aviso tipo="alerta">No encontré ningún tema en la tabla. La primera columna (o la que se llama «Tema») tiene que tener el tema de cada video.</Aviso>}
          {lectura.avisos.map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
        </>
      )}
    </div>
  );
}
