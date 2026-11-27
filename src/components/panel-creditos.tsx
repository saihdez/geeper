"use client";
import { useState } from "react";
import { Aviso, useSondeo } from "./comun";

export interface DatosCreditos {
  listo: boolean;
  hacenFalta?: boolean;
  lineas?: string[];
  avisos?: string[];
  cortesia?: string | null;
}

/** El texto de créditos que va al final de la descripción (vacío si no hace falta ninguno). */
export function textoCreditos(d: DatosCreditos | null): string {
  return d?.hacenFalta && d.lineas?.length ? `Créditos:\n${d.lineas.join("\n")}` : "";
}

/**
 * ¿Hay que dar crédito al publicar? Lo dice en una frase y, si hace falta, da el texto listo para copiar.
 * Sirve también si el video se descarga y se sube a mano.
 */
export function PanelCreditos({ proyectoId }: { proyectoId: string }) {
  const { datos } = useSondeo<DatosCreditos>(`/api/proyectos/${proyectoId}/creditos`, 60_000);
  const [copiado, setCopiado] = useState<string | null>(null);
  if (!datos?.listo) return null;
  const texto = textoCreditos(datos);

  async function copiar(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      setCopiado(t);
    } catch {
      setCopiado(null);
    }
  }

  return (
    <section className="tarjeta space-y-2 p-4" aria-labelledby="titulo-creditos">
      <h2 id="titulo-creditos" className="font-medium">Créditos</h2>
      {texto ? (
        <>
          <p className="text-sm">Hace falta dar crédito: pega esto al final de la descripción{" "}
            <span className="text-tenue">(si publicas desde aquí, ya va puesto).</span></p>
          <pre className="whitespace-pre-wrap rounded-lg border border-borde p-2 text-sm">{texto}</pre>
          <button type="button" className="boton" onClick={() => void copiar(texto)}>{copiado === texto ? "Copiado" : "Copiar"}</button>
        </>
      ) : (
        <p className="text-sm">No hace falta dar crédito: todo lo que suena y se ve es tuyo o tiene licencia libre.</p>
      )}
      {datos.cortesia && !texto && (
        <p className="text-xs text-tenue">Si quieres agradecer (no es obligatorio): «{datos.cortesia}»{" "}
          <button type="button" className="underline" onClick={() => void copiar(datos.cortesia!)}>{copiado === datos.cortesia ? "copiado" : "copiar"}</button></p>
      )}
      {(datos.avisos ?? []).map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
    </section>
  );
}
