"use client";
import { useState } from "react";
import { Aviso, archivo, postJson, useSondeo } from "./comun";

interface Datos {
  instalado: boolean;
  presets: { id: string; nombre: string; segundos: number }[];
  biblioteca: { id: string; nombre: string; segundos: number; muestra: string }[];
}
type Eleccion = { tipo: "preset"; id: string; nombre: string } | { tipo: "biblioteca"; id: string; nombre: string } | { tipo: "propio" };

/**
 * Efectos de sonido en 3 pasos: qué sonido (uno listo, uno ya creado o descrito con palabras), cuándo
 * suena (al empezar una escena o en un segundo exacto) y agregar. Los ya creados entran al instante;
 * uno nuevo se crea con la tarjeta gráfica (~3 min) y se agrega solo al terminar.
 */
export function PanelEfectosSonido({ proyectoId, escenas, total, ocupado, alCambiar }: {
  proyectoId: string;
  escenas: { numero: number; inicio: number }[];
  total: number;
  ocupado: boolean;
  alCambiar: () => void;
}) {
  const { datos } = useSondeo<Datos>("/api/efectos", 30_000);
  const [eleccion, setEleccion] = useState<Eleccion | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [segundos, setSegundos] = useState(3);
  const [cuando, setCuando] = useState<string>("escena-1");
  const [exacto, setExacto] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error" | "info"; texto: string } | null>(null);

  if (datos && !datos.instalado && !datos.biblioteca.length) return null;
  const inicio = cuando === "exacto" ? exacto : (escenas.find((e) => `escena-${e.numero}` === cuando)?.inicio ?? 0);

  async function agregar() {
    if (!eleccion) return;
    setEnviando(true);
    setMsg(null);
    try {
      const cuerpo = eleccion.tipo === "biblioteca" ? { biblioteca: eleccion.id, inicio } : eleccion.tipo === "preset" ? { preset: eleccion.id, inicio } : { descripcion, segundos, inicio };
      const r = await postJson<{ listo: boolean; efecto?: string }>(`/api/proyectos/${proyectoId}/efecto`, cuerpo);
      setMsg(r.listo
        ? { tipo: "ok", texto: `Listo: «${r.efecto}» suena en el segundo ${inicio.toFixed(1)}. Escúchalo en «En vivo»; si no te convence, quítalo en «Superposiciones y efectos de sonido».` }
        : { tipo: "info", texto: "Creando el sonido con la tarjeta de video (unos 3 minutos). Se agrega solo al terminar; el avance está en «Trabajos». Queda guardado para usarlo otra vez al instante." });
      alCambiar();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  const chip = (activo: boolean, texto: string, onClick: () => void, key: string) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={activo}
      className={`rounded-full border px-3 py-1 text-sm ${activo ? "border-sky-500 bg-sky-950/40" : "border-borde hover:bg-white/5"}`}>{texto}</button>
  );
  const listo = eleccion && (eleccion.tipo !== "propio" || descripcion.trim().length >= 3);

  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="titulo-efectos">
      <div>
        <h2 id="titulo-efectos" className="font-medium">Efectos de sonido</h2>
        <p className="text-sm text-tenue">Un whoosh al cambiar de escena, un golpe cuando aparece un título, olas de fondo… Se suman a la voz y la música.</p>
      </div>

      <div className="space-y-2">
        <p className="etiqueta">1. ¿Qué sonido?</p>
        {datos && datos.biblioteca.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-tenue">Ya creados (entran al instante):</p>
            <ul className="space-y-1">
              {datos.biblioteca.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2">
                  {chip(eleccion?.tipo === "biblioteca" && eleccion.id === b.id, `${b.nombre} · ${b.segundos} s`, () => setEleccion({ tipo: "biblioteca", id: b.id, nombre: b.nombre }), b.id)}
                  <audio controls preload="none" src={archivo(b.muestra)} className="h-7 max-w-56" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {datos?.instalado && (
          <>
            <p className="text-xs text-tenue">Para crear (la primera vez tardan unos 3 minutos):</p>
            <div className="flex flex-wrap gap-1">
              {datos.presets.filter((p) => !datos.biblioteca.some((b) => b.nombre === p.nombre)).map((p) =>
                chip(eleccion?.tipo === "preset" && eleccion.id === p.id, p.nombre, () => setEleccion({ tipo: "preset", id: p.id, nombre: p.nombre }), p.id))}
              {chip(eleccion?.tipo === "propio", "Otro: lo describo yo", () => setEleccion({ tipo: "propio" }), "propio")}
            </div>
            {eleccion?.tipo === "propio" && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input className="campo" maxLength={300} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Por ejemplo: puerta de madera vieja que rechina al abrirse" aria-label="Describe el sonido" />
                <label className="flex items-center gap-2 text-sm">Dura
                  <select className="campo w-auto" value={segundos} onChange={(e) => setSegundos(Number(e.target.value))}>
                    {[1, 2, 3, 5, 8, 10, 15].map((s) => <option key={s} value={s}>{s} s</option>)}
                  </select>
                </label>
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-1">
        <label className="etiqueta" htmlFor="cuando-efecto">2. ¿Cuándo suena?</label>
        <div className="flex flex-wrap items-center gap-2">
          <select id="cuando-efecto" className="campo w-auto" value={cuando} onChange={(e) => setCuando(e.target.value)}>
            {escenas.map((e) => <option key={e.numero} value={`escena-${e.numero}`}>Al empezar la escena {e.numero} ({e.inicio.toFixed(1)} s)</option>)}
            <option value="exacto">En un segundo exacto…</option>
          </select>
          {cuando === "exacto" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="number" className="campo w-24" min={0} max={Math.max(0, total - 0.5)} step={0.1} value={exacto} onChange={(e) => setExacto(Math.max(0, Number(e.target.value)))} />
              segundos (el video dura {total.toFixed(1)} s)
            </label>
          )}
        </div>
      </div>

      <button type="button" className="boton boton-primario" disabled={!listo || ocupado || enviando} onClick={() => void agregar()}>
        {enviando ? "Agregando…" : eleccion?.tipo === "biblioteca" ? "3. Agregar al video" : "3. Crear y agregar al video"}
      </button>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </section>
  );
}
