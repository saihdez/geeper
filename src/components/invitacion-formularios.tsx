"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Pedido } from "@/lib/invitaciones/formularios";
import type { EstadoGoogle } from "@/lib/invitaciones/google";
import { TIPOS_INFO } from "@/lib/invitaciones/catalogo";
import { TIPOS, type Tipo } from "@/lib/invitaciones/esquema";
import { Aviso, pedir, postJson, useSondeo } from "./comun";

interface Datos {
  google: EstadoGoogle;
  pedidos: Pedido[];
}

const zonaLocal = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
  } catch {
    return "America/Mexico_City";
  }
};

/** Cada cuánto se buscan respuestas nuevas mientras esta pantalla está abierta. */
const REVISAR_MS = 60_000;

function Copiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [listo, setListo] = useState(false);
  return (
    <button type="button" className="boton" onClick={async () => {
      await navigator.clipboard.writeText(texto).catch(() => {});
      setListo(true);
      setTimeout(() => setListo(false), 2000);
    }}>{listo ? "¡Copiado!" : etiqueta}</button>
  );
}

function AppGoogle({ g, alGuardar }: { g: EstadoGoogle; alGuardar: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secreto, setSecreto] = useState("");
  const [falla, setFalla] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    setOcupado(true);
    setFalla(null);
    try {
      await pedir("/api/invitaciones/formularios/google", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, clientSecret: secreto }) });
      alGuardar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <p>Se hace una sola vez (unos 10 minutos) y es gratis. Si ya conectaste YouTube en Geeper, usa ese mismo proyecto.</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Abre <a className="underline" href="https://console.cloud.google.com/apis/library/forms.googleapis.com" target="_blank" rel="noopener">Google Forms API</a> en Google Cloud y toca <b>Habilitar</b> (si te pide, crea un proyecto).</li>
        <li>En <b>Pantalla de consentimiento de OAuth</b>, elige «Externo» y agrega tu correo como usuario de prueba.</li>
        <li>En <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credenciales</a> → <b>Crear credenciales</b> → <b>ID de cliente de OAuth</b>, tipo «Aplicación web».</li>
        <li>En <b>URIs de redireccionamiento autorizados</b>, pega esta dirección: <code className="break-all">{g.vuelta}</code> <Copiar texto={g.vuelta} etiqueta="Copiar" /></li>
        <li>Copia el ID de cliente y el secreto aquí:</li>
      </ol>
      <input aria-label="ID de cliente" className="campo" placeholder="ID de cliente (termina en .apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
      <input aria-label="Secreto del cliente" className="campo" type="password" placeholder="Secreto del cliente" value={secreto} onChange={(e) => setSecreto(e.target.value)} autoComplete="off" />
      {falla && <Aviso tipo="error">{falla}</Aviso>}
      <button type="button" className="boton boton-primario" disabled={ocupado || !clientId.trim() || !secreto.trim()} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar"}</button>
    </div>
  );
}

function Nuevo({ alCrear }: { alCrear: () => void }) {
  const [referencia, setReferencia] = useState("");
  const [tipo, setTipo] = useState<Tipo | "">("");
  const [falla, setFalla] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function crear() {
    setOcupado(true);
    setFalla(null);
    try {
      await postJson("/api/invitaciones/formularios", { referencia, tipo: tipo || undefined, zona: zonaLocal() });
      setReferencia("");
      alCrear();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input aria-label="¿Para quién es?" className="campo min-w-48 flex-1" maxLength={80} placeholder="¿Para quién es? Por ejemplo: Boda de Ana" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        <select aria-label="Tipo de evento" className="campo w-auto" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo | "")}>
          <option value="">Que lo elija el cliente</option>
          {TIPOS.map((t) => <option key={t} value={t}>{TIPOS_INFO[t].nombre}</option>)}
        </select>
        <button type="button" className="boton boton-primario" disabled={ocupado || !referencia.trim()} onClick={crear}>{ocupado ? "Creando…" : "Crear formulario"}</button>
      </div>
      {falla && <Aviso tipo="error">{falla}</Aviso>}
    </div>
  );
}

