"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OBJETIVOS } from "@/lib/anuncios/catalogo";
import type { Brief } from "@/lib/anuncios/esquema";
import { Aviso, postJson } from "../comun";
import { OBJETIVO_SIMPLE, QUE } from "./textos";
import { Ayuda, Campo } from "./ui";

/** Cada red con su ubicación vertical por defecto (la más común para videos cortos). */
const REDES: { id: string; nombre: string; detalle: string; ubicacion: Brief["ubicaciones"][number] }[] = [
  { id: "instagram", nombre: "Instagram", detalle: "Reels (video vertical)", ubicacion: "instagram-reels" },
  { id: "tiktok", nombre: "TikTok", detalle: "Videos en el inicio", ubicacion: "tiktok-infeed" },
  { id: "youtube", nombre: "YouTube", detalle: "Shorts (video vertical)", ubicacion: "youtube-shorts" },
  { id: "facebook", nombre: "Facebook", detalle: "Reels (video vertical)", ubicacion: "facebook-reels" },
  { id: "linkedin", nombre: "LinkedIn", detalle: "Video en el feed (cuadrado)", ubicacion: "linkedin-video" },
];

const ORDEN_OBJETIVOS = ["ventas", "trafico", "clientes", "reconocimiento", "interaccion", "app"] as (keyof typeof OBJETIVOS)[];

