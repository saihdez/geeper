"use client";
import { useState } from "react";
import { Aviso, archivo, pedir, useSondeo } from "./comun";
import { DisenarVoz } from "./disenar-voz";

interface Kokoro { voz: string; nombre: string; detalle: string }
interface Guardada { id: string; nombre: string; descripcion: string; muestra: string }
interface Voces { instalada: boolean; licencia: string; kokoro: Kokoro[]; guardadas: Guardada[] }

export type MotorVoz = "kokoro" | "mpt" | "voxcpm";

/** ¿Es ésta la voz que tiene el proyecto? (MPT antepone «kokoro:»). */
function enUso(actual: { motor: string; voz: string }, motor: MotorVoz, voz: string): boolean {
  if (motor === "voxcpm") return actual.motor === "voxcpm" && actual.voz === voz;
  return actual.motor !== "voxcpm" && actual.voz.split(":").pop() === voz;
}

function Escuchar({ ruta, kokoro }: { ruta?: string; kokoro?: string }) {
  const [src, setSrc] = useState<string | null>(ruta ? archivo(ruta) : null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (src) return <audio controls preload="none" src={src} className="h-8 w-full" />;
  return (
    <div className="space-y-1">
      <button type="button" className="boton" disabled={cargando} onClick={() => {
        setCargando(true);
        pedir<{ ruta: string }>(`/api/voces/muestra?kokoro=${kokoro}`)
          .then((r) => setSrc(archivo(r.ruta)))
          .catch((e: Error) => setError(e.message))
          .finally(() => setCargando(false));
      }}>{cargando ? "Preparando la muestra…" : "▶ Escuchar"}</button>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

/**
 * Elegir la voz del video escuchándola (no por el nombre del modelo) y crear una nueva describiéndola.
 * `usar` cambia la voz del proyecto y ofrece ponerla en el video (regenerar el guion completo).
 */
export function ElegirVoz({ actual, idioma, usar, ocupado }: { actual: { motor: string; voz: string }; idioma: string; usar: (motor: MotorVoz, voz: string, nombre: string) => Promise<void>; ocupado: boolean }) {
  const { datos, recargar } = useSondeo<Voces>(`/api/voces?idioma=${encodeURIComponent(idioma)}`, 60_000);
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const tarjeta = (clave: string, titulo: string, detalle: string, escuchar: React.ReactNode, motor: MotorVoz, voz: string) => {
    const usa = enUso(actual, motor, voz);
    return (
      <li key={clave} className={`space-y-2 rounded-lg border p-3 ${usa ? "border-sky-500 bg-sky-950/30" : "border-borde"}`}>
        <div>
          <p className="font-medium">{titulo}{usa && <span className="ml-2 rounded bg-sky-800 px-1.5 py-0.5 text-xs">En uso</span>}</p>
          <p className="text-xs text-tenue">{detalle}</p>
        </div>
        {escuchar}
        {!usa && <button type="button" className="boton" disabled={ocupado} onClick={() => void usar(motor, voz, titulo)}>Usar esta voz</button>}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-medium">Voz del video</h3>
        <p className="text-xs text-tenue">Escucha cada una y elige la que más te guste. Al cambiarla, la voz nueva dice el mismo guion y los subtítulos se acomodan solos.</p>
      </div>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(datos?.kokoro ?? []).map((k) => tarjeta(k.voz, k.nombre, `${k.detalle} · rápida, no usa la tarjeta gráfica`, <Escuchar kokoro={k.voz} />, "kokoro", k.voz))}
        {(datos?.guardadas ?? []).map((g) => tarjeta(g.id, g.nombre, `Creada por ti: «${g.descripcion}» · más natural, usa la tarjeta gráfica`, <Escuchar ruta={g.muestra} />, "voxcpm", g.id))}
      </ul>

      {datos && (abierto ? (
        <DisenarVoz instalada={datos.instalada} alInstalar={recargar} alCancelar={() => setAbierto(false)} alGuardar={(v) => {
          setAviso(`«${v.nombre}» quedó guardada en tu biblioteca de voces. Ya puedes usarla en este y en cualquier otro video.`);
          setAbierto(false);
          recargar();
        }} />
      ) : (
        <button type="button" className="boton" onClick={() => setAbierto(true)}>+ Crear una voz nueva describiéndola</button>
      ))}
    </div>
  );
}
