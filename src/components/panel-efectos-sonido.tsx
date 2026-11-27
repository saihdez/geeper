"use client";
import { useState } from "react";
import { Aviso, AvisoTarjeta, LineaFalta, archivo, faltanConGuardar, numero, postJson, useGuardeAntes, useSondeo } from "./comun";

interface Datos {
  instalado: boolean;
  grupos: Record<string, string>;
  libres: { id: string; nombre: string; grupo: string; segundos: number; muestra: string }[];
  presets: { id: string; nombre: string; segundos: number }[];
  biblioteca: { id: string; nombre: string; segundos: number; muestra: string }[];
}
type Eleccion =
  | { tipo: "libre"; id: string; nombre: string; muestra: string }
  | { tipo: "preset"; id: string; nombre: string }
  | { tipo: "biblioteca"; id: string; nombre: string }
  | { tipo: "propio" };

/**
 * Efectos de sonido en 3 pasos: qué sonido (uno de los que vienen con Geeper, uno ya creado o uno
 * descrito con palabras), cuándo suena (al empezar una escena o en un segundo exacto) y agregar. Los que
 * vienen con Geeper (CC0, audio-libre/) y los ya creados entran al instante; uno nuevo se crea con la
 * tarjeta de video (~3 min) y se agrega solo al terminar.
 */
