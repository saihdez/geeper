"use client";
import { useState } from "react";
import { Aviso, Barra, archivo, postJson } from "./comun";
import { CrearEscena3d, PrepararBlender, useEscenas3d } from "./escenas-3d";
import { FORMATOS_3D, type Formato3d } from "@/lib/escenas3d-catalogo";

/**
 * «Escena 3D» en una escena del editor: poner una que ya está hecha o crear una nueva que, al terminar,
 * se pone sola en esta escena (decisión del dueño, 2026-11-25).
 */
export function PanelEscena3d({ formato, ...props }: { proyectoId: string; escena: string; numero: number; ocupado: boolean; formato: string; duracion: number }) {
  const [abierto, setAbierto] = useState(false);
  const f: Formato3d = FORMATOS_3D.find((x) => x.id === formato)?.id ?? "9:16";
  return (
    <details className="text-sm" open={abierto} onToggle={(ev) => setAbierto((ev.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-tenue">Escena 3D aquí <span className="text-xs">(un título, tu logo o tu producto en 3D)</span></summary>
      {abierto && <FormEscena3d {...props} formato={f} />}
    </details>
  );
}

function FormEscena3d({ proyectoId, escena, numero, ocupado, formato, duracion }: { proyectoId: string; escena: string; numero: number; ocupado: boolean; formato: Formato3d; duracion: number }) {
  const { datos, recargar } = useEscenas3d(4000);
  const [modo, setModo] = useState<"nueva" | "hecha">("nueva");
  const [poniendo, setPoniendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [puesta, setPuesta] = useState(false);
  if (!datos) return <p className="mt-2 text-xs text-tenue">Cargando…</p>;
  if (!datos.blender.listo) return <div className="mt-3"><PrepararBlender datos={datos} recargar={() => void recargar()} corto /></div>;
  const trabajo = datos.trabajos.find((t) => t.proyecto === proyectoId && t.escena === escena);
  const hechas = datos.corridas.filter((c) => c.estado === "hecha" && c.video);

  async function poner(corrida: string) {
    setError(null);
    setPoniendo(corrida);
    try {
      await postJson("/api/escenas-3d/usar", { corrida, proyecto: proyectoId, escena });
      setPuesta(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPoniendo(null);
    }
  }

  return (
    <div className="mt-3 space-y-4 rounded border border-borde p-3">
      {trabajo ? (
        <div className="space-y-1" aria-live="polite">
          <p className="text-xs">{trabajo.estado === "pendiente" ? "En espera: la tarjeta de video está ocupada." : trabajo.etapa || "Trabajando…"}</p>
          <Barra valor={trabajo.progreso} />
          <p className="text-xs text-tenue">Cuando termine, la escena {numero} cambia sola. Si no te gusta, vuelve atrás en el historial.</p>
        </div>
      ) : puesta ? (
        <Aviso tipo="ok">Listo: la escena {numero} ya tiene tu escena 3D. Si no te gusta, vuelve atrás en el historial.</Aviso>
      ) : (
        <>
          {hechas.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Qué quieres hacer">
              <button type="button" className={`boton text-xs ${modo === "nueva" ? "boton-primario" : ""}`} aria-pressed={modo === "nueva"} onClick={() => setModo("nueva")}>Crear una nueva</button>
              <button type="button" className={`boton text-xs ${modo === "hecha" ? "boton-primario" : ""}`} aria-pressed={modo === "hecha"} onClick={() => setModo("hecha")}>Usar una que ya hice ({hechas.length})</button>
            </div>
          )}
          {modo === "hecha" && hechas.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {hechas.map((c) => (
                <li key={c.id} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.portada && <img src={archivo(c.portada)} alt="" className="aspect-square w-full rounded border border-borde object-cover" />}
                  <p className="truncate text-xs" title={c.titulo}>{c.titulo}</p>
                  <button type="button" className="boton boton-primario w-full justify-center text-xs" disabled={ocupado || !!poniendo} onClick={() => void poner(c.id)}>
                    {poniendo === c.id ? "Poniendo…" : "Poner aquí"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <CrearEscena3d destino={{ proyecto: proyectoId, escena, numero, formato, duracion }} alCrear={() => void recargar()} />
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
        </>
      )}
    </div>
  );
}