export function Asistente() {
  const router = useRouter();
  const [paso, setPaso] = useState(0);
  const [marca, setMarca] = useState("");
  const [producto, setProducto] = useState("");
  const [objetivo, setObjetivo] = useState<keyof typeof OBJETIVOS | null>(null);
  const [redes, setRedes] = useState<string[]>([]);
  const [oferta, setOferta] = useState("");
  const [destino, setDestino] = useState("");
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pasos = [
    { titulo: "¿Qué vas a anunciar?", ok: producto.trim().length >= 3 },
    { titulo: "¿Qué quieres lograr?", ok: objetivo !== null },
    { titulo: "¿Dónde lo vas a mostrar?", ok: redes.length > 0 },
    { titulo: "¿Qué le ofreces a quien lo vea?", ok: oferta.trim().length >= 3 && (!destino || /^https?:\/\/\S+\.\S+/.test(destino)) },
  ];
  const actual = pasos[paso]!;
  const titulo = useRef<HTMLHeadingElement>(null);
  const primerRender = useRef(true);
  // A11-14: al pasar a un paso sin campo de texto (2 y 3) el foco va al título, para no recorrer la barra otra vez.
  // Los pasos 1 y 4 ya ponen el cursor en su primer campo con autoFocus.
  useEffect(() => {
    if (primerRender.current) { primerRender.current = false; return; }
    if (paso === 1 || paso === 2) titulo.current?.focus();
  }, [paso]);

  async function crear() {
    setCreando(true);
    setError(null);
    try {
      const nombreFinal = nombre.trim() || `${marca.trim() || producto.trim()} · ${new Date().toLocaleDateString("es", { month: "long", year: "numeric" })}`;
      const brief: Partial<Brief> = {
        marca: marca.trim(),
        producto: producto.trim(),
        objetivo: objetivo ?? "trafico",
        ubicaciones: REDES.filter((r) => redes.includes(r.id)).map((r) => r.ubicacion),
        oferta: oferta.trim(),
        destino: destino.trim(),
        botonCta: objetivo === "ventas" ? "Comprar" : objetivo === "clientes" ? "Contactar" : objetivo === "app" ? "Instalar" : "Más información",
      };
      const r = await postJson<{ campana: { id: string } }>("/api/anuncios", { nombre: nombreFinal.slice(0, 120), brief });
      router.push(`/anuncios/${r.campana.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreando(false);
    }
  }

  function siguiente(e?: React.FormEvent) {
    e?.preventDefault();
    if (!actual.ok) return;
    if (paso < pasos.length - 1) setPaso(paso + 1);
    else void crear();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/anuncios" className="text-sm text-tenue hover:text-white">← Anuncios</Link>
        <span className="text-sm text-tenue tabular-nums" aria-live="polite">Paso {paso + 1} de {pasos.length}</span>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {pasos.map((p, i) => <div key={p.titulo} className={`h-1.5 flex-1 rounded ${i <= paso ? "bg-cyan-500" : "bg-slate-800"}`} />)}
      </div>

      <form onSubmit={siguiente} className="tarjeta space-y-5 p-6">
        <h1 ref={titulo} tabIndex={-1} className="text-2xl font-bold tracking-tight focus:outline-none">{actual.titulo}</h1>

        {paso === 0 && (
          <div className="space-y-4">
            <label className="block">
              <span className="etiqueta">¿Qué vendes? (producto o servicio)</span>
              <input autoFocus className="campo text-base" value={producto} maxLength={200} onChange={(e) => setProducto(e.target.value)} placeholder="Ej.: café de especialidad con envío a domicilio" />
            </label>
            <label className="block">
              <span className="etiqueta">Nombre de tu marca (opcional)</span>
              <input className="campo text-base" value={marca} maxLength={120} onChange={(e) => setMarca(e.target.value)} placeholder="Ej.: Café Aurora" />
            </label>
          </div>
        )}

        {paso === 1 && (
          <div>
            <p className="mb-3 text-sm text-tenue">Elige lo que más te importa ahora. <Ayuda texto={QUE.objetivo} de="objetivo" /></p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Objetivo">
              {ORDEN_OBJETIVOS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={objetivo === k} onClick={() => setObjetivo(k)}
                  className={`rounded-xl border p-4 text-left transition-colors ${objetivo === k ? "border-cyan-500 bg-cyan-950/50" : "border-borde bg-[#0f131a] hover:border-slate-500"}`}>
                  <span className="block font-semibold">{OBJETIVO_SIMPLE[k]!.titulo}</span>
                  <span className="mt-0.5 block text-sm text-tenue">{OBJETIVO_SIMPLE[k]!.detalle}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {paso === 2 && (
          <div>
            <p className="mb-3 text-sm text-tenue">Puedes elegir varias. Después podrás afinar los lugares exactos en «Tu negocio».</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {REDES.map((r) => {
                const sel = redes.includes(r.id);
                return (
                  <button key={r.id} type="button" aria-pressed={sel} onClick={() => setRedes(sel ? redes.filter((x) => x !== r.id) : [...redes, r.id])}
                    className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${sel ? "border-cyan-500 bg-cyan-950/50" : "border-borde bg-[#0f131a] hover:border-slate-500"}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${sel ? "border-cyan-400 bg-cyan-600 text-white" : "border-slate-500"}`} aria-hidden>{sel ? "✓" : ""}</span>
                    <span>
                      <span className="block font-semibold">{r.nombre}</span>
                      <span className="block text-sm text-tenue">{r.detalle}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {paso === 3 && (
          <div className="space-y-4">
            <Campo etiqueta="Lo que ofreces, con sus condiciones" que={QUE.oferta}>
              <textarea autoFocus className="campo min-h-24 text-base" value={oferta} maxLength={600} onChange={(e) => setOferta(e.target.value)} placeholder="Ej.: primera bolsa con 20 % de descuento, envío gratis a todo el país" />
            </Campo>
            <div>
              <Campo etiqueta="¿A qué página lleva el anuncio? (opcional)" que={QUE.destino}>
                <input className="campo text-base" type="url" inputMode="url" value={destino} maxLength={500} onChange={(e) => setDestino(e.target.value)} placeholder="https://tu-tienda.com" />
              </Campo>
              {destino && !/^https?:\/\/\S+\.\S+/.test(destino) && <span className="mt-1 block text-xs text-amber-300">Escribe la dirección completa, empezando con https://</span>}
            </div>
            <label className="block">
              <span className="etiqueta">Nombre de la campaña (opcional)</span>
              <input className="campo" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} placeholder={`${marca || producto || "Mi campaña"} · ${new Date().toLocaleDateString("es", { month: "long" })}`} />
            </label>
          </div>
        )}

        {error && <Aviso tipo="error">{error}</Aviso>}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button type="button" className="boton" onClick={() => setPaso(paso - 1)} disabled={paso === 0 || creando}>Atrás</button>
          <button className="boton boton-primario px-5 text-base" disabled={!actual.ok || creando}>
            {paso < pasos.length - 1 ? "Siguiente" : creando ? "Creando…" : "Crear campaña"}
          </button>
        </div>
      </form>
      <p className="text-center text-xs text-tenue">Todo se puede cambiar después.</p>
    </div>
  );
}
