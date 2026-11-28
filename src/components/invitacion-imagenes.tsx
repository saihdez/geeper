"use client";
/* eslint-disable @next/next/no-img-element -- imágenes locales de la invitación, servidas por la API */
import { useRef, useState } from "react";
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

interface Ajustes {
  zoom: number;
  x: number;
  y: number;
  brillo: number;
  contraste: number;
  color: number;
}
const SIN_AJUSTES: Ajustes = { zoom: 1, x: 50, y: 50, brillo: 0, contraste: 1, color: 1 };

async function descartar(url: string, confirmar?: string) {
  if (confirmar && !confirm(confirmar)) return false;
  await pedir(url, { method: "DELETE" });
  return true;
}

function Deslizador({ etiqueta, valor, min, max, paso, alCambiar, texto }: { etiqueta: string; valor: number; min: number; max: number; paso: number; alCambiar: (v: number) => void; texto: string }) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between"><span>{etiqueta}</span><span className="text-tenue">{texto}</span></span>
      <input type="range" className="w-full" min={min} max={max} step={paso} value={valor} onChange={(e) => alCambiar(Number(e.target.value))} />
    </label>
  );
}

/**
 * Ajustar la foto del sobre antes de usarla: encuadre en la forma de la carta (arrastrar para mover, acercar)
 * y luz, contraste y color. La vista previa usa las mismas cuentas que el servidor (imagenes.ts: filtroAjustes).
 */
