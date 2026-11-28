"use client";
import Link from "next/link";
import { useState } from "react";
import { Aviso, pedir } from "./comun";

interface Resultado {
  archivo: string;
  abierta: boolean;
  motivo?: string;
}

/**
 * «Editar en Avnac Studio»: la invitación entra con todas sus piezas sueltas (una página por parte) para
 * diseñarla a gusto y sacar imagen o PDF. La página interactiva se corrige con «Corregir textos».
 */
export function PanelAvnac({ slug }: { slug: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [r, setR] = useState<Resultado | null>(null);
  const [falla, setFalla] = useState<string | null>(null);

  async function abrir() {
    setOcupado(true);
    setFalla(null);
    try {
      setR(await pedir<Resultado>(`/api/invitaciones/${slug}/avnac`, { method: "POST" }));
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="tarjeta space-y-3 p-4">
      <h2 className="font-medium">🎨 Diseñarla a tu gusto en Avnac Studio</h2>
      <p className="text-sm text-tenue">
        Cada parte de la invitación entra como una página, con todo suelto: textos, foto, QR, botones, adornos y colores. Muévelos,
        cámbialos o agrega lo que quieras, y guárdala como imagen o PDF (para imprimir, estados o mandarla como foto). La página
        interactiva —sobre, música, cuenta atrás y WhatsApp— se corrige con «Corregir textos».
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="boton boton-primario" disabled={ocupado} onClick={abrir}>{ocupado ? "Preparando…" : "Abrir en Avnac Studio"}</button>
        <a className="boton" href={`/api/invitaciones/${slug}/avnac`} download>Descargar el diseño</a>
      </div>
      {falla && <Aviso tipo="error">{falla}</Aviso>}
      {r && r.abierta && (
        <Aviso tipo="info">
          <p>Se abrió Avnac Studio y la carpeta con tu diseño. Para cargarlo, sólo la primera vez:</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>En Avnac, en la pantalla de archivos, toca <b>Import</b>.</li>
            <li>Elige <b>{r.archivo}</b> (está en la carpeta que se abrió: Geeper → Avnac).</li>
            <li>Queda en tu lista de Avnac con todas sus páginas. Para sacar la imagen o el PDF, usa <b>Export</b>.</li>
          </ol>
        </Aviso>
      )}
      {r && !r.abierta && (
        <Aviso tipo="alerta">
          <p>{r.motivo}</p>
          <p className="mt-1">
            El diseño ya quedó listo en la carpeta Geeper → Avnac (<b>{r.archivo}</b>).{" "}
            <Link className="underline" href="/media">Instala Avnac Studio en Media</Link> (Imagen y diseño) y vuelve a tocar «Abrir en Avnac Studio».
          </p>
        </Aviso>
      )}
    </section>
  );
}
