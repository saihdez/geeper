"use client";
/** Aviso común «Geeper está en pausa», visible en todas las páginas cuando el motor no corre. */
import { useSondeo } from "./comun";

/** null mientras no se sabe (al abrir o sin conexión): así no se acusa al motor sin motivo. */
export function useMotorVivo(): boolean | null {
  const { datos } = useSondeo<{ vivo: boolean }>("/api/sistema/motor", 30_000);
  return datos ? datos.vivo : null;
}

/** Qué decir de un trabajo que espera su turno: si el motor está apagado, no culpar a la tarjeta de video. */
export function textoEspera(vivo: boolean | null): string {
  return vivo === false ? "En espera: Geeper está en pausa (mira el aviso de arriba)." : "En espera: la tarjeta de video está ocupada.";
}

export function AvisoMotor() {
  const vivo = useMotorVivo();
  if (vivo !== false) return null;
  return (
    <div role="alert" className="border-b border-amber-700 bg-amber-950/60 px-4 py-2 text-sm">
      <div className="mx-auto max-w-7xl">
        <p><strong>Geeper está en pausa: nada avanza.</strong> Ciérralo y ábrelo otra vez. Lo que tenías en la fila sigue guardado.</p>
        <details className="mt-1 text-xs text-tenue">
          <summary className="cursor-pointer">Detalle técnico</summary>
          <p className="mt-1">El motor que hace los trabajos (worker) no da señales desde hace más de un minuto. Si abriste Geeper desde una terminal: <code className="font-mono">pnpm run up</code> (o sólo el motor: <code className="font-mono">pnpm run worker</code>).</p>
        </details>
      </div>
    </div>
  );
}