function FilaPedido({ p, alCambiar }: { p: Pedido; alCambiar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const mensaje = `¡Hola! Para armar tu invitación digital, llena este formulario (toma unos 3 minutos): ${p.enlace}`;

  async function revisar() {
    setOcupado(true);
    setFalla(null);
    try {
      await postJson(`/api/invitaciones/formularios/${p.id}`, {});
      alCambiar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }
  async function quitar() {
    if (!confirm(`¿Quitar «${p.referencia}» de esta lista? El formulario sigue en tu Google Forms (puedes borrarlo allí). La invitación, si ya se hizo, no se borra.`)) return;
    await pedir(`/api/invitaciones/formularios/${p.id}`, { method: "DELETE" });
    alCambiar();
  }

  return (
    <li className="tarjeta space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{p.referencia}</span>
        <span className={`text-xs ${p.slug && !p.problemas.length ? "text-emerald-400" : p.problemas.length ? "text-amber-400" : "text-tenue"}`}>
          {p.problemas.length ? "Respondió: falta corregir algo" : p.slug ? "✓ Respondió: invitación lista" : "Esperando la respuesta…"}
        </span>
      </div>
      {p.problemas.length > 0 && (
        <Aviso tipo="alerta">
          <ul className="list-disc pl-4">{p.problemas.map((x) => <li key={x}>{x}</li>)}</ul>
          <Link className="boton mt-2" href={`/invitaciones/nueva?formulario=${p.id}`}>Completar con sus respuestas</Link>
        </Aviso>
      )}
      {p.avisos.length > 0 && !p.problemas.length && <ul className="list-disc pl-5 text-xs text-tenue">{p.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
      {falla && <Aviso tipo="error">{falla}</Aviso>}
      <div className="flex flex-wrap gap-2">
        {p.slug && <Link className="boton boton-primario" href={`/invitaciones/${p.slug}`}>Ver invitación</Link>}
        <a className="boton" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener">Mandar por WhatsApp</a>
        <Copiar texto={p.enlace} etiqueta="Copiar enlace" />
        <button type="button" className="boton" disabled={ocupado} onClick={revisar}>{ocupado ? "Buscando…" : "Buscar respuesta"}</button>
        <a className="boton" href={p.editar} target="_blank" rel="noopener">Abrir en Google Forms</a>
        <button type="button" className="boton" onClick={quitar}>Quitar</button>
      </div>
      {p.slug && <p className="text-xs text-tenue">Si el cliente cambia su respuesta, la invitación se actualiza sola (tus correcciones a mano se conservan).</p>}
    </li>
  );
}

/** «Pedir los datos con Google Forms»: el cliente llena un formulario y su respuesta arma la invitación. */
export function PanelFormularios({ alLlegar }: { alLlegar: () => void }) {
  const params = useSearchParams();
  const { datos, error, recargar } = useSondeo<Datos>("/api/invitaciones/formularios", 120_000);
  const [abierto, setAbierto] = useState(params.has("google"));
  const [falla, setFalla] = useState<string | null>(null);
  const g = datos?.google;
  const pedidosRef = useRef<Pedido[]>([]);
  const alLlegarRef = useRef(alLlegar);
  useEffect(() => {
    pedidosRef.current = datos?.pedidos ?? [];
    alLlegarRef.current = alLlegar;
  });
  const conectado = !!g?.conectado;

  // Mientras esta pantalla está abierta, busca respuestas de los formularios que esperan una.
  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    async function ronda() {
      if (document.hidden) return;
      let llego = false;
      // Los de los últimos 60 días: el cliente puede cambiar su respuesta y la invitación se actualiza.
      const recientes = pedidosRef.current.filter((p) => Date.now() - Date.parse(p.creado) < 60 * 86_400_000);
      for (const p of recientes) {
        const r = await postJson<{ nueva: boolean }>(`/api/invitaciones/formularios/${p.id}`, {}).catch(() => null);
        if (r?.nueva) llego = true;
      }
      if (llego && vivo) {
        await recargar();
        alLlegarRef.current();
      }
    }
    const t = setInterval(ronda, REVISAR_MS);
    void ronda();
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [conectado, recargar]);

  async function desconectar() {
    if (!confirm("¿Desconectar Google? Los formularios que ya creaste siguen en tu cuenta, pero Geeper no podrá leer sus respuestas hasta que vuelvas a conectar.")) return;
    setFalla(null);
    try {
      await pedir("/api/invitaciones/formularios/google", { method: "DELETE" });
      await recargar();
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="tarjeta space-y-3 p-4">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <span>
          <span className="block font-medium">📝 Pedirle los datos al cliente con Google Forms</span>
          <span className="block text-sm text-tenue">Le mandas un enlace, llena sus datos y la invitación se arma sola con su respuesta.</span>
        </span>
        <span aria-hidden className="text-tenue">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <div className="space-y-4">
          {params.get("google") === "ok" && <Aviso tipo="info">Listo: Google quedó conectado.</Aviso>}
          {params.get("google") === "error" && <Aviso tipo="error">{params.get("error") ?? "No se pudo conectar Google."}</Aviso>}
          {error && <Aviso tipo="error">{error}</Aviso>}
          {falla && <Aviso tipo="error">{falla}</Aviso>}
          {g && !g.app && <AppGoogle g={g} alGuardar={() => void recargar()} />}
          {g?.app && !g.conectado && (
            <div className="space-y-2 text-sm">
              {g.deYoutube && (
                <p className="text-tenue">
                  Se usa tu app de YouTube. Antes de conectar, en Google Cloud activa <a className="underline" href="https://console.cloud.google.com/apis/library/forms.googleapis.com" target="_blank" rel="noopener">Google Forms API</a> y
                  agrega este URI de redireccionamiento a esa app: <code className="break-all">{g.vuelta}</code> <Copiar texto={g.vuelta} etiqueta="Copiar" />
                </p>
              )}
              <p>Conecta la cuenta de Google donde quieres que queden los formularios y sus respuestas.</p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- es una ruta de API que redirige a Google */}
              <a className="boton boton-primario" href="/api/cuentas/conectar/formularios">Conectar con Google</a>
            </div>
          )}
          {g?.conectado && (
            <>
              <p className="text-xs text-tenue">
                Conectado{g.correo ? ` como ${g.correo}` : ""}. <button type="button" className="underline" onClick={desconectar}>Desconectar</button>
              </p>
              <Nuevo alCrear={() => void recargar()} />
            </>
          )}
          {!!datos?.pedidos.length && (
            <ul className="space-y-3">
              {datos.pedidos.map((p) => <FilaPedido key={p.id} p={p} alCambiar={() => { void recargar(); alLlegar(); }} />)}
            </ul>
          )}
          {g?.conectado && !!datos?.pedidos.length && <p className="text-xs text-tenue">Mientras tengas esta pantalla abierta, Geeper busca respuestas nuevas cada minuto.</p>}
        </div>
      )}
    </section>
  );
}
