"use client";
import { useState } from "react";
import { Aviso, AvisoTarjeta, Barra, LineaFalta, faltanConGuardar, postJson, useGuardeAntes, useSondeo } from "./comun";
import { INTENSIDADES_CAMARA3D, MOVIMIENTOS_CAMARA3D, type IntensidadCamara3d, type MovimientoCamara3d } from "@/lib/camara3d-catalogo";

interface Datos {
  falta: string | null;
  trabajos: { id: string; estado: string; etapa: string; progreso: number; escena: string | null }[];
}

function Opciones<T extends string>({ valor, opciones, cambiar }: { valor: T; opciones: readonly { id: T; titulo: string; texto: string }[]; cambiar: (v: T) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={valor === o.id} onClick={() => cambiar(o.id)}
          className={`rounded border p-2 text-left ${valor === o.id ? "border-acento bg-acento/10" : "border-borde hover:border-acento/60"}`}>
          <span className="block text-sm font-medium">{o.titulo}</span>
          <span className="block text-xs text-tenue">{o.texto}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * «Cámara 3D» en una escena con foto: la foto gana profundidad y una cámara de verdad se mueve delante
 * (camara3d.ts). Decisión del dueño, 2026-11-25.
 */
export function PanelCamara3d({ proyectoId, escena, numero, ocupado }: { proyectoId: string; escena: string; numero: number; ocupado: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <details className="text-sm" open={abierto} onToggle={(ev) => setAbierto((ev.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-tenue">Cámara 3D <span className="text-xs">(que la foto se vea filmada: profundidad y desenfoque reales)</span></summary>
      {abierto && <FormCamara3d proyectoId={proyectoId} escena={escena} numero={numero} ocupado={ocupado} />}
    </details>
  );
}

function FormCamara3d({ proyectoId, escena, numero, ocupado }: { proyectoId: string; escena: string; numero: number; ocupado: boolean }) {
  const { datos, recargar } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/camara3d`, 3000);
  const [movimiento, setMovimiento] = useState<MovimientoCamara3d | "auto">("auto");
  const [intensidad, setIntensidad] = useState<IntensidadCamara3d>("normal");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guarde = useGuardeAntes();
  if (!datos) return <p className="mt-2 text-xs text-tenue">Cargando…</p>;
  if (datos.falta) return <div className="mt-3"><Aviso tipo="alerta">{datos.falta}</Aviso></div>;
  const trabajo = datos.trabajos.find((t) => t.escena === escena);
  const faltan = faltanConGuardar(guarde);

  async function enviar() {
    setError(null);
    setEnviando(true);
    try {
      await postJson(`/api/proyectos/${proyectoId}/camara3d`, { escena, opciones: { ...(movimiento === "auto" ? {} : { movimiento }), intensidad } });
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
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
      ) : (
        <>
          <p className="text-xs text-tenue">
            Geeper mide qué está cerca y qué está lejos en la foto y mueve una cámara de verdad delante: lo de adelante se mueve distinto que
            el fondo, con desenfoque como en una lente real. No inventa nada: la foto queda igual. Tarda menos de un minuto.
          </p>
          <fieldset className="space-y-2">
            <legend className="font-medium">1. ¿Cómo se mueve la cámara?</legend>
            <Opciones valor={movimiento} cambiar={setMovimiento}
              opciones={[{ id: "auto" as const, titulo: "Que elija Geeper", texto: "Según la foto y lo que tienen las otras escenas." }, ...MOVIMIENTOS_CAMARA3D]} />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="font-medium">2. ¿Cuánta profundidad?</legend>
            <Opciones valor={intensidad} cambiar={setIntensidad} opciones={INTENSIDADES_CAMARA3D} />
          </fieldset>
          <AvisoTarjeta g={guarde}>Mover la cámara usa la tarjeta de video (Blender) menos de un minuto.</AvisoTarjeta>
          <button type="button" className="boton boton-primario" disabled={ocupado || enviando || faltan.length > 0} aria-describedby={faltan.length ? guarde.idFalta : undefined}
            onClick={() => void enviar()}>
            {enviando ? "Enviando…" : `Mover la cámara en la escena ${numero}`}
          </button>
          <LineaFalta id={guarde.idFalta} faltan={faltan} />
          {error && <Aviso tipo="error">{error}</Aviso>}
        </>
      )}
    </div>
  );
}
