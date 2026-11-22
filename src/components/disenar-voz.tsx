"use client";
import { useEffect, useRef, useState } from "react";
import { Aviso, archivo, pedir, postJson, useSondeo } from "./comun";

interface Diseno { estado: string; etapa: string; error: string | null; tomas: string[] }
interface Instalacion { disponible: boolean; instalada: boolean; corriendo: boolean; error: string | null; pasos: { id: string; nombre: string; estado: string }[] }

export interface VozDisenada { id: string; nombre: string }

const EJEMPLOS = [
  "Narradora cálida y tranquila, como de documental",
  "Locutor de radio con energía, voz clara y alegre",
  "Narrador de voz grave y misteriosa, ritmo pausado",
  "Voz de caricatura muy aguda y nasal, alegre y acelerada, con risa contagiosa",
  "Mujer joven y cercana, como una amiga que cuenta algo curioso",
];

const ICONO: Record<string, string> = { pendiente: "○", trabajando: "◔", listo: "✓", error: "✗" };

/** Cuando falta VoxCPM2: instalarlo aquí mismo, con su avance (una vez, unos 10 GB). */
function InstalarVoces({ alTerminar }: { alTerminar: () => void }) {
  const { datos, recargar } = useSondeo<Instalacion>("/api/sistema/voxcpm", 3000);
  const [error, setError] = useState<string | null>(null);
  const avisado = useRef(false);
  useEffect(() => {
    if (datos?.instalada && !avisado.current) {
      avisado.current = true;
      alTerminar();
    }
  }, [datos?.instalada, alTerminar]);
  if (!datos) return <p className="text-xs text-tenue">Revisando…</p>;
  if (!datos.disponible) return <p className="text-xs text-tenue">Crear voces nuevas necesita una tarjeta gráfica NVIDIA; en esta computadora todavía no se puede. Las voces de siempre sí funcionan.</p>;
  return (
    <div className="space-y-2 rounded-lg border border-borde p-3">
      <p className="text-sm">Para crear voces describiéndolas hay que instalar el creador de voces (VoxCPM2) una vez. Baja unos 10 GB y tarda de 15 a 40 minutos según tu internet. Todo queda en esta computadora y es gratis.</p>
      {datos.corriendo || datos.pasos.some((p) => p.estado !== "pendiente") ? (
        <ul className="space-y-0.5 text-sm" role="status">
          {datos.pasos.map((p) => (
            <li key={p.id} className={p.estado === "error" ? "text-red-300" : p.estado === "listo" ? "text-emerald-300" : ""}>{ICONO[p.estado] ?? "○"} {p.nombre}</li>
          ))}
        </ul>
      ) : null}
      {datos.error && <Aviso tipo="error">No se pudo instalar: {datos.error}</Aviso>}
      {!datos.corriendo && (
        <button type="button" className="boton boton-primario" onClick={() => {
          setError(null);
          postJson("/api/sistema/voxcpm", {}).then(recargar, (e: Error) => setError(e.message));
        }}>{datos.error ? "Intentar de nuevo" : "Instalar el creador de voces"}</button>
      )}
      {datos.corriendo && <p className="text-xs text-tenue">Puedes seguir usando Geeper mientras tanto; esto sigue solo.</p>}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}

/**
 * Crear una voz nueva describiéndola: 3 opciones para escuchar, se elige una, se le pone nombre y queda en
 * la biblioteca de voces. Se usa en la voz del proyecto y en el paso «Nombre y voz» del avatar.
 */
export function DisenarVoz({ instalada, nombreSugerido = "", alGuardar, alCancelar, alInstalar }: {
  instalada: boolean;
  nombreSugerido?: string;
  alGuardar: (v: VozDisenada) => void;
  alCancelar: () => void;
  /** VoxCPM2 quedó instalado: recargar la lista de voces. */
  alInstalar: () => void;
}) {
  const [descripcion, setDescripcion] = useState("");
  const [pedido, setPedido] = useState<{ propuesta: string; trabajo: string } | null>(null);
  const [diseno, setDiseno] = useState<Diseno | null>(null);
  const [elegida, setElegida] = useState(1);
  const [nombre, setNombre] = useState(nombreSugerido);
  const [error, setError] = useState<string | null>(null);

  // Mientras se diseña, se consulta el avance cada 3 s.
  useEffect(() => {
    if (!pedido) return;
    let vivo = true;
    const tick = async () => {
      try {
        const d = await pedir<Diseno>(`/api/voces/disenar?propuesta=${pedido.propuesta}&trabajo=${pedido.trabajo}`);
        if (!vivo) return;
        setDiseno(d);
        if (d.estado === "pendiente" || d.estado === "corriendo") setTimeout(() => void tick(), 3000);
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    };
    void tick();
    return () => {
      vivo = false;
    };
  }, [pedido]);

  if (!instalada) return <InstalarVoces alTerminar={alInstalar} />;

  async function disenar() {
    setError(null);
    setDiseno(null);
    try {
      setPedido(await postJson<{ propuesta: string; trabajo: string }>("/api/voces/disenar", { descripcion }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardar() {
    if (!pedido) return;
    setError(null);
    try {
      const r = await postJson<{ voz: VozDisenada }>("/api/voces", { propuesta: pedido.propuesta, toma: elegida, nombre: nombre.trim() || descripcion.slice(0, 40) });
      alGuardar(r.voz);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const otraVez = () => { setPedido(null); setDiseno(null); };

  return (
    <div className="space-y-2 rounded-lg border border-borde p-3">
      <label className="etiqueta" htmlFor="desc-voz">¿Cómo quieres que suene? Descríbela con tus palabras</label>
      <textarea id="desc-voz" className="campo min-h-16" maxLength={300} value={descripcion} disabled={Boolean(pedido)}
        placeholder="Por ejemplo: narradora cálida y tranquila, como de documental" onChange={(e) => setDescripcion(e.target.value)} />
      {!pedido && (
        <div className="flex flex-wrap gap-1">
          {EJEMPLOS.map((e) => <button key={e} type="button" className="rounded-full border border-borde px-2 py-0.5 text-xs hover:bg-white/5" onClick={() => setDescripcion(e)}>{e}</button>)}
        </div>
      )}
      <p className="text-xs text-tenue">
        Describe cómo suena, no a quién se parece: tono (aguda o grave), timbre (nasal, ronca, suave), ritmo, ánimo y edad. El creador no conoce personajes ni famosos por su nombre, así que los ignora. Sólo voces inventadas: no imites a una persona real.
      </p>
      <p className="text-xs text-tenue">Se crean 3 opciones distintas para que elijas. Tarda unos 2 minutos y usa la tarjeta gráfica (si está ocupada, espera su turno).</p>
      {!pedido && (
        <div className="flex gap-2">
          <button type="button" className="boton boton-primario" disabled={descripcion.trim().length < 8} onClick={() => void disenar()}>Crear 3 opciones</button>
          <button type="button" className="boton" onClick={alCancelar}>Cancelar</button>
        </div>
      )}
      {pedido && diseno && (diseno.estado === "pendiente" || diseno.estado === "corriendo") && (
        <p className="text-sm" role="status">{diseno.estado === "pendiente" ? "En la fila, esperando su turno…" : diseno.etapa || "Creando las voces…"}</p>
      )}
      {pedido && diseno?.estado === "fallido" && (
        <Aviso tipo="error">
          No se pudieron crear las voces: {diseno.error}
          <button type="button" className="boton ml-2" onClick={otraVez}>Probar de nuevo</button>
        </Aviso>
      )}
      {pedido && diseno?.estado === "hecho" && (
        <fieldset className="space-y-2">
          <legend className="etiqueta">Escucha las opciones y quédate con la que más te guste</legend>
          {diseno.tomas.map((t, i) => (
            <label key={t} className={`flex items-center gap-2 rounded border p-2 ${elegida === i + 1 ? "border-sky-500" : "border-borde"}`}>
              <input type="radio" name="toma" checked={elegida === i + 1} onChange={() => setElegida(i + 1)} />
              <span className="w-20 shrink-0 text-sm">Opción {i + 1}</span>
              <audio controls preload="none" src={archivo(t)} className="h-8 w-full" />
            </label>
          ))}
          <label className="etiqueta" htmlFor="nombre-voz">Ponle un nombre</label>
          <input id="nombre-voz" className="campo" maxLength={60} value={nombre} placeholder="Por ejemplo: Narradora del canal" onChange={(e) => setNombre(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton boton-primario" onClick={() => void guardar()}>Guardar esta voz</button>
            <button type="button" className="boton" onClick={otraVez}>Ninguna me gusta: describir otra vez</button>
          </div>
        </fieldset>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
    </div>
  );
}