export function PanelEfectosSonido({ proyectoId, escenas, total, ocupado, alCambiar }: {
  proyectoId: string;
  escenas: { numero: number; inicio: number }[];
  total: number;
  ocupado: boolean;
  alCambiar: () => void;
}) {
  const { datos } = useSondeo<Datos>("/api/efectos", 30_000);
  const solos = useSondeo<{ puestos: number; posibles: number }>(`/api/proyectos/${proyectoId}/sonidos-solos`, 60_000);
  const [eleccion, setEleccion] = useState<Eleccion | null>(null);
  const [grupo, setGrupo] = useState("transicion");
  const [descripcion, setDescripcion] = useState("");
  const [segundos, setSegundos] = useState(3);
  const [cuando, setCuando] = useState<string>("escena-1");
  const [exacto, setExacto] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error" | "info"; texto: string } | null>(null);
  const guarde = useGuardeAntes();

  if (datos && !datos.instalado && !datos.biblioteca.length && !datos.libres.length) return null;
  const inicio = cuando === "exacto" ? exacto : (escenas.find((e) => `escena-${e.numero}` === cuando)?.inicio ?? 0);

  async function agregar() {
    if (!eleccion) return;
    setEnviando(true);
    setMsg(null);
    try {
      const cuerpo = eleccion.tipo === "libre" ? { libre: eleccion.id, inicio } : eleccion.tipo === "biblioteca" ? { biblioteca: eleccion.id, inicio } : eleccion.tipo === "preset" ? { preset: eleccion.id, inicio } : { descripcion, segundos, inicio };
      const r = await postJson<{ listo: boolean; efecto?: string }>(`/api/proyectos/${proyectoId}/efecto`, cuerpo);
      setMsg(r.listo
        ? { tipo: "ok", texto: `Listo: «${r.efecto}» suena en el segundo ${numero(inicio, 1)}. Escúchalo en «En vivo»; si no te convence, quítalo en «Superposiciones y efectos de sonido».` }
        : { tipo: "info", texto: "Creando el sonido con la tarjeta de video (unos 3 minutos). Se agrega solo al terminar; el avance está en «Trabajos». Queda guardado para usarlo otra vez al instante." });
      alCambiar();
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  async function sonidosSolos(quitar: boolean) {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await postJson<{ puestos: number }>(`/api/proyectos/${proyectoId}/sonidos-solos`, { quitar });
      setMsg({ tipo: "ok", texto: quitar ? "Listo: quité los sonidos automáticos. Los que elegiste a mano siguen." : `Listo: puse ${r.puestos} sonidos. Escúchalo en «En vivo».` });
      await solos.recargar();
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
  // Uno libre o ya creado entra al instante; uno nuevo se crea con toda la tarjeta de video.
  const crea = !!eleccion && eleccion.tipo !== "biblioteca" && eleccion.tipo !== "libre";
  const faltaGuardar = crea ? faltanConGuardar(guarde) : [];

  return (
    <section className="tarjeta space-y-3 p-4" aria-labelledby="titulo-efectos">
      <div>
        <h2 id="titulo-efectos" className="font-medium">Efectos de sonido</h2>
        <p className="text-sm text-tenue">Un whoosh al cambiar de escena, un golpe cuando aparece un título, olas de fondo… Se suman a la voz y la música.</p>
      </div>

      {datos && datos.libres.length > 0 && solos.datos && (solos.datos.posibles > 0 || solos.datos.puestos > 0) && (
        <div className="space-y-2 rounded-lg border border-borde p-3">
          <p className="text-sm"><strong>Lo más fácil:</strong> un whoosh suave en cada cambio de escena y un pop cuando aparece un texto.
            {solos.datos.puestos > 0 ? ` Ya hay ${solos.datos.puestos} puestos así.` : ` Serían ${solos.datos.posibles}.`}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton boton-primario" disabled={ocupado || enviando} onClick={() => void sonidosSolos(false)}>
              {solos.datos.puestos > 0 ? "Ponerlos de nuevo" : "Poner sonidos solos"}
            </button>
            {solos.datos.puestos > 0 && <button type="button" className="boton" disabled={ocupado || enviando} onClick={() => void sonidosSolos(true)}>Quitar los automáticos</button>}
          </div>
          <p className="text-xs text-tenue">Al instante, sin tarjeta de video. Quitarlos no toca los que elijas abajo.</p>
        </div>
      )}

      <div className="space-y-2">
        <p className="etiqueta">{datos && datos.libres.length > 0 ? "O elige uno por uno — 1. ¿Qué sonido?" : "1. ¿Qué sonido?"}</p>
        {datos && datos.libres.length > 0 && (
          <div className="space-y-2">
            <label className="flex flex-wrap items-center gap-2 text-xs text-tenue" htmlFor="grupo-libre">
              Listos al instante (vienen con Geeper, libres para usar en videos con fines comerciales):
              <select id="grupo-libre" className="campo w-auto text-sm" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                {Object.entries(datos.grupos).map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-1">
              {datos.libres.filter((l) => l.grupo === grupo).map((l) =>
                chip(eleccion?.tipo === "libre" && eleccion.id === l.id, `${l.nombre} · ${numero(l.segundos, 1)} s`, () => setEleccion({ tipo: "libre", id: l.id, nombre: l.nombre, muestra: l.muestra }), l.id))}
            </div>
            {eleccion?.tipo === "libre" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Escúchalo: <audio key={eleccion.id} controls autoPlay preload="auto" src={eleccion.muestra} className="h-7 max-w-56" aria-label={`Escuchar «${eleccion.nombre}»`} />
              </div>
            )}
          </div>
        )}
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
            <p className="text-xs text-tenue">Para crear con la tarjeta de video (la primera vez tardan unos 3 minutos):</p>
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
            {escenas.map((e) => <option key={e.numero} value={`escena-${e.numero}`}>Al empezar la escena {e.numero} ({numero(e.inicio, 1)} s)</option>)}
            <option value="exacto">En un segundo exacto…</option>
          </select>
          {cuando === "exacto" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="number" className="campo w-24" min={0} max={Math.max(0, total - 0.5)} step={0.1} value={exacto} onChange={(e) => setExacto(Math.max(0, Number(e.target.value)))} />
              segundos (el video dura {numero(total, 1)} s)
            </label>
          )}
        </div>
      </div>

      {crea && <AvisoTarjeta g={guarde}>Crear el sonido tarda unos 3 minutos.</AvisoTarjeta>}
      <div className="space-y-1">
        <button type="button" className="boton boton-primario" disabled={!listo || ocupado || enviando || faltaGuardar.length > 0}
          aria-describedby={faltaGuardar.length ? guarde.idFalta : undefined} onClick={() => void agregar()}>
          {enviando ? "Agregando…" : crea ? "3. Crear y agregar al video" : "3. Agregar al video"}
        </button>
        <LineaFalta id={guarde.idFalta} faltan={faltaGuardar} />
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </section>
  );
}
