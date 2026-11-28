"use client";
import { useEffect, useState } from "react";
import { Aviso, AvisoTarjeta, LineaFalta, faltanConGuardar, pedir, postJson, useGuardeAntes } from "./comun";

type Donde = { corrida: string } | { proyectoId: string; escena: string; numero: number };

/**
 * «Abrir en Blender» y «Poner mis cambios» para todo lo que hizo Blender (blender-editar.ts). No se muestra
 * si no hay archivo de Blender (lo hecho antes de que Geeper los guardara, o lo que no salió de Blender).
 */
export function EditarEnBlender(props: Donde & { ocupado?: boolean; compacto?: boolean }) {
  const destino: Record<string, string> = "corrida" in props ? { corrida: props.corrida } : { proyecto: props.proyectoId, escena: props.escena };
  const consulta = new URLSearchParams(destino).toString();
  const [hay, setHay] = useState<boolean | null>(null);
  const [estado, setEstado] = useState<"" | "abriendo" | "abierto" | "enviando" | "enviado">("");
  const [error, setError] = useState<string | null>(null);
  const guarde = useGuardeAntes();
  const faltan = faltanConGuardar(guarde);
  useEffect(() => {
    let vivo = true;
    pedir<{ blend: boolean }>(`/api/blender/abrir?${consulta}`).then((r) => vivo && setHay(r.blend), () => vivo && setHay(false));
    return () => { vivo = false; };
  }, [consulta]);
  if (!hay) return null;

  async function abrir() {
    setError(null);
    setEstado("abriendo");
    try {
      await postJson("/api/blender/abrir", destino);
      setEstado("abierto");
    } catch (e) {
      setError((e as Error).message);
      setEstado("");
    }
  }
  async function poner() {
    setError(null);
    setEstado("enviando");
    try {
      await postJson("/api/blender/rehacer", destino);
      setEstado("enviado");
    } catch (e) {
      setError((e as Error).message);
      setEstado("abierto");
    }
  }
  const enVideo = !("corrida" in props);
  return (
    <div className={props.compacto ? "w-full space-y-2" : "space-y-2 rounded border border-borde p-3 text-sm"}>
      {!props.compacto && <p className="font-medium">Cambiarla a mano en Blender</p>}
      {estado === "enviado" ? (
        <Aviso tipo="ok">
          Dibujando tus cambios. {enVideo ? `Cuando termine, la escena ${(props as { numero: number }).numero} cambia sola (si no te gusta, vuelve atrás en el historial).` : "Cuando termine, la ves aquí con tus cambios."}
        </Aviso>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton text-xs" disabled={estado === "abriendo" || props.ocupado} onClick={() => void abrir()}>
            {estado === "abriendo" ? "Abriendo…" : "Abrir en Blender"}
          </button>
        </div>
      )}
      {(estado === "abierto" || estado === "enviando") && (
        <div className="space-y-2">
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-tenue">
            <li>Se abrió Blender en esta computadora (puede tardar unos segundos).</li>
            <li>Cambia lo que quieras: colores, textos, luces, la cámara…</li>
            <li>Guarda con Ctrl+S (en Mac, Cmd+S) y vuelve aquí.</li>
            <li>Toca «Poner mis cambios».</li>
          </ol>
          <AvisoTarjeta g={guarde}>Dibujar tus cambios usa la tarjeta de video (Blender) unos minutos.</AvisoTarjeta>
          <button type="button" className="boton boton-primario text-xs" disabled={estado === "enviando" || props.ocupado || faltan.length > 0}
            aria-describedby={faltan.length ? guarde.idFalta : undefined} onClick={() => void poner()}>
            {estado === "enviando" ? "Enviando…" : "Poner mis cambios"}
          </button>
          <LineaFalta id={guarde.idFalta} faltan={faltan} />
        </div>
      )}
      {estado === "" && !props.compacto && <p className="text-xs text-tenue">Para quien sabe usar Blender: abre el archivo con todo adentro y, al guardarlo, Geeper lo vuelve a dibujar.</p>}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}
