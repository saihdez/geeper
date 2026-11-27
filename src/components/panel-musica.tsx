"use client";
import { useState } from "react";
import { Aviso, numero, postJson, useSondeo } from "./comun";

interface Datos {
  listo: boolean;
  hayMusica?: boolean;
  actual?: { id: string; nombre: string; animo: string } | null;
  licencia?: string | null;
  sugerido?: string;
  animos?: Record<string, string>;
  canciones?: { id: string; nombre: string; animo: string; segundos: number; muestra: string }[];
}

/**
 * Música del video en 2 pasos: qué ánimo (viene marcado el que encaja con el tema) y qué canción,
 * escuchándolas antes. Son las canciones libres que vienen con Geeper (CC0): entran al instante, sin
 * tarjeta de video, y se pueden usar en videos con fines comerciales.
 */
export function PanelMusica({ proyectoId, ocupado, alCambiar }: { proyectoId: string; ocupado: boolean; alCambiar: () => void }) {
  const { datos, recargar } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/musica-libre`, 60_000);
  // Hasta que la persona toque otro, se ve el ánimo de la canción que suena o el que sugiere el tema.
  const [elegido, setAnimo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  if (!datos?.listo || !datos.canciones?.length || !datos.animos) return null;
  const animo = elegido ?? datos.actual?.animo ?? datos.sugerido ?? "upbeat";

  async function enviar(cuerpo: { cancion: string } | { quitar: true }, ok: string) {
    setEnviando(true);
    setMsg(null);
    try {
      await postJson(`/api/proyectos/${proyectoId}/musica-libre`, cuerpo);
      setMsg({ tipo: "ok", texto: ok });
      await recargar();
      alCambiar();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  const suena = datos.actual
    ? `Suena «${datos.actual.nombre}» (${datos.animos[datos.actual.animo]?.toLowerCase() ?? datos.actual.animo}).`
    : datos.hayMusica
      ? "Suena la música del estilo."
      : "Este video no tiene música.";
  const canciones = datos.canciones.filter((c) => c.animo === animo);

  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="titulo-musica">
      <div>
        <h2 id="titulo-musica" className="font-medium">Música</h2>
        <p className="text-sm text-tenue">{suena} Las de aquí vienen con Geeper y se pueden usar en videos con fines comerciales.</p>
        {datos.hayMusica && !datos.actual && datos.licencia && /desconocid|revisar/i.test(datos.licencia) && (
          <p className="mt-1 text-sm text-amber-200">No se sabe si la música del estilo se puede usar con fines comerciales. Si vas a monetizar el video, mejor elige una de aquí.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="etiqueta">1. ¿Qué ánimo?</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Ánimo de la música">
          {Object.entries(datos.animos).map(([id, nombre]) => (
            <button key={id} type="button" aria-pressed={animo === id} onClick={() => setAnimo(id)}
              className={`rounded-full border px-3 py-1 text-sm ${animo === id ? "border-sky-500 bg-sky-950/40" : "border-borde hover:bg-white/5"}`}>
              {nombre}{id === datos.sugerido ? " · recomendado para este tema" : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="etiqueta">2. Escúchalas y elige una</p>
        <ul className="space-y-2">
          {canciones.map((c) => {
            const es = datos.actual?.id === c.id;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-36 text-sm">{c.nombre} <span className="text-tenue">· {numero(c.segundos, 0)} s, se repite</span></span>
                <audio controls preload="none" src={c.muestra} className="h-7 max-w-56" aria-label={`Escuchar «${c.nombre}»`} />
                {es
                  ? <span className="text-sm text-emerald-300">Es la que suena</span>
                  : <button type="button" className="boton" disabled={ocupado || enviando}
                      onClick={() => void enviar({ cancion: c.id }, `Listo: ahora suena «${c.nombre}». Escúchalo en «En vivo». Para que los cortes caigan al ritmo, usa «Alinear cortes al ritmo» en «Más opciones».`)}>
                      Usar esta
                    </button>}
              </li>
            );
          })}
        </ul>
      </div>

      {datos.hayMusica && (
        <button type="button" className="boton" disabled={ocupado || enviando}
          onClick={() => { if (confirm("¿Quitar la música de este video? Se puede volver a poner aquí mismo.")) void enviar({ quitar: true }, "Listo: el video quedó sin música."); }}>
          Quitar la música
        </button>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </section>
  );
}