function EditorFoto({ src, alUsar, alCancelar, ocupado }: { src: string; alUsar: (a: Ajustes) => void; alCancelar: () => void; ocupado: boolean }) {
  const [a, setA] = useState<Ajustes>(SIN_AJUSTES);
  const arrastre = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const marco = useRef<HTMLDivElement>(null);
  const cambiar = (p: Partial<Ajustes>) => setA((v) => ({ ...v, ...p }));
  const limitar = (v: number) => Math.max(0, Math.min(100, v));

  function mover(e: React.PointerEvent) {
    const d = arrastre.current;
    const m = marco.current;
    if (!d || !m) return;
    // Arrastrar la foto a la derecha muestra lo de la izquierda (como en el teléfono).
    const k = 100 / (m.clientWidth * 0.6);
    cambiar({ x: limitar(d.x - (e.clientX - d.px) * k), y: limitar(d.y - (e.clientY - d.py) * k) });
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <p className="text-sm font-medium">Ajusta la foto</p>
      <div
        ref={marco}
        className="relative mx-auto aspect-[3/2] w-full max-w-md cursor-grab touch-none overflow-hidden rounded-lg bg-black active:cursor-grabbing"
        onPointerDown={(e) => { arrastre.current = { px: e.clientX, py: e.clientY, x: a.x, y: a.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={mover}
        onPointerUp={() => { arrastre.current = null; }}
        onPointerCancel={() => { arrastre.current = null; }}
      >
        <img src={src} alt="Vista previa de la foto del sobre" draggable={false} className="pointer-events-none h-full w-full select-none object-cover"
          style={{ objectPosition: `${a.x}% ${a.y}%`, transform: `scale(${a.zoom})`, transformOrigin: `${a.x}% ${a.y}%`, filter: `brightness(${1 + a.brillo}) contrast(${a.contraste}) saturate(${a.color})` }} />
      </div>
      <p className="text-center text-xs text-tenue">Arrastra la foto para elegir qué parte se ve en el sobre.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Deslizador etiqueta="Acercar" valor={a.zoom} min={1} max={3} paso={0.05} alCambiar={(zoom) => cambiar({ zoom })} texto={`${Math.round(a.zoom * 100)} %`} />
        <Deslizador etiqueta="Luz" valor={a.brillo} min={-0.5} max={0.5} paso={0.02} alCambiar={(brillo) => cambiar({ brillo })} texto={a.brillo > 0 ? "más clara" : a.brillo < 0 ? "más oscura" : "igual"} />
        <Deslizador etiqueta="Contraste" valor={a.contraste} min={0.5} max={1.6} paso={0.02} alCambiar={(contraste) => cambiar({ contraste })} texto={a.contraste > 1 ? "más marcado" : a.contraste < 1 ? "más suave" : "igual"} />
        <Deslizador etiqueta="Color" valor={a.color} min={0} max={2} paso={0.05} alCambiar={(color) => cambiar({ color })} texto={a.color === 0 ? "blanco y negro" : a.color > 1 ? "más vivo" : a.color < 1 ? "más apagado" : "igual"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="boton boton-primario" disabled={ocupado} onClick={() => alUsar(a)}>{ocupado ? "Guardando…" : "Usar con estos ajustes"}</button>
        <button type="button" className="boton" disabled={ocupado} onClick={() => setA(SIN_AJUSTES)}>Como estaba</button>
        <button type="button" className="boton" disabled={ocupado} onClick={alCancelar}>Cancelar</button>
      </div>
    </div>
  );
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
  const [cambiandoVista, setCambiandoVista] = useState(false);

  async function vistaPrevia(v: "portada" | "qr") {
    setFalla(null);
    setCambiandoVista(true);
    try {
      const r = await pedir<{ avisos: string[] }>(`/api/invitaciones/${inv.slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vistaPrevia: v }) });
      alCambiar(r.avisos);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setCambiandoVista(false);
    }
  }

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
          {usado && (
            <fieldset className="space-y-1" disabled={cambiandoVista}>
              <legend className="text-xs text-tenue">Imagen que se ve al mandar el enlace por WhatsApp</legend>
              <label className="flex items-center gap-2"><input type="radio" name={`vista-${inv.slug}`} checked={inv.vistaPrevia !== "qr"} onChange={() => void vistaPrevia("portada")} />La portada (nombre y foto)</label>
              <label className="flex items-center gap-2"><input type="radio" name={`vista-${inv.slug}`} checked={inv.vistaPrevia === "qr"} onChange={() => void vistaPrevia("qr")} />El QR con dibujo</label>
              <p className="text-xs text-tenue">{cambiandoVista ? "Rehaciendo la imagen…" : "Después de cambiarla, descarga el .zip y vuelve a subirlo a Netlify."}</p>
            </fieldset>
          )}
        </div>
      </div>

      <div className="tarjeta space-y-3 p-3">
        <h3 className="font-medium">✨ QR con dibujo del tema</h3>
        <p className="text-xs text-tenue">El QR se convierte en un dibujo con los colores y la idea de tu invitación. Se hacen 6 versiones y sólo se guardan las que se pueden escanear; si ninguna se lee, Geeper prueba solo con el QR más marcado. La primera vez baja el dibujante (2,8 GB); luego tarda 1 a 3 minutos.</p>
        {trabajo ? <Progreso t={trabajo} /> : (
          <>
            <input aria-label="Algo más para el dibujo (opcional)" className="campo" maxLength={300} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Algo más para el dibujo (opcional): mariposas, un castillo…" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={legible} onChange={(e) => setLegible(e.target.checked)} />Que se lea mejor (dibujo más suave)</label>
            <AvisoTarjeta g={guardeQr}>El QR con dibujo usa la tarjeta de video 1 a 3 minutos.</AvisoTarjeta>
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
                <div className="flex gap-1.5">
                  <button type="button" className="boton flex-1" onClick={() => usar(q.archivo)}>Usar este</button>
                  <button type="button" className="boton" title="Descartar este QR" aria-label="Descartar este QR" onClick={() => void descartar(propuesta(inv.slug, q.archivo)).then(() => recargar(), (e: unknown) => setFalla(e instanceof Error ? e.message : String(e)))}>🗑</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {(datos?.qrs.length ?? 0) > 1 && (
          <button type="button" className="text-xs text-tenue underline" onClick={() => void descartar(`/api/invitaciones/${inv.slug}/imagenes?que=qr`, "¿Descartar todos los QR con dibujo propuestos? El que ya usas no se borra.").then(() => recargar())}>Descartar todos</button>
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
  /** Qué foto se está ajustando: una propuesta, la actual («actual») o ninguna. */
  const [ajustando, setAjustando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function usarAjustada(a: Ajustes) {
    setGuardando(true);
    setFalla(null);
    try {
      const cuerpo = ajustando === "actual" ? { ajustes: a } : { archivo: ajustando, ajustes: a };
      const r = await pedir<{ avisos: string[] }>(`/api/invitaciones/${inv.slug}/imagenes`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      setAjustando(null);
      alCambiar(r.avisos);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

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
      {ajustando && (
        <EditorFoto key={ajustando} src={ajustando === "actual" ? `/api/invitaciones/${inv.slug}/foto-original?v=${encodeURIComponent(inv.actualizada)}` : propuesta(inv.slug, ajustando)}
          ocupado={guardando} alUsar={usarAjustada} alCancelar={() => setAjustando(null)} />
      )}
      {inv.foto && !ajustando && (
        <button type="button" className="boton" onClick={() => setAjustando("actual")}>Ajustar la foto que ya usa la invitación</button>
      )}
      {!!datos?.fotos.length && (
        <ul className="grid grid-cols-2 gap-3">
          {datos.fotos.map((f) => (
            <li key={f} className="space-y-1.5">
              <img src={propuesta(inv.slug, f)} alt="Foto propuesta para el sobre" className="aspect-[3/2] w-full rounded-lg object-cover" loading="lazy" />
              <div className="flex gap-1.5">
                <button type="button" className="boton flex-1" onClick={() => usar(f)}>Usar esta</button>
                <button type="button" className="boton" onClick={() => setAjustando(f)}>Ajustar</button>
                <button type="button" className="boton" title="Descartar esta foto" aria-label="Descartar esta foto" onClick={() => void descartar(propuesta(inv.slug, f)).then(() => { if (ajustando === f) setAjustando(null); return recargar(); }, (e: unknown) => setFalla(e instanceof Error ? e.message : String(e)))}>🗑</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(datos?.fotos.length ?? 0) > 1 && (
        <button type="button" className="text-xs text-tenue underline" onClick={() => void descartar(`/api/invitaciones/${inv.slug}/imagenes?que=foto`, "¿Descartar todas las fotos propuestas? La que ya usa la invitación no se borra.").then(() => { setAjustando(null); return recargar(); })}>Descartar todas</button>
      )}
    </section>
  );
}
