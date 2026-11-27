"use client";
/* eslint-disable @next/next/no-img-element -- imágenes locales de la invitación, servidas por la API */
import { useState } from "react";
import type { Invitacion } from "@/lib/invitaciones/esquema";
import { Aviso, AvisoTarjeta, Barra, LineaFalta, faltanConGuardar, pedir, postJson, useGuardeAntes, useSondeo } from "./comun";

interface TrabajoImagen {
  id: string;
  que: "foto" | "qr";
  estado: string;
  etapa: string | null;
  progreso: number;
  error: string | null;
}
interface DatosImagenes {
  fotos: string[];
  qrs: { archivo: string; lecturas: number }[];
  trabajos: TrabajoImagen[];
}

const propuesta = (slug: string, nombre: string) => `/api/invitaciones/${slug}/propuesta/${nombre}`;
const archivo = (slug: string, nombre: string, v: string, descargar = false) => `/api/invitaciones/${slug}/archivo/${nombre}?v=${encodeURIComponent(v)}${descargar ? "&descargar=1" : ""}`;

function lecturaTexto(n: number) {
  return n >= 3 ? "Se escanea muy bien" : n === 2 ? "Se escanea bien" : "Pruébalo con tu teléfono";
}

function useImagenes(slug: string) {
  const [rapido, setRapido] = useState(false);
  const s = useSondeo<DatosImagenes>(`/api/invitaciones/${slug}/imagenes`, rapido ? 3000 : 30_000);
  const enCurso = (s.datos?.trabajos ?? []).filter((t) => t.estado === "pendiente" || t.estado === "corriendo");
  if (enCurso.length > 0 !== rapido) setRapido(enCurso.length > 0);
  return { ...s, enCurso };
}

function Progreso({ t }: { t: TrabajoImagen }) {
  return (
    <div className="space-y-1 text-sm">
      <p>{t.estado === "pendiente" ? "En fila: espera su turno con la tarjeta de video…" : (t.etapa ?? "Trabajando…")}</p>
      <Barra valor={t.progreso} />
      <p className="text-xs text-tenue">Puedes seguir usando Geeper; aparece aquí cuando termine.</p>
    </div>
  );
}

function Falla({ t }: { t?: TrabajoImagen }) {
  if (!t || (t.estado !== "fallido" && t.estado !== "interrumpido")) return null;
  return <Aviso tipo="error">{t.estado === "interrumpido" ? "Se interrumpió (¿se reinició la PC?). Vuelve a pedirlo." : (t.error ?? "No se pudo crear.")}</Aviso>;
}

