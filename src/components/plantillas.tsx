"use client";
import { useState } from "react";
import { Aviso, postJson, useSondeo } from "./comun";
import { EditorPlantilla, type FilaPlantilla } from "./editor-plantilla";
import { AparienciaPlantilla } from "./apariencia-plantilla";

function Resumen({ p, abierta, alEditar, alDuplicar, alColor }: { p: FilaPlantilla; abierta: boolean; alEditar: () => void; alDuplicar: () => void; alColor: () => void }) {
  const c = p.datos.colores;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex -space-x-1" aria-hidden>
        {[c.acento1, c.acento2, c.activa, c.tinta].map((x, i) => <span key={i} className="h-6 w-6 rounded-full border-2 border-[#141821]" style={{ background: x }} />)}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-medium">{p.nombre}</h2>
        <p className="truncate text-xs text-tenue">
          {p.datos.tipografia.titulos} · {p.usos ? `la usan ${p.usos} proyecto${p.usos === 1 ? "" : "s"}` : "sin proyectos"}{p.datos.descripcion ? ` · ${p.datos.descripcion}` : ""}
        </p>
      </div>
      {!abierta && <button type="button" className="boton boton-primario" onClick={alEditar}>Editar</button>}
      <button type="button" className="boton" onClick={alColor} title="Look de color de los videos y diseño de las portadas">Color y portada</button>
      <button type="button" className="boton" onClick={alDuplicar} title="Crea una copia para probar cambios sin tocar los proyectos que usan ésta">Duplicar</button>
    </div>
  );
}

/** Nombre propuesto para la copia: «<nombre> (copia)», sin pasar de las 80 letras que acepta la API. */
export function nombreCopia(nombre: string): string {
  const sufijo = " (copia)";
  return nombre.trim().slice(0, 80 - sufijo.length) + sufijo;
}

export function Plantillas() {
  const { datos, recargar } = useSondeo<{ plantillas: FilaPlantilla[] }>("/api/plantillas", 600_000);
  const [abierta, setAbierta] = useState<string | null>(null);
  // «Color y portada» y el editor no se abren a la vez: el editor guarda la plantilla entera desde su copia.
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // «Duplicar» abre un campo en la tarjeta: la ventanita del navegador para pedir un texto no existe en la app de escritorio (el botón no hacía nada).
  const [copia, setCopia] = useState<{ base: string; nombre: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function duplicar() {
    const nombre = copia?.nombre.trim();
    if (!copia || !nombre) return;
    setError(null);
    setOcupado(true);
    try {
      const r = await postJson<{ plantilla: { slug: string } }>("/api/plantillas", { nombre, base: copia.base });
      await recargar();
      setCopia(null);
      setColor(null);
      setAbierta(r.plantilla.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Plantillas de canal</h1>
        <p className="text-sm text-tenue">El aspecto de tus videos: marca, logo, colores, letra y cierre. Cambiar una plantilla no toca los videos ya hechos; se aplica cuando vuelves a renderizarlos.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!datos && <p className="text-sm text-tenue">Cargando…</p>}
      {datos?.plantillas.map((p) => (
        <div key={p.slug} className="tarjeta space-y-4 p-4">
          <Resumen p={p} abierta={abierta === p.slug} alEditar={() => { setColor(null); setAbierta(p.slug); }} alDuplicar={() => setCopia({ base: p.slug, nombre: nombreCopia(p.nombre) })} alColor={() => { setAbierta(null); setColor(color === p.slug ? null : p.slug); }} />
          {copia?.base === p.slug && (
            <form className="flex flex-wrap items-end gap-2 border-t border-borde pt-4" onSubmit={(e) => { e.preventDefault(); void duplicar(); }}>
              <label className="min-w-0 flex-1">
                <span className="etiqueta">Nombre de la copia</span>
                <input autoFocus className="campo" value={copia.nombre} maxLength={80} onChange={(e) => setCopia({ ...copia, nombre: e.target.value })} />
              </label>
              <button type="submit" className="boton boton-primario" disabled={ocupado || !copia.nombre.trim()}>{ocupado ? "Creando…" : "Crear copia"}</button>
              <button type="button" className="boton" onClick={() => setCopia(null)}>Cancelar</button>
              {!copia.nombre.trim() && <p className="w-full text-xs text-tenue">Escribe un nombre para la copia.</p>}
            </form>
          )}
          {abierta === p.slug && <EditorPlantilla key={p.slug} fila={p} alGuardar={() => void recargar()} alCerrar={() => setAbierta(null)} />}
          {color === p.slug && (
            <div className="space-y-3 border-t border-borde pt-4">
              <AparienciaPlantilla slug={p.slug} alCambiar={() => void recargar()} />
              <button type="button" className="boton" onClick={() => setColor(null)}>Cerrar</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
