"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PLANTILLAS_INFO, TIPOS_INFO } from "@/lib/invitaciones/catalogo";
import { PLANTILLAS, TIPOS, type Invitacion, type PlantillaId, type Tipo } from "@/lib/invitaciones/esquema";
import { Aviso, postJson } from "./comun";

const zonaLocal = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
  } catch {
    return "America/Mexico_City";
  }
};

/** Muestra chiquita de cada estilo: fondo, tarjeta y sello. */
function MuestraEstilo({ id }: { id: PlantillaId }) {
  const c = PLANTILLAS_INFO[id].colores;
  return (
    <div className="flex h-24 items-center justify-center rounded-lg" style={{ background: `radial-gradient(circle at 50% 0%, ${c.fondo2}, ${c.fondo})` }} aria-hidden>
      <div className="relative h-12 w-[4.5rem] rounded" style={{ background: c.sobre }}>
        <div className="absolute inset-x-0 top-0 h-7" style={{ background: c.sobre, filter: "brightness(1.15)", clipPath: "polygon(0 0,100% 0,50% 100%)" }} />
        <div className="absolute left-1/2 top-7 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: c.sello }} />
      </div>
    </div>
  );
}

export function FormInvitacion({ inicial }: { inicial?: Invitacion }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo>(inicial?.tipo ?? "boda");
  const [nombres, setNombres] = useState(inicial?.nombres ?? "");
  const [fecha, setFecha] = useState(inicial?.fecha ?? "");
  const [hora, setHora] = useState(inicial?.hora ?? "18:00");
  const [zona] = useState(inicial?.zona ?? zonaLocal());
  const [lugarNombre, setLugarNombre] = useState(inicial?.lugar.nombre ?? "");
  const [direccion, setDireccion] = useState(inicial?.lugar.direccion ?? "");
  const [mapa, setMapa] = useState(inicial?.lugar.mapa ?? "");
  const [whatsapp, setWhatsapp] = useState(inicial?.whatsapp ?? "");
  const [plantilla, setPlantilla] = useState<PlantillaId | "">(inicial?.plantilla ?? "");
  const [mensaje, setMensaje] = useState(inicial?.mensaje ?? "");
  const [ideasIa, setIdeasIa] = useState<string[]>([]);
  const [pensando, setPensando] = useState(false);
  const [musicaModo, setMusicaModo] = useState<"enlace" | "archivo" | "ninguna">(inicial?.musica.tipo === "archivo" ? "archivo" : inicial?.musicaEnlace ? "enlace" : "enlace");
  const [musicaEnlace, setMusicaEnlace] = useState(inicial?.musicaEnlace ?? "");
  const [audio, setAudio] = useState<File | null>(null);
  const [audioInicio, setAudioInicio] = useState(0);
  const [permiso, setPermiso] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [quitarFoto, setQuitarFoto] = useState(false);
  const [dressEstilo, setDressEstilo] = useState(inicial?.dressCode.estilo ?? "");
  const [usarColores, setUsarColores] = useState((inicial?.dressCode.colores.length ?? 0) > 0);
  const [colores, setColores] = useState<string[]>(inicial?.dressCode.colores.length ? inicial.dressCode.colores : []);
  const [evitar, setEvitar] = useState(inicial?.dressCode.evitar ?? "");
  const [confirmarAntes, setConfirmarAntes] = useState(inicial?.confirmarAntes ?? "");
  const [pases, setPases] = useState(inicial?.pases ? String(inicial.pases) : "");
  const [regalos, setRegalos] = useState(inicial?.regalos ?? "");
  const [hashtag, setHashtag] = useState(inicial?.hashtag ?? "");
  const [duracion, setDuracion] = useState(String(inicial?.duracionHoras ?? 5));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = TIPOS_INFO[tipo];
  const estilo: PlantillaId = plantilla || info.plantilla;
  const coloresDress = usarColores ? (colores.length ? colores : PLANTILLAS_INFO[estilo].dress) : [];
  const hoy = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tieneAudioPropio = inicial?.musica.tipo === "archivo";
  const digitos = whatsapp.replace(/\D/g, "");
  const listo = nombres.trim() && fecha && hora && lugarNombre.trim() && digitos.length >= 8 && (musicaModo !== "archivo" || !audio || permiso);

  async function ideasConIa() {
    setPensando(true);
    setError(null);
    try {
      const r = await postJson<{ mensajes: string[] }>("/api/invitaciones/mensaje", { tipo, nombres: nombres.trim() || info.nombre });
      setIdeasIa(r.mensajes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPensando(false);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const datos = {
      tipo, nombres, fecha, hora, zona, duracionHoras: Number(duracion) || 5,
      lugar: { nombre: lugarNombre, direccion, mapa },
      whatsapp, plantilla: estilo, mensaje,
      musicaEnlace: musicaModo === "enlace" ? musicaEnlace : "",
      dressCode: { estilo: dressEstilo, colores: coloresDress, evitar },
      confirmarAntes, pases: pases ? Number(pases) : undefined, regalos, hashtag,
    };
    const fd = new FormData();
    fd.set("datos", JSON.stringify(datos));
    if (foto) fd.set("foto", foto);
    if (quitarFoto) fd.set("quitarFoto", "1");
    if (musicaModo === "archivo" && audio) {
      fd.set("audio", audio);
      fd.set("audioInicio", String(audioInicio));
      if (permiso) fd.set("permisoAudio", "1");
    }
    if (musicaModo !== "archivo" && tieneAudioPropio) fd.set("quitarAudio", "1");
    try {
      const r = await fetch(inicial ? `/api/invitaciones/${inicial.slug}` : "/api/invitaciones", { method: inicial ? "PUT" : "POST", body: fd });
      const d = (await r.json().catch(() => ({}))) as { slug?: string; avisos?: string[]; error?: string };
      if (!r.ok || !d.slug) throw new Error(d.error ?? `Error ${r.status}`);
      const avisos = d.avisos?.length ? `?avisos=${encodeURIComponent(JSON.stringify(d.avisos))}` : "";
      router.push(`/invitaciones/${d.slug}${avisos}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-7">
      <section>
        <h2 className="mb-2 font-medium">1. ¿Qué celebras?</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de evento">
          {TIPOS.map((t) => (
            <label key={t} className={`boton cursor-pointer justify-center ${tipo === t ? "boton-primario" : ""}`}>
              <input type="radio" name="inv-tipo" className="sr-only" checked={tipo === t} onChange={() => { setTipo(t); setIdeasIa([]); }} />
              {TIPOS_INFO[t].nombre}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">2. ¿Quién invita?</h2>
        <label className="etiqueta" htmlFor="inv-nombres">{tipo === "boda" ? "Los nombres de los novios" : "Nombre (o nombres)"}</label>
        <input id="inv-nombres" className="campo" value={nombres} maxLength={80} onChange={(e) => setNombres(e.target.value)} placeholder={tipo === "boda" ? "Ana & Luis" : "Sofía"} required />
      </section>

      <section>
        <h2 className="mb-2 font-medium">3. ¿Cuándo?</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiqueta" htmlFor="inv-fecha">Día</label>
            <input id="inv-fecha" type="date" className="campo" min={inicial ? undefined : hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </div>
          <div>
            <label className="etiqueta" htmlFor="inv-hora">Hora</label>
            <input id="inv-hora" type="time" className="campo" value={hora} onChange={(e) => setHora(e.target.value)} required />
          </div>
        </div>
        <p className="mt-1 text-xs text-tenue">Hora de {zona.split("/").pop()?.replace(/_/g, " ")}. Si alguien la abre desde otro país, la invitación lo aclara.</p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">4. ¿Dónde?</h2>
        <label className="etiqueta" htmlFor="inv-lugar">Nombre del lugar</label>
        <input id="inv-lugar" className="campo" value={lugarNombre} maxLength={100} onChange={(e) => setLugarNombre(e.target.value)} placeholder="Hacienda Las Mercedes" required />
        <label className="etiqueta mt-3" htmlFor="inv-direccion">Dirección (opcional)</label>
        <input id="inv-direccion" className="campo" value={direccion} maxLength={200} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, número, ciudad" />
        <label className="etiqueta mt-3" htmlFor="inv-mapa">Enlace de Google Maps (opcional, el más exacto)</label>
        <input id="inv-mapa" className="campo" inputMode="url" value={mapa} onChange={(e) => setMapa(e.target.value)} placeholder="https://maps.app.goo.gl/…" />
        <p className="mt-1 text-xs text-tenue">Búscalo en Google Maps → Compartir → Copiar enlace. Si no lo pones, se busca por el nombre y la dirección.</p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">5. ¿A qué WhatsApp llegan las confirmaciones?</h2>
        <label className="etiqueta" htmlFor="inv-wa">Número con código de país</label>
        <input id="inv-wa" className="campo" inputMode="tel" autoComplete="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="52 55 1234 5678" required />
        <p className={`mt-1 text-xs ${whatsapp && digitos.length < 8 ? "text-red-400" : "text-tenue"}`}>
          Cada invitado confirma con un botón y te llega un mensaje listo. Quien tenga el enlace de la invitación verá este número.
        </p>
      </section>

      <details className="tarjeta p-4" open={!!inicial}>
        <summary className="cursor-pointer font-medium">Más detalles (opcional: todo tiene un valor listo)</summary>
        <div className="mt-4 space-y-6">
          <fieldset>
            <legend className="etiqueta">Estilo</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {PLANTILLAS.map((p) => (
                <label key={p} className={`tarjeta cursor-pointer p-2 ${estilo === p ? "ring-2 ring-cyan-600" : ""}`}>
                  <input type="radio" name="inv-estilo" className="sr-only" checked={estilo === p} onChange={() => setPlantilla(p)} />
                  <MuestraEstilo id={p} />
                  <span className="mt-2 block text-sm font-medium">{PLANTILLAS_INFO[p].nombre}{p === info.plantilla ? " (recomendado)" : ""}</span>
                  <span className="block text-xs text-tenue">{PLANTILLAS_INFO[p].desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="etiqueta" htmlFor="inv-foto">Foto para el sobre</label>
            <input id="inv-foto" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/avif" className="campo" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
            {inicial?.foto && !foto && (
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={quitarFoto} onChange={(e) => setQuitarFoto(e.target.checked)} />Quitar la foto actual</label>
            )}
            <p className="mt-1 text-xs text-tenue">Sale dentro del sobre al abrirlo. Sin foto, lleva sus iniciales.</p>
          </div>

          <fieldset>
            <legend className="etiqueta">Mensaje</legend>
            <div className="space-y-2">
              {[...info.mensajes, ...ideasIa].map((m) => (
                <label key={m} className={`tarjeta flex cursor-pointer gap-2 p-3 text-sm ${mensaje === m ? "ring-2 ring-cyan-600" : ""}`}>
                  <input type="radio" name="inv-mensaje" className="mt-1" checked={mensaje === m} onChange={() => setMensaje(m)} />
                  <span>{m}</span>
                </label>
              ))}
            </div>
            <label className="etiqueta mt-3" htmlFor="inv-mensaje">O escríbelo (puedes editar el que elegiste)</label>
            <textarea id="inv-mensaje" className="campo min-h-20" maxLength={600} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder={info.mensajes[0]} />
            <button type="button" className="boton mt-2" onClick={ideasConIa} disabled={pensando}>{pensando ? "Pensando… (hasta 1 min)" : "✨ Escríbelo por mí con IA"}</button>
            <p className="mt-1 text-xs text-tenue">Usa el modelo de tu PC un momento. Si lo dejas vacío, va el primero de la lista.</p>
          </fieldset>

          <fieldset>
            <legend className="etiqueta">Música</legend>
            <div className="flex flex-wrap gap-2">
              {([["enlace", "Canción de Spotify o YouTube"], ["archivo", "Audio propio"], ["ninguna", "Sin música"]] as const).map(([v, n]) => (
                <label key={v} className={`boton cursor-pointer ${musicaModo === v ? "boton-primario" : ""}`}>
                  <input type="radio" name="inv-musica" className="sr-only" checked={musicaModo === v} onChange={() => setMusicaModo(v)} />{n}
                </label>
              ))}
            </div>
            {musicaModo === "enlace" && (
              <>
                <input aria-label="Enlace de la canción" className="campo mt-2" inputMode="url" value={musicaEnlace} onChange={(e) => setMusicaEnlace(e.target.value)} placeholder="https://open.spotify.com/track/…" />
                <p className="mt-1 text-xs text-tenue">En Spotify: ⋯ → Compartir → Copiar enlace. El invitado la escucha con el botón ▶ (la recomendada: la canción la pone quien tiene los derechos).</p>
              </>
            )}
            {musicaModo === "archivo" && (
              <div className="mt-2 space-y-2">
                {tieneAudioPropio && !audio && <p className="text-xs text-tenue">Ya tiene una canción propia. Sube otra sólo si quieres cambiarla.</p>}
                <input aria-label="Archivo de audio" type="file" accept="audio/*" className="campo" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
                {audio && (
                  <>
                    <label className="etiqueta" htmlFor="inv-inicio">Empezar desde el segundo</label>
                    <input id="inv-inicio" type="number" min={0} max={600} className="campo w-32" value={audioInicio} onChange={(e) => setAudioInicio(Number(e.target.value))} />
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={permiso} onChange={(e) => setPermiso(e.target.checked)} />
                      <span>Tengo permiso para usar este audio (es mío, es música libre o tengo licencia).
                        <span className="block text-xs text-tenue">Suena solo al abrir el sobre. Se recorta a 90 s.</span></span>
                    </label>
                  </>
                )}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="etiqueta">Código de vestimenta</legend>
            <input aria-label="Estilo de vestimenta" className="campo" value={dressEstilo} maxLength={40} onChange={(e) => setDressEstilo(e.target.value)} placeholder="Formal, cóctel, casual…" />
            <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={usarColores} onChange={(e) => setUsarColores(e.target.checked)} />Sugerir colores</label>
            {usarColores && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {coloresDress.map((c, i) => (
                  <input key={i} type="color" aria-label={`Color ${i + 1}`} value={c} className="h-10 w-12 cursor-pointer rounded"
                    onChange={(e) => setColores(coloresDress.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
                {coloresDress.length < 4 && <button type="button" className="boton" onClick={() => setColores([...coloresDress, "#cccccc"])}>+ color</button>}
                {coloresDress.length > 1 && <button type="button" className="boton" onClick={() => setColores(coloresDress.slice(0, -1))}>− color</button>}
              </div>
            )}
            <input aria-label="Colores a evitar" className="campo mt-2" value={evitar} maxLength={120} onChange={(e) => setEvitar(e.target.value)} placeholder="Evitar el blanco y el rojo intenso" />
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="etiqueta" htmlFor="inv-limite">Confirmar antes del</label>
              <input id="inv-limite" type="date" className="campo" value={confirmarAntes} max={fecha || undefined} onChange={(e) => setConfirmarAntes(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="inv-pases">Pases por invitación</label>
              <input id="inv-pases" type="number" min={1} max={20} className="campo" value={pases} onChange={(e) => setPases(e.target.value)} placeholder="Sin límite" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="inv-duracion">Duración (horas)</label>
              <input id="inv-duracion" type="number" min={1} max={24} className="campo" value={duracion} onChange={(e) => setDuracion(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="inv-regalos">Regalos (opcional)</label>
              <textarea id="inv-regalos" className="campo min-h-16" maxLength={300} value={regalos} onChange={(e) => setRegalos(e.target.value)} placeholder="Mesa de regalos, lluvia de sobres…" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="inv-hashtag">Hashtag (opcional)</label>
              <input id="inv-hashtag" className="campo" maxLength={40} value={hashtag} onChange={(e) => setHashtag(e.target.value)} placeholder="#AnaYLuis2026" />
            </div>
          </div>
        </div>
      </details>

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="boton boton-primario" disabled={enviando || !listo}>{enviando ? "Creando…" : inicial ? "Guardar cambios" : "Crear invitación"}</button>
        <span className="text-xs text-tenue">Tarda unos segundos. No usa la tarjeta de video.</span>
      </div>
    </form>
  );
}