/** QR de la invitación: tocarlo abre la página. Y el QR con dibujo del tema. */
export function PanelQr({ inv, alCambiar }: { inv: Invitacion; alCambiar: (avisos: string[]) => void }) {
  const url = inv.urlPublica!;
  const { datos, enCurso, recargar } = useImagenes(inv.slug);
  const [legible, setLegible] = useState(false);
  const guardeQr = useGuardeAntes();
  const faltanQr = faltanConGuardar(guardeQr);
  const [extra, setExtra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const trabajo = enCurso.find((t) => t.que === "qr");
  const ultimo = datos?.trabajos.find((t) => t.que === "qr");
  const usado = inv.qrArte?.url === url;

  async function pedirQr() {
    setOcupado(true);
    setFalla(null);
    try {
      await postJson(`/api/invitaciones/${inv.slug}/imagenes`, { que: "qr", legible, descripcion: extra });
      await recargar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function usar(nombre: string) {
    setFalla(null);
    try {
      const r = await pedir<{ avisos: string[] }>(`/api/invitaciones/${inv.slug}/imagenes`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ archivo: nombre }) });
      alCambiar(r.avisos);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <a href={url} target="_blank" rel="noopener" title="Abrir la invitación" className="group block rounded-xl bg-white p-1.5 shadow-lg transition hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500">
          <img src={archivo(inv.slug, "qr.png", inv.actualizada)} alt={`Código QR: abre la invitación de ${inv.nombres}`} className="h-40 w-40 rounded-lg" />
        </a>
        <div className="space-y-2 text-sm">
          <p>{usado ? "Tu QR con dibujo." : "Tu QR."} Tócalo para abrir la invitación; escanéalo con el teléfono para probarlo.</p>
          <div className="flex flex-wrap gap-2">
            <a className="boton" href={archivo(inv.slug, "qr.png", inv.actualizada, true)}>Descargar QR</a>
            <a className="boton" href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noopener">Mandar por WhatsApp</a>
          </div>
        </div>
      </div>

      <div className="tarjeta space-y-3 p-3">
        <h3 className="font-medium">✨ QR con dibujo del tema</h3>
        <p className="text-xs text-tenue">El QR se convierte en un dibujo con los colores y la idea de tu invitación. Se hacen 6 versiones y sólo se guardan las que se pueden escanear. La primera vez baja el dibujante (2,8 GB); luego tarda 1 a 2 minutos.</p>
        {trabajo ? <Progreso t={trabajo} /> : (
          <>
            <input aria-label="Algo más para el dibujo (opcional)" className="campo" maxLength={300} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Algo más para el dibujo (opcional): mariposas, un castillo…" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={legible} onChange={(e) => setLegible(e.target.checked)} />Que se lea mejor (dibujo más suave)</label>
            <AvisoTarjeta g={guardeQr}>El QR con dibujo usa la tarjeta de video 1 a 2 minutos.</AvisoTarjeta>
            <button type="button" className="boton boton-primario" disabled={ocupado || faltanQr.length > 0} aria-describedby={faltanQr.length ? guardeQr.idFalta : undefined} onClick={pedirQr}>
              {datos?.qrs.length ? "✨ Hacer otras versiones" : "✨ Hacer QR con dibujo"}
            </button>
            <LineaFalta id={guardeQr.idFalta} faltan={faltanQr} />
          </>
        )}
        {!trabajo && <Falla t={ultimo} />}
        {falla && <Aviso tipo="error">{falla}</Aviso>}
        {!!datos?.qrs.length && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {datos.qrs.map((q) => (
              <li key={q.archivo} className="space-y-1.5">
                <a href={url} target="_blank" rel="noopener" title="Abrir la invitación" className="block">
                  <img src={propuesta(inv.slug, q.archivo)} alt="QR con dibujo" className="aspect-square w-full rounded-lg" loading="lazy" />
                </a>
                <p className={`text-xs ${q.lecturas >= 2 ? "text-emerald-400" : "text-amber-400"}`}>{lecturaTexto(q.lecturas)}</p>
                <button type="button" className="boton w-full" onClick={() => usar(q.archivo)}>Usar este</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Foto del sobre creada con IA (Z-Image): se describe y se elige entre 4. */
export function PanelFoto({ inv, alCambiar, inicial = "" }: { inv: Invitacion; alCambiar: (avisos: string[]) => void; inicial?: string }) {
  const { datos, enCurso, recargar } = useImagenes(inv.slug);
  const [descripcion, setDescripcion] = useState(inicial);
  const guarde = useGuardeAntes();
  const faltan = faltanConGuardar(guarde);
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const trabajo = enCurso.find((t) => t.que === "foto");
  const ultimo = datos?.trabajos.find((t) => t.que === "foto");

  async function crear() {
    setOcupado(true);
    setFalla(null);
    try {
      await postJson(`/api/invitaciones/${inv.slug}/imagenes`, { que: "foto", descripcion });
      await recargar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function usar(nombre: string) {
    setFalla(null);
    try {
      const r = await pedir<{ avisos: string[] }>(`/api/invitaciones/${inv.slug}/imagenes`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ archivo: nombre }) });
      alCambiar(r.avisos);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section id="foto-ia" className={`tarjeta space-y-3 p-4 ${inicial ? "ring-2 ring-cyan-600" : ""}`}>
      <h2 className="font-medium">✨ Foto del sobre con IA</h2>
      <p className="text-sm text-tenue">Describe lo que quieres ver dentro del sobre y Geeper dibuja 4 opciones con el estilo de tu invitación. Tarda 1 a 3 minutos.</p>
      {trabajo ? <Progreso t={trabajo} /> : (
        <>
          <textarea aria-label="Describe la foto" className="campo min-h-20" maxLength={400} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            placeholder={inv.tema ? `Por ejemplo: ${inv.tema.idea || inv.tema.nombre}` : "Por ejemplo: dos anillos de oro sobre pétalos de rosa"} />
          <AvisoTarjeta g={guarde}>La foto con IA usa la tarjeta de video 1 a 3 minutos.</AvisoTarjeta>
          <button type="button" className="boton boton-primario" disabled={ocupado || faltan.length > 0} aria-describedby={faltan.length ? guarde.idFalta : undefined} onClick={crear}>
            {datos?.fotos.length ? "✨ Crear otras" : "✨ Crear foto"}
          </button>
          <LineaFalta id={guarde.idFalta} faltan={faltan} />
          <p className="text-xs text-tenue">Si lo dejas vacío, se inspira en el tema de la invitación.</p>
        </>
      )}
      {!trabajo && <Falla t={ultimo} />}
      {falla && <Aviso tipo="error">{falla}</Aviso>}
      {!!datos?.fotos.length && (
        <ul className="grid grid-cols-2 gap-3">
          {datos.fotos.map((f) => (
            <li key={f} className="space-y-1.5">
              <img src={propuesta(inv.slug, f)} alt="Foto propuesta para el sobre" className="aspect-[3/2] w-full rounded-lg object-cover" loading="lazy" />
              <button type="button" className="boton w-full" onClick={() => usar(f)}>Usar esta</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
