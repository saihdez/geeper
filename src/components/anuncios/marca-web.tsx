"use client";
import { useState } from "react";
import type { PerfilMarca } from "@/lib/anuncios/marca";
import { Aviso, postJson, useSondeo } from "../comun";
import { PaletaDeImagen } from "../paleta-imagen";
import type { Ctx } from "./campana";
import { Campo, Seccion } from "./ui";

type Rol = "acento1" | "acento2" | "activa";
const ROLES: { id: Rol; nombre: string; ayuda: string }[] = [
  { id: "acento1", nombre: "Acento 1", ayuda: "Color principal de la marca" },
  { id: "acento2", nombre: "Acento 2", ayuda: "Color de apoyo" },
  { id: "activa", nombre: "Palabra activa", ayuda: "Resalta la palabra que se dice en los subtítulos: que contraste con fondos oscuros" },
];

/** ads-dna: lee el sitio, separa lo observado de lo inferido y la persona confirma antes de usarlo. */
export function MarcaDesdeWeb({ ctx }: { ctx: Ctx }) {
  const b = ctx.datos.brief;
  const [url, setUrl] = useState(b.destino);
  const [perfil, setPerfil] = useState<PerfilMarca | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eleccion, setEleccion] = useState<{ marca: string; acento1: string; acento2: string; activa: string; cta: string; fuente: string; usarFuente: boolean; nombre: string }>({
    marca: "", acento1: "#ff3d81", acento2: "#ffb347", activa: "#ffd23f", cta: "", fuente: "", usarFuente: false, nombre: "",
  });
  const [rol, setRol] = useState<Rol>("acento1");
  const [creada, setCreada] = useState<string | null>(null);
  const { datos: pl } = useSondeo<{ plantillas: { slug: string; nombre: string }[] }>("/api/plantillas", 60000);

  async function leer(e: React.FormEvent) {
    e.preventDefault();
    setLeyendo(true);
    setError(null);
    setCreada(null);
    try {
      const r = await postJson<{ perfil: PerfilMarca }>("/api/anuncios/marca", { url });
      const p = r.perfil;
      setPerfil(p);
      setEleccion((x) => ({
        ...x,
        marca: p.inferido.marca,
        acento1: p.inferido.acento1 ?? x.acento1,
        acento2: p.inferido.acento2 ?? x.acento2,
        activa: p.inferido.activa ?? x.activa,
        cta: p.inferido.cta ?? "",
        fuente: p.inferido.fuente ?? "",
        nombre: p.inferido.marca,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLeyendo(false);
    }
  }

  function usarEnBrief() {
    if (!perfil) return;
    ctx.cambiar((d) => ({
      ...d,
      brief: {
        ...d.brief,
        marca: eleccion.marca.slice(0, 120),
        producto: d.brief.producto || perfil.observado.descripcion.slice(0, 200),
        destino: d.brief.destino || perfil.url,
        notas: [d.brief.notas, `Marca leída de ${perfil.url} el ${perfil.fecha}: «${perfil.observado.titulo}».`].filter(Boolean).join("\n").slice(0, 2000),
      },
    }));
  }

  async function crearPlantilla() {
    if (!perfil) return;
    setError(null);
    try {
      const base = b.plantilla || pl?.plantillas[0]?.slug;
      if (!base) throw new Error("No hay plantillas de base");
      const r = await postJson<{ plantilla: { slug: string; nombre: string } }>("/api/anuncios/marca/plantilla", {
        nombre: eleccion.nombre || eleccion.marca,
        base,
        marca: eleccion.marca,
        acento1: eleccion.acento1,
        acento2: eleccion.acento2,
        activa: eleccion.activa,
        cta: eleccion.cta || undefined,
        fuente: eleccion.usarFuente && eleccion.fuente ? eleccion.fuente : undefined,
        fuente_url: perfil.url,
      });
      ctx.cambiar((d) => ({ ...d, brief: { ...d.brief, plantilla: r.plantilla.slug } }));
      setCreada(r.plantilla.nombre);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const o = perfil?.observado;
  return (
    <Seccion titulo="Leer la marca desde su web" descripcion="Toma título, colores, fuentes y botones del sitio. Lo inferido es una propuesta: confírmalo antes de usarlo.">
      <form onSubmit={leer} className="flex flex-col gap-2 sm:flex-row">
        <input className="campo" type="url" inputMode="url" required placeholder="https://marca.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Dirección del sitio" />
        <button className="boton boton-primario shrink-0 justify-center" disabled={leyendo || !url}>{leyendo ? "Leyendo…" : "Leer sitio"}</button>
      </form>
      <p className="text-xs text-tenue">Sólo sitios públicos. Úsalo con sitios de marcas propias o de clientes que te autorizaron.</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {perfil && o && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <h4 className="font-semibold">Observado <span className="font-normal text-tenue">· {perfil.fecha}</span></h4>
            <dl className="space-y-1.5">
              {[["Título", o.titulo], ["Sitio", o.sitio], ["Descripción", o.descripcion], ["Titular", o.h1]].filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-tenue">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <div>
              <p className="text-xs text-tenue">Colores (toca uno para asignarlo a «{ROLES.find((r) => r.id === rol)?.nombre}»)</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {o.colores.map((c) => (
                  <button key={c.valor} onClick={() => setEleccion((x) => ({ ...x, [rol]: c.valor }))} className="flex items-center gap-1.5 rounded-md border border-borde bg-[#0f131a] px-1.5 py-1 text-xs hover:border-slate-500" title={`${c.valor} · ${c.veces} veces`}>
                    <span className="h-4 w-4 rounded border border-white/20" style={{ background: c.valor }} />
                    <span className="tabular-nums">{c.valor}</span>
                  </button>
                ))}
                {!o.colores.length && <span className="text-tenue">Ninguno</span>}
              </div>
            </div>
            {o.fuentes.length > 0 && <p><span className="text-xs text-tenue">Fuentes: </span>{o.fuentes.map((f) => f.valor).join(", ")}</p>}
            {o.botones.length > 0 && <p><span className="text-xs text-tenue">Botones: </span>{o.botones.map((f) => `«${f.valor}»`).join(", ")}</p>}
            {perfil.avisos.map((a) => <Aviso key={a} tipo="info">{a}</Aviso>)}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Propuesta (confírmala)</h4>
            <Campo etiqueta="Nombre de la marca"><input className="campo" value={eleccion.marca} maxLength={60} onChange={(e) => setEleccion((x) => ({ ...x, marca: e.target.value }))} /></Campo>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map((r) => (
                // A11-09: el botón y el campo van como hermanos (como ControlColor): un campo dentro de un botón no se puede usar con el teclado.
                <div key={r.id} className={`rounded-lg border p-2 text-xs ${rol === r.id ? "border-cyan-600 bg-cyan-950/40 ring-2 ring-cyan-600" : "border-borde bg-[#0f131a]"}`}>
                  <button type="button" onClick={() => setRol(r.id)} aria-pressed={rol === r.id} title={r.ayuda} className="block w-full text-left">
                    <span className="mb-1 block h-6 rounded" style={{ background: eleccion[r.id] }} />
                    {r.nombre}
                  </button>
                  <input className="mt-1 w-full bg-transparent rounded tabular-nums text-tenue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento" value={eleccion[r.id]} maxLength={7}
                    onFocus={() => setRol(r.id)} onChange={(e) => setEleccion((x) => ({ ...x, [r.id]: e.target.value }))} aria-label={`${r.nombre} en hexadecimal`} />
                </div>
              ))}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-tenue">¿Los colores del sitio no son los de la marca? Sácalos del logo o de una foto</summary>
              <div className="mt-2">
                <PaletaDeImagen etiqueta="Subir logo o foto"
                  alElegir={(hex) => setEleccion((x) => ({ ...x, [rol]: hex }))}
                  alSugerir={(r) => setEleccion((x) => ({ ...x, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) }))} />
              </div>
            </details>
            <div className="rounded-lg p-3 text-center text-lg font-extrabold" style={{ background: "#0b0d12" }} aria-label="Vista de subtítulos">
              <span style={{ color: "#fff" }}>Así se ven </span><span style={{ color: eleccion.activa }}>los</span><span style={{ color: "#fff" }}> subtítulos</span>
              <div className="mt-2 flex justify-center gap-2"><span className="h-2 w-16 rounded" style={{ background: eleccion.acento1 }} /><span className="h-2 w-16 rounded" style={{ background: eleccion.acento2 }} /></div>
            </div>
            <Campo etiqueta="CTA de la tarjeta final"><input className="campo" value={eleccion.cta} maxLength={60} onChange={(e) => setEleccion((x) => ({ ...x, cta: e.target.value }))} placeholder="Deja vacío para usar el de la plantilla base" /></Campo>
            {eleccion.fuente && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={eleccion.usarFuente} onChange={(e) => setEleccion((x) => ({ ...x, usarFuente: e.target.checked }))} />
                <span>Usar «{eleccion.fuente}» en los títulos. <span className="text-tenue">Sólo si verificaste que está disponible para el render y que su licencia lo permite; si no, el video cae en otra fuente.</span></span>
              </label>
            )}
            <Campo etiqueta="Nombre de la plantilla nueva"><input className="campo" value={eleccion.nombre} maxLength={80} onChange={(e) => setEleccion((x) => ({ ...x, nombre: e.target.value }))} /></Campo>
            <div className="flex flex-wrap gap-2">
              <button className="boton" onClick={usarEnBrief} disabled={!eleccion.marca.trim()}>Usar en el brief</button>
              <button className="boton boton-primario" onClick={() => void crearPlantilla()} disabled={!eleccion.marca.trim() || ![eleccion.acento1, eleccion.acento2, eleccion.activa].every((c) => /^#[0-9a-f]{6}$/i.test(c))}>
                Crear plantilla y usarla
              </button>
            </div>
            {creada && <Aviso tipo="ok">Plantilla «{creada}» creada y elegida para esta campaña. Puedes ajustarla en Plantillas.</Aviso>}
          </div>
        </div>
      )}
    </Seccion>
  );
}
