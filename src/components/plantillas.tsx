"use client";
import { useState } from "react";
import type { EstiloPlantilla } from "@/lib/estilos-plantilla";
import { Aviso, Cargando, postJson, useSondeo } from "./comun";
import { EditorPlantilla, EstilosDePartida, MarcaDeWeb, type FilaPlantilla, type RespuestaMarcaWeb } from "./editor-plantilla";
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

type Camino = "web" | "estilo" | "copia";

const CAMINOS: { id: Camino; titulo: string; detalle: string; recomendado?: boolean }[] = [
  { id: "web", titulo: "Desde mi página web", detalle: "Escribe el link y tomamos tus colores, tu letra y tu logo.", recomendado: true },
  { id: "estilo", titulo: "Elegir un estilo", detalle: "¿No tienes página o marca? Elige uno de 15 estilos listos." },
  { id: "copia", titulo: "Copiar una que ya tengo", detalle: "Para probar cambios sin tocar los videos que ya la usan." },
];

/** «Nuevo estilo» en dos pasos: cómo empezar → crear. Al crearla se abre el editor para revisarla. */
function NuevaPlantilla({ plantillas, alCrear, alCerrar }: { plantillas: FilaPlantilla[]; alCrear: (slug: string) => void; alCerrar: () => void }) {
  const [camino, setCamino] = useState<Camino | null>(null);
  const [nombre, setNombre] = useState("");
  const [copia, setCopia] = useState(plantillas[0]?.slug ?? "");
  const [creando, setCreando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function crear(cuerpo: Record<string, unknown>, nombrePorDefecto: string) {
    setCreando(true);
    setFallo(null);
    try {
      const r = await postJson<{ plantilla: { slug: string } }>("/api/plantillas", { nombre: nombre.trim() || nombrePorDefecto, ...cuerpo });
      alCrear(r.plantilla.slug);
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e));
    } finally {
      setCreando(false);
    }
  }

  const desdeWeb = (r: RespuestaMarcaWeb) => {
    const m = r.lectura.marca;
    void crear({ web: { url: r.lectura.url, marca: m.nombre, roles: m.roles, titulos: m.tipografia.titulos.fuente, texto: m.tipografia.texto.fuente, logo: r.logo?.ruta ?? null, cta: r.lectura.cta } }, m.nombre || "Mi canal");
  };
  const desdeEstilo = (e: EstiloPlantilla) => void crear({ estilo: e.id }, e.nombre);

  return (
    <div className="tarjeta space-y-4 border-cyan-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Nuevo estilo</h2>
          <p className="text-sm text-tenue">{camino ? "Paso 2 de 2." : "Paso 1 de 2: ¿cómo quieres empezar?"} Después podrás cambiar todo.</p>
        </div>
        <button type="button" className="boton" onClick={alCerrar}>Cancelar</button>
      </div>
      {!camino && (
        <div className="grid gap-2 sm:grid-cols-3">
          {CAMINOS.map((c) => (
            <button key={c.id} type="button" onClick={() => setCamino(c.id)} className="rounded-lg border border-borde bg-[#0f131a] p-3 text-left hover:border-slate-500">
              <span className="block font-medium">{c.titulo}{c.recomendado && <span className="ml-2 rounded bg-cyan-900/60 px-1.5 py-0.5 text-xs text-cyan-200">Recomendado</span>}</span>
              <span className="block text-xs text-tenue">{c.detalle}</span>
            </button>
          ))}
        </div>
      )}
      {camino && (
        <div className="space-y-3">
          <button type="button" className="text-sm text-tenue underline" onClick={() => { setCamino(null); setFallo(null); }}>← Elegir otra forma</button>
          <label className="block text-sm">
            <span className="etiqueta">Nombre del estilo (opcional)</span>
            <input className="campo" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder={camino === "web" ? "Se usa el nombre de tu marca" : camino === "estilo" ? "Se usa el nombre del estilo" : "Copia de…"} />
          </label>
          {camino === "web" && <MarcaDeWeb alUsar={desdeWeb} textoUsar={creando ? "Creando…" : "Crear mi estilo con esto"} />}
          {camino === "estilo" && (
            <>
              <p className="text-sm text-tenue">Toca el que más te guste: se crea el estilo y se abre para que la revises.</p>
              <EstilosDePartida alElegir={desdeEstilo} />
            </>
          )}
          {camino === "copia" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 text-sm">
                <span className="etiqueta">¿Cuál copiar?</span>
                <select className="campo" value={copia} onChange={(e) => setCopia(e.target.value)}>
                  {plantillas.map((p) => <option key={p.slug} value={p.slug}>{p.nombre}</option>)}
                </select>
              </label>
              <button type="button" className="boton boton-primario" disabled={!copia || creando} onClick={() => void crear({ base: copia }, `${plantillas.find((p) => p.slug === copia)?.nombre ?? "Estilo"} (copia)`)}>
                {creando ? "Creando…" : "Crear la copia"}
              </button>
            </div>
          )}
          {creando && camino === "estilo" && <p className="text-sm text-tenue">Creando el estilo…</p>}
          {fallo && <Aviso tipo="error">{fallo}</Aviso>}
        </div>
      )}
    </div>
  );
}

export function Plantillas({ abrirNueva = false }: { abrirNueva?: boolean }) {
  const { datos, recargar } = useSondeo<{ plantillas: FilaPlantilla[] }>("/api/plantillas", 600_000);
  const [abierta, setAbierta] = useState<string | null>(null);
  // «Color y portada» y el editor no se abren a la vez: el editor guarda la plantilla entera desde su copia.
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // «Nuevo» enlaza a /plantillas?nueva=1 para abrir «Nueva plantilla» directo.
  const [nueva, setNueva] = useState(abrirNueva);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">Estilos del canal</h1>
          <p className="text-sm text-tenue">El aspecto de tus videos: marca, logo, colores, letra y cierre. Cambiar un estilo no toca los videos ya hechos; se aplica cuando los vuelves a crear.</p>
        </div>
        {!nueva && <button type="button" className="boton boton-primario" onClick={() => { setAbierta(null); setColor(null); setNueva(true); }}>Nuevo estilo</button>}
      </div>
      {nueva && datos && (
        <NuevaPlantilla plantillas={datos.plantillas} alCerrar={() => setNueva(false)}
          alCrear={async (slug) => { setNueva(false); await recargar(); setAbierta(slug); setTimeout(() => document.getElementById(`plantilla-${slug}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); }} />
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!datos && <Cargando>Cargando tus estilos…</Cargando>}
      {datos?.plantillas.length === 0 && <p className="text-sm text-tenue">No hay plantillas todavía.</p>}
      {datos?.plantillas.map((p) => (
        <div key={p.slug} id={`plantilla-${p.slug}`} className="tarjeta space-y-4 p-4">
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
