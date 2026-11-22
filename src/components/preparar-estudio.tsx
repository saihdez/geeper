"use client";
import { useEffect, useRef, useState } from "react";
import { Aviso, pedir, postJson, useSondeo } from "./comun";

interface Paso { id: string; nombre: string; paraQue: string; estado: string; detalle: string }
interface Estado { disponible: boolean; corriendo: boolean; pasos: Paso[]; registro: string[]; revisado: string | null }

/** Signo, color y estado en palabras de cada paso (el signo solo es mudo para el lector de pantalla). */
export const ICONO: Record<string, [string, string, string]> = {
  listo: ["✓", "text-emerald-400", "Listo"],
  aviso: ["!", "text-amber-300", "Con aviso"],
  falta: ["·", "text-tenue", "Falta"],
  error: ["✗", "text-red-400", "Falló"],
  revisando: ["…", "text-sky-300", "Revisando"],
  instalando: ["↓", "text-sky-300", "Instalando"],
  pendiente: ["○", "text-tenue", "En espera"],
};

/**
 * «Preparar el estudio» (sólo en la app de escritorio): revisa e instala con un clic lo que este equipo
 * necesita (navegador, voz, transcripción, clips, PhotoCraft, VectorCraft) y avisa si no hay Docker.
 */
export function PrepararEstudio({ alTerminar }: { alTerminar?: () => void }) {
  // activo: sondeo rápido (se pidió una preparación o ya venía corriendo al abrir la página).
  const [activo, setActivo] = useState(false);
  const { datos: e, recargar } = useSondeo<Estado>("/api/sistema/estudio", activo ? 1500 : 60_000);
  const [error, setError] = useState<string | null>(null);
  const [verRegistro, setVerRegistro] = useState(false);

  // Cuando la preparación pasa de corriendo a terminada, Sistema vuelve a revisar sus chequeos.
  const corriendoAhora = e?.corriendo ?? false;
  const [antes, setAntes] = useState(false);
  const [terminadas, setTerminadas] = useState(0);
  if (corriendoAhora !== antes) {
    setAntes(corriendoAhora);
    setActivo(corriendoAhora);
    if (antes) setTerminadas(terminadas + 1);
  }
  const avisar = useRef(alTerminar);
  useEffect(() => {
    avisar.current = alTerminar;
  });
  useEffect(() => {
    if (terminadas > 0) avisar.current?.();
  }, [terminadas]);

  if (!e?.disponible) return null;
  const faltan = e.pasos.filter((p) => p.estado === "falta" || p.estado === "error").length;
  const corriendo = e.corriendo;

  async function preparar() {
    setError(null);
    setActivo(true);
    try {
      const r = await postJson<Estado>("/api/sistema/estudio", {});
      if (!r.corriendo) setActivo(false);
      await recargar();
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    }
  }

  async function revisar() {
    setError(null);
    try {
      await pedir("/api/sistema/estudio?revisar=1");
      await recargar();
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    }
  }

  return (
    <div id="preparar-estudio" className="tarjeta scroll-mt-4 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Preparar el estudio</h2>
        <div className="flex gap-2">
          <button type="button" className="boton" disabled={corriendo} onClick={() => void revisar()}>Revisar de nuevo</button>
          <button type="button" className="boton boton-primario" disabled={corriendo || faltan === 0} onClick={() => void preparar()}>
            {corriendo ? "Preparando…" : faltan === 0 ? "Todo listo" : `Preparar (${faltan} ${faltan === 1 ? "cosa" : "cosas"})`}
          </button>
        </div>
      </div>
      <p className="text-sm text-tenue">
        Instala en la carpeta de Geeper lo que este equipo necesita: no toca el sistema ni pide permisos. La primera vez baja unos 3 GB
        (modelos de voz y de transcripción); se puede seguir usando Geeper mientras tanto.
      </p>
      <ul className="space-y-2">
        {e.pasos.map((p) => {
          const [icono, color, estado] = ICONO[p.estado] ?? ICONO.pendiente!;
          return (
            <li key={p.id} className="text-sm [overflow-wrap:anywhere]">
              <span aria-hidden className={color}>{icono}</span><span className="sr-only">{estado}:</span> <span className="font-medium">{p.nombre}</span>
              <span className="text-tenue"> — {p.paraQue}</span>
              {p.detalle && <p className={`ml-4 text-xs ${p.estado === "error" ? "text-red-300" : p.estado === "aviso" ? "text-amber-200" : "text-tenue"}`}>{p.detalle}</p>}
            </li>
          );
        })}
      </ul>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {e.registro.length > 0 && (
        <div>
          <button type="button" className="text-xs text-sky-300 underline" onClick={() => setVerRegistro(!verRegistro)} aria-expanded={verRegistro}>
            {verRegistro ? "Ocultar registro" : "Ver registro"}
          </button>
          {verRegistro && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-xs" aria-live="polite">{e.registro.join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}
