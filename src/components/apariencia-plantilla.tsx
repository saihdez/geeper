"use client";
import { useState } from "react";
import { Aviso, archivo, pedir, useSondeo } from "./comun";

interface Muestra { id: string; nombre: string; descripcion: string; imagen: string }
interface Datos {
  color: { look: string; intensidad: number; mejora: boolean };
  estilo: string;
  propios: Partial<Record<"16:9" | "9:16" | "1:1", string>>;
  herramienta: boolean;
  muestras: { looks: Muestra[]; estilos: Muestra[] } | null;
}
interface Revision { ok: boolean; encontradas: string[]; faltan: string[]; extra: string[]; problemas: string[] }

const NOMBRE_FORMATO: Record<string, string> = { "16:9": "horizontal (YouTube)", "9:16": "vertical (Shorts, Reels, TikTok)", "1:1": "cuadrado" };

/**
 * «Color y portada» de una plantilla, pensado para cualquiera: elegir el look de color mirando muestras,
 * activar la mejora automática, elegir el diseño de portada y, si se quiere, subir uno propio (.psd).
 * Cada cambio se guarda al hacer clic; sólo toca el color y la portada de la plantilla.
 */
export function AparienciaPlantilla({ slug, alCambiar }: { slug: string; alCambiar?: () => void }) {
  const [intensidad, setIntensidad] = useState<number | null>(null);
  const url = `/api/plantillas/${slug}/apariencia${intensidad !== null ? `?intensidad=${intensidad}` : ""}`;
  const { datos: d, error: errorCarga, recargar } = useSondeo<Datos>(url, 600_000);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [revision, setRevision] = useState<{ formato: string; revision: Revision; muestra: string | null } | null>(null);

  async function guardar(cambio: object, ok: string) {
    setOcupado(true);
    setMsg(null);
    try {
      await pedir(`/api/plantillas/${slug}/apariencia`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(cambio) });
      await recargar();
      alCambiar?.();
      setMsg({ tipo: "ok", t: ok });
    } catch (e) {
      setMsg({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function subir(f: File) {
    setOcupado(true);
    setMsg(null);
    setRevision(null);
    try {
      const fd = new FormData();
      fd.set("archivo", f);
      const r = await pedir<{ formato: string; revision: Revision; muestra: string | null }>(`/api/plantillas/${slug}/portada-propia`, { method: "POST", body: fd });
      setRevision(r);
      if (r.revision.ok) {
        await recargar();
        alCambiar?.();
      }
    } catch (e) {
      setMsg({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function quitar(formato: string) {
    setOcupado(true);
    try {
      await pedir(`/api/plantillas/${slug}/portada-propia?formato=${encodeURIComponent(formato)}`, { method: "DELETE" });
      setRevision(null);
      await recargar();
      alCambiar?.();
    } catch (e) {
      setMsg({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  if (errorCarga && !d) return <Aviso tipo="error">{errorCarga}</Aviso>;
  if (!d) return <p className="text-sm text-tenue">Preparando las muestras… (la primera vez tarda unos segundos)</p>;
  if (!d.herramienta || !d.muestras) {
    return <Aviso tipo="alerta">Para elegir colores y portadas hace falta una herramienta gratuita. <a className="underline" href="/sistema">Instálala con un clic en Sistema</a> y vuelve aquí.</Aviso>;
  }
  const pct = Math.round((intensidad ?? d.color.intensidad) * 100);

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby={`color-${slug}`}>
        <div>
          <h3 id={`color-${slug}`} className="font-medium">Color de los videos</h3>
          <p className="text-sm text-tenue">Un «look» le da a todos los videos del canal el mismo estilo de color. Los textos y la marca no cambian.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="Look de color">
          {d.muestras.looks.map((l) => {
            const sel = l.id === d.color.look;
            return (
              <button key={l.id} type="button" role="radio" aria-checked={sel} disabled={ocupado} title={l.descripcion}
                onClick={() => !sel && void guardar({ color: { look: l.id } }, `Look «${l.nombre}» guardado. Se ve en la vista previa y la próxima vez que crees el video.`)}
                className={`overflow-hidden rounded border-2 text-left text-sm ${sel ? "border-sky-400" : "border-transparent hover:border-borde"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- muestra local */}
                <img src={archivo(l.imagen)} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                <span className="block px-2 py-1 font-medium">{sel ? "✓ " : ""}{l.nombre}</span>
              </button>
            );
          })}
        </div>
        {d.color.look !== "ninguno" && (
          <label className="flex flex-wrap items-center gap-3 text-sm">
            Cuánto se nota: <strong className="tabular-nums">{pct} %</strong>
            {/* Sin `disabled` mientras guarda: con el teclado perdería el foco en cada paso. Guarda al soltar. */}
            <input type="range" min={10} max={100} step={10} value={pct} aria-busy={ocupado} className="w-48"
              onChange={(e) => setIntensidad(Number(e.target.value) / 100)}
              onPointerUp={(e) => void guardar({ color: { intensidad: Number((e.target as HTMLInputElement).value) / 100 } }, "Intensidad guardada.")}
              onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void guardar({ color: { intensidad: Number((e.target as HTMLInputElement).value) / 100 } }, "Intensidad guardada."); }} />
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={d.color.mejora} disabled={ocupado}
            onChange={(e) => void guardar({ color: { mejora: e.target.checked } }, e.target.checked ? "Mejora automática activada." : "Mejora automática desactivada.")} />
          <span>
            <strong>Mejorar automáticamente las imágenes hechas con IA</strong>
            <span className="block text-tenue">Corrige imágenes lavadas u oscuras y les da un poco más de vida. No toca los videos que subas tú.</span>
          </span>
        </label>
      </section>

      <section className="space-y-3" aria-labelledby={`portada-${slug}`}>
        <div>
          <h3 id={`portada-${slug}`} className="font-medium">Diseño de las portadas</h3>
          <p className="text-sm text-tenue">El diseño que se usa por defecto al crear la portada de cada video (en cada video se puede cambiar).</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Diseño de portada">
          {d.muestras.estilos.map((s) => {
            const sel = s.id === d.estilo;
            return (
              <button key={s.id} type="button" role="radio" aria-checked={sel} disabled={ocupado}
                onClick={() => !sel && void guardar({ estilo: s.id }, `Diseño «${s.nombre}» guardado.`)}
                className={`overflow-hidden rounded border-2 text-left text-sm ${sel ? "border-sky-400" : "border-transparent hover:border-borde"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- muestra local */}
                <img src={archivo(s.imagen)} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                <span className="block px-2 pt-1 font-medium">{sel ? "✓ " : ""}{s.nombre}</span>
                <span className="block px-2 pb-1 text-xs text-tenue">{s.descripcion}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-2 rounded border border-borde p-3">
          <p className="text-sm font-medium">¿Tienes tu propio diseño? (opcional)</p>
          {Object.entries(d.propios).map(([f, ruta]) => ruta && (
            <div key={f} className="flex flex-wrap items-center gap-2 text-sm">
              <span><span aria-hidden className="text-emerald-400">✓</span> Diseño propio para formato {NOMBRE_FORMATO[f] ?? f}</span>
              <button type="button" className="boton" disabled={ocupado} onClick={() => void quitar(f)}>Quitar y usar los diseños listos</button>
            </div>
          ))}
          <label className="boton inline-block cursor-pointer">
            {ocupado ? "Revisando…" : "Subir diseño (.psd)"}
            <input type="file" accept=".psd,.psb,.pcraft" className="sr-only" disabled={ocupado} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void subir(f); }} />
          </label>
          <details className="text-sm text-tenue">
            <summary className="cursor-pointer">¿Cómo preparo mi diseño?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Hazlo en Photoshop, Photopea (gratis, en el navegador) o PhotoCraft, del tamaño de la portada: 1280×720 horizontal o 1080×1920 vertical.</li>
              <li>Ponle nombre <code>@titulo</code> a la capa de texto del título, <code>@imagen</code> a la capa de la foto y, si quieres, <code>@marca</code> al nombre del canal.</li>
              <li>Guárdalo como .psd y súbelo aquí. Te diremos qué encontramos y verás cómo queda.</li>
            </ol>
          </details>
          {revision && (
            <div className="space-y-2 text-sm">
              {revision.revision.problemas.map((p) => <p key={p} className="text-red-300">✗ {p}</p>)}
              {revision.revision.encontradas.length > 0 && <p className="text-emerald-300">✓ Encontramos {revision.revision.encontradas.join(", ")}.</p>}
              {revision.revision.ok && revision.revision.faltan.length > 0 && <p className="text-tenue">Sin {revision.revision.faltan.join(", ")}: esas partes quedan como están en tu diseño.</p>}
              {revision.revision.ok && <p>Quedó guardado para el formato {NOMBRE_FORMATO[revision.formato] ?? revision.formato}. Así se ve:</p>}
              {/* eslint-disable-next-line @next/next/no-img-element -- muestra local */}
              {revision.muestra && <img src={archivo(revision.muestra)} alt="Muestra con tu diseño" className="max-h-72 rounded" />}
            </div>
          )}
        </div>
      </section>
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
    </div>
  );
}
