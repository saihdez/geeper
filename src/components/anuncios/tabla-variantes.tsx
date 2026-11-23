"use client";
import { useEffect, useRef, useState } from "react";
import type { Concepto } from "@/lib/anuncios/esquema";
import { leerTabla, MAX_FILAS, problemasDeFila, type FilaVariante } from "@/lib/anuncios/tabla";
import { Aviso, archivo } from "../comun";
import type { Ctx } from "./campana";
import { nuevoId } from "./ui";

const vacia = (): FilaVariante => ({ id: nuevoId("f"), gancho: "", texto: "", imagen: "", cta: "", concepto: null, error: "" });

/**
 * Tabla de variantes: cada fila es un video nuevo, copia del de este concepto con lo que se cambie.
 * Se guarda sola con la campaña (como el resto de la pestaña); «Crear videos» hace las que falten.
 */
export function TablaVariantes({ ctx, c }: { ctx: Ctx; c: Concepto }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const filas = ctx.datos.tablas[c.id] ?? [];
  const [pegar, setPegar] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const ponerFilas = (f: (fs: FilaVariante[]) => FilaVariante[]) =>
    ctx.cambiar((d) => ({ ...d, tablas: { ...d.tablas, [c.id]: f(d.tablas[c.id] ?? []).slice(0, MAX_FILAS) } }));
  const cambiarFila = (id: string, cambios: Partial<FilaVariante>) =>
    ponerFilas((fs) => fs.map((x) => (x.id === id ? { ...x, ...cambios, error: "" } : x)));

  // Al cerrar, se cierra también el cuadro de pegar.
  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    const cerrar = () => setPegar(null);
    d.addEventListener("close", cerrar);
    return () => d.removeEventListener("close", cerrar);
  }, []);
  function abrir() {
    // Abierta por primera vez: dos filas vacías para empezar a escribir.
    if (!filas.length) ponerFilas(() => [vacia(), vacia()]);
    setHecho(null);
    setError(null);
    dialogo.current?.showModal();
  }

  async function subirImagen(filaId: string, f: File) {
    setSubiendo(filaId);
    setError(null);
    try {
      const form = new FormData();
      form.set("archivo", f);
      const r = await fetch(`/api/anuncios/${ctx.id}/imagen`, { method: "POST", body: form });
      const j = (await r.json()) as { ruta?: string; error?: string };
      if (!r.ok || !j.ruta) throw new Error(j.error ?? `Error ${r.status}`);
      cambiarFila(filaId, { imagen: j.ruta });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubiendo(null);
    }
  }

  function agregarPegado(texto: string) {
    const r = leerTabla(texto);
    setAvisos(r.avisos);
    if (!r.filas.length) return;
    ponerFilas((fs) => [...fs.filter((x) => x.concepto || x.gancho || x.texto || x.cta || x.imagen), ...r.filas.map((x) => ({ ...vacia(), ...x }))]);
    setPegar(null);
  }

  const pendientes = filas.filter((f) => !f.concepto);
  const validas = pendientes.filter((f) => !problemasDeFila(f).length);
  const conProblemas = pendientes.filter((f) => problemasDeFila(f).length && (f.gancho || f.texto || f.cta || f.imagen));

  async function crear() {
    setCreando(true);
    setError(null);
    setHecho(null);
    try {
      const r = (await ctx.accion({ tipo: "variantesTabla", concepto: c.id })) as { creados: string[]; errores: number };
      setHecho(`${r.creados.length} video${r.creados.length === 1 ? "" : "s"} en camino: se crean en Trabajos y aparecen como ideas nuevas.${r.errores ? ` ${r.errores} fila${r.errores === 1 ? "" : "s"} con problemas: mira el detalle en la tabla.` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreando(false);
    }
  }

  const hechas = filas.length - pendientes.length;
  return (
    <>
      <button type="button" className="boton w-full justify-center" onClick={abrir} title="Probar varios ganchos, textos, imágenes o botones de una vez">
        ▦ Varias variantes en una tabla{hechas ? ` (${hechas} hechas)` : ""}
      </button>
      <dialog ref={dialogo} className="m-auto max-h-[92vh] w-[min(1200px,96vw)] overflow-y-auto rounded-xl border border-borde bg-[#141821] p-0 text-[#e6e9ef] backdrop:bg-black/70" aria-labelledby={`tv-${c.id}`}>
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={`tv-${c.id}`} className="text-lg font-semibold">Variantes de «{c.nombre}»</h2>
              <p className="text-sm text-tenue">
                Cada fila crea un video nuevo: una copia de éste con lo que cambies en esa fila. Deja vacío lo que no quieras cambiar. El video original no se toca.
                Cambiar el gancho rehace la voz de la primera escena (CPU); todos los videos se renderizan solos, de a uno, en Trabajos.
              </p>
            </div>
            <button type="button" className="boton" onClick={() => dialogo.current?.close()} aria-label="Cerrar">✕</button>
          </div>

          <div className="hidden grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.4fr)_8.5rem_minmax(0,1fr)_2.5rem] gap-2 px-1 text-xs text-tenue lg:grid">
            <span>#</span><span>Gancho (lo primero que se dice)</span><span>Texto en pantalla al inicio</span><span>Imagen del inicio</span><span>Botón final</span><span />
          </div>
          <ol className="space-y-2">
            {filas.map((f, i) => {
              const problemas = f.concepto ? [] : problemasDeFila(f);
              const vaciaFila = !f.gancho && !f.texto && !f.cta && !f.imagen;
              const bloqueada = Boolean(f.concepto);
              return (
                <li key={f.id} className={`grid gap-2 rounded-lg border p-2 lg:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.4fr)_8.5rem_minmax(0,1fr)_2.5rem] lg:items-start ${bloqueada ? "border-emerald-900 bg-emerald-950/20" : f.error ? "border-red-900 bg-red-950/20" : "border-borde bg-[#0f131a]"}`}>
                  <span className="pt-2 text-sm tabular-nums text-tenue">{i + 1}</span>
                  <label className="block">
                    <span className="etiqueta lg:sr-only">Gancho (lo primero que se dice)</span>
                    <textarea className="campo min-h-[2.6rem] text-sm" rows={2} value={f.gancho} maxLength={300} disabled={bloqueada}
                      placeholder={c.gancho ? `Igual que ahora: «${c.gancho.slice(0, 60)}»` : "Igual que ahora"} onChange={(e) => cambiarFila(f.id, { gancho: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="etiqueta lg:sr-only">Texto en pantalla al inicio</span>
                    <input className="campo text-sm" value={f.texto} maxLength={160} disabled={bloqueada} placeholder="Sin texto" onChange={(e) => cambiarFila(f.id, { texto: e.target.value })} />
                  </label>
                  <div>
                    <span className="etiqueta lg:sr-only">Imagen del inicio</span>
                    {f.imagen ? (
                      <div className="flex items-center gap-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={archivo(f.imagen)} alt={`Imagen de la fila ${i + 1}`} className="h-10 w-10 rounded object-cover" />
                        {!bloqueada && <button type="button" className="boton !px-2 !py-1 text-xs" onClick={() => cambiarFila(f.id, { imagen: "" })}>Quitar</button>}
                      </div>
                    ) : bloqueada ? <span className="text-xs text-tenue">Igual que ahora</span> : (
                      <label className="boton cursor-pointer !py-1 text-xs">
                        {subiendo === f.id ? "Subiendo…" : "Elegir imagen"}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={subiendo !== null}
                          onChange={(e) => { const x = e.target.files?.[0]; if (x) void subirImagen(f.id, x); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  <label className="block">
                    <span className="etiqueta lg:sr-only">Botón final</span>
                    <input className="campo text-sm" value={f.cta} maxLength={60} disabled={bloqueada} placeholder="El del estilo del canal" onChange={(e) => cambiarFila(f.id, { cta: e.target.value })} />
                  </label>
                  {!bloqueada ? (
                    <button type="button" className="boton !px-2 justify-center" aria-label={`Quitar la fila ${i + 1}`} title="Quitar fila" onClick={() => ponerFilas((fs) => fs.filter((x) => x.id !== f.id))}>✕</button>
                  ) : <span />}
                  {(bloqueada || f.error || (problemas.length > 0 && !vaciaFila)) && (
                    <p className={`text-xs lg:col-span-5 lg:col-start-2 ${bloqueada ? "text-emerald-300" : "text-red-300"}`}>
                      {bloqueada
                        ? <>✓ Creada. <button type="button" className="underline" onClick={() => { dialogo.current?.close(); ctx.irA("conceptos", f.concepto!); }}>Ver la idea</button></>
                        : f.error || problemas.join("; ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton" disabled={filas.length >= MAX_FILAS} onClick={() => ponerFilas((fs) => [...fs, vacia()])}>+ Agregar fila</button>
            <button type="button" className="boton" onClick={() => setPegar(pegar === null ? "" : null)}>Pegar desde Excel o CSV</button>
            <span className="self-center text-xs text-tenue">Hasta {MAX_FILAS} filas.</span>
          </div>
          {pegar !== null && (
            <div className="space-y-2 rounded-lg border border-borde p-3">
              <p className="text-sm">Copia las celdas en Excel o Google Sheets y pégalas aquí, o abre un archivo .csv. Columnas, en este orden o con estos títulos: <b>gancho</b>, <b>texto en pantalla</b>, <b>botón</b>. Las imágenes se eligen después en cada fila.</p>
              <textarea className="campo min-h-28 font-mono text-xs" value={pegar} onChange={(e) => setPegar(e.target.value)} placeholder={"gancho\ttexto en pantalla\tbotón\n¿Sabías que…?\t50 % OFF\tCompra hoy"} aria-label="Datos pegados" />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="boton boton-primario" disabled={!pegar.trim()} onClick={() => agregarPegado(pegar)}>Agregar filas</button>
                <label className="boton cursor-pointer">
                  Abrir archivo .csv
                  <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { const x = e.target.files?.[0]; if (x) void x.text().then(agregarPegado); e.target.value = ""; }} />
                </label>
              </div>
            </div>
          )}
          {avisos.map((a) => <Aviso key={a} tipo="info">{a}</Aviso>)}
          {error && <Aviso tipo="error">{error}</Aviso>}
          {hecho && <Aviso tipo="ok">{hecho}</Aviso>}

          <div className="flex flex-wrap items-center gap-3 border-t border-borde pt-3">
            <button type="button" className="boton boton-primario" disabled={creando || !validas.length} onClick={() => void crear()}>
              {creando ? "Creando…" : validas.length ? `Crear ${validas.length} video${validas.length === 1 ? "" : "s"}` : "Crear videos"}
            </button>
            <span className="text-sm text-tenue">
              {validas.length
                ? `Se crean ${validas.length} idea${validas.length === 1 ? "" : "s"} nueva${validas.length === 1 ? "" : "s"}${!ctx.datos.prueba.control ? " y la prueba A/B queda armada (este video contra las variantes)" : ""}.`
                : conProblemas.length ? "Revisa las filas marcadas en rojo." : "Escribe al menos un cambio en una fila."}
            </span>
          </div>
        </div>
      </dialog>
    </>
  );
}
