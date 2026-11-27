"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PLANTILLAS_INFO } from "@/lib/invitaciones/catalogo";
import type { Invitacion, PlantillaId } from "@/lib/invitaciones/esquema";
import { Aviso, pedir, useSondeo } from "./comun";
import { FormInvitacion } from "./form-invitacion";

interface Resumen {
  slug: string;
  nombres: string;
  tipo: string;
  fecha: string;
  plantilla: PlantillaId;
  publicada: boolean;
}

const archivo = (slug: string, nombre: string, v?: string) => `/api/invitaciones/${slug}/archivo/${nombre}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

export function PaginaInvitaciones() {
  const { datos, error } = useSondeo<{ invitaciones: Resumen[] }>("/api/invitaciones", 30_000);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Invitaciones interactivas</h1>
        <Link href="/invitaciones/nueva" className="boton boton-primario">Crear invitación</Link>
      </div>
      <p className="text-sm text-tenue">
        Para bodas, XV años, cumpleaños y más: una página para el celular que se abre como un sobre, con música, calendario,
        cuenta atrás, cómo llegar, código de vestimenta y confirmación por WhatsApp. Llenas 5 datos y queda lista.
      </p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {datos && !datos.invitaciones.length && (
        <div className="tarjeta p-6 text-center text-sm text-tenue">Todavía no tienes invitaciones. Crea la primera con el botón de arriba.</div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {datos?.invitaciones.map((i) => {
          const c = PLANTILLAS_INFO[i.plantilla].colores;
          return (
            <li key={i.slug}>
              <Link href={`/invitaciones/${i.slug}`} className="tarjeta flex items-center gap-3 p-3 hover:bg-white/5">
                <span className="h-12 w-12 shrink-0 rounded-full" style={{ background: `radial-gradient(circle at 35% 30%, ${c.sello}, ${c.fondo})` }} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.nombres}</span>
                  <span className="block text-xs text-tenue">{i.tipo} · {i.fecha} · {i.publicada ? "publicada" : "sin publicar"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function VistaInvitacion({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const avisosIniciales = (() => {
    try {
      return JSON.parse(params.get("avisos") ?? "[]") as string[];
    } catch {
      return [];
    }
  })();
  const { datos, error, recargar } = useSondeo<{ invitacion: Invitacion }>(`/api/invitaciones/${slug}`, 60_000);
  const [url, setUrl] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>(avisosIniciales);
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [resubir, setResubir] = useState(false);
  const inv = datos?.invitacion;
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!inv) return <p className="text-sm text-tenue">Cargando…</p>;
  const v = inv.actualizada;
  const urlActual = url ?? inv.urlPublica ?? "";

  async function guardarUrl(nueva: string | null) {
    setOcupado(true);
    setFalla(null);
    try {
      const r = await pedir<{ avisos: string[] }>(`/api/invitaciones/${slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ urlPublica: nueva }) });
      setAvisos(r.avisos);
      setResubir(!!nueva);
      setUrl(null);
      await recargar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function borrar() {
    if (!confirm("¿Borrar esta invitación de Geeper? Se borran su foto, su música y sus datos. Si ya la subiste a internet, bórrala también allí.")) return;
    await pedir(`/api/invitaciones/${slug}`, { method: "DELETE" });
    router.push("/invitaciones");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[auto_1fr]">
      <div className="mx-auto">
        <div className="max-w-full rounded-[2.6rem] border-[10px] border-neutral-800 bg-black shadow-2xl" style={{ width: 410, height: 800 }}>
          <iframe title={`Vista de la invitación de ${inv.nombres}`} src={archivo(slug, "index.html", v)} className="h-full w-full rounded-[2rem] bg-white"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads" />
        </div>
        <p className="mt-2 text-center text-xs text-tenue">Así se ve en un celular. Toca el sello para probarla.</p>
      </div>

      <div className="space-y-5">
        <div>
          <Link href="/invitaciones" className="text-xs text-tenue hover:text-white">← Invitaciones</Link>
          <h1 className="text-xl font-semibold">{inv.nombres}</h1>
          <p className="text-sm text-tenue">{inv.fecha} · {inv.hora} · {inv.lugar.nombre}</p>
        </div>
        {avisos.map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}

        <div className="flex flex-wrap gap-2">
          <a className="boton boton-primario" href={archivo(slug, "invitacion.zip", v)}>Descargar (.zip)</a>
          <a className="boton" href={archivo(slug, "index.html", v)} target="_blank" rel="noopener">Abrir en otra pestaña</a>
          <Link className="boton" href={`/invitaciones/${slug}/editar`}>Cambiar datos</Link>
        </div>

        <section className="tarjeta space-y-3 p-4">
          <h2 className="font-medium">Compártela</h2>
          <p className="text-sm text-tenue">Para mandarla por WhatsApp necesita estar en internet. Es gratis y tarda 2 minutos:</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Toca <b>Descargar (.zip)</b> y descomprímelo (queda una carpeta).</li>
            <li>Abre <a className="underline" href="https://app.netlify.com/drop" target="_blank" rel="noopener">Netlify Drop</a> y arrastra esa carpeta. Te da una dirección que termina en <code>.netlify.app</code>.</li>
            <li>Pégala aquí para hacer el QR y la imagen que se ve en WhatsApp:</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Dirección donde quedó publicada" className="campo flex-1" inputMode="url" placeholder="https://tu-invitacion.netlify.app" value={urlActual} onChange={(e) => setUrl(e.target.value)} />
            <button className="boton" disabled={ocupado || !/^https:\/\/\S+\.\S+/.test(urlActual.trim()) || urlActual.trim() === inv.urlPublica} onClick={() => guardarUrl(urlActual.trim())}>
              {ocupado ? "Guardando…" : "Guardar dirección"}
            </button>
            {inv.urlPublica && <button className="boton" disabled={ocupado} onClick={() => guardarUrl(null)}>Quitar</button>}
          </div>
          {falla && <Aviso tipo="error">{falla}</Aviso>}
          {(resubir || inv.urlPublica) && (
            <Aviso tipo="info">
              Último paso: descarga el .zip otra vez y vuelve a arrastrar la carpeta en Netlify (en tu sitio → Deploys). Así la vista previa
              de WhatsApp sale con la imagen. Comparte el enlace después de eso.
            </Aviso>
          )}
          {inv.urlPublica && (
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={archivo(slug, "qr.svg", v)} alt="Código QR de la invitación" className="h-36 w-36 rounded bg-white p-1" />
              <div className="space-y-2 text-sm">
                <p>El QR sirve para imprimirlo o ponerlo al final de un video.</p>
                <a className="boton" href={`${archivo(slug, "qr.svg", v)}&descargar=1`}>Descargar QR</a>
                <a className="boton ml-2" href={`https://wa.me/?text=${encodeURIComponent(inv.urlPublica)}`} target="_blank" rel="noopener">Mandar por WhatsApp</a>
              </div>
            </div>
          )}
        </section>

        <section className="text-sm text-tenue">
          <p>Quien tenga el enlace verá el lugar y el WhatsApp de confirmación. La página no aparece en buscadores.</p>
          <button className="boton mt-3" onClick={borrar}>Borrar invitación</button>
        </section>
      </div>
    </div>
  );
}

export function EditarInvitacion({ slug }: { slug: string }) {
  const { datos, error } = useSondeo<{ invitacion: Invitacion }>(`/api/invitaciones/${slug}`, 3_600_000);
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!datos) return <p className="text-sm text-tenue">Cargando…</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={`/invitaciones/${slug}`} className="text-xs text-tenue hover:text-white">← Volver a la invitación</Link>
      <h1 className="text-xl font-semibold">Cambiar la invitación</h1>
      <FormInvitacion key={datos.invitacion.actualizada} inicial={datos.invitacion} />
    </div>
  );
}
