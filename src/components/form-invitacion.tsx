"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PLANTILLAS_INFO, TIPOS_INFO } from "@/lib/invitaciones/catalogo";
import { EFECTOS_SOBRE, PLANTILLAS, TIPOS, type EfectoSobre, type EstiloId, type Invitacion, type Tipo } from "@/lib/invitaciones/esquema";
import { NOMBRES_EFECTO } from "@/lib/invitaciones/efecto-sobre";
import { NOMBRE_ADORNO, NOMBRE_PARTICULAS, type Tema } from "@/lib/invitaciones/tema";
import { Aviso, postJson } from "./comun";

const zonaLocal = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
  } catch {
    return "America/Mexico_City";
  }
};

const IDEAS = ["Un bosque encantado con luciérnagas", "Bajo el mar, con sirenas", "Noche de estrellas", "Cuento de princesas", "Gala dorada estilo años 20", "Jardín en flor"];

/** Muestra chiquita de un estilo: fondo, sobre y sello. */
function MuestraEstilo({ c }: { c: { fondo: string; fondo2: string; sobre: string; sello: string } }) {
  return (
    <div className="flex h-24 items-center justify-center rounded-lg" style={{ background: `radial-gradient(circle at 50% 0%, ${c.fondo2}, ${c.fondo})` }} aria-hidden>
      <div className="relative h-12 w-[4.5rem] rounded" style={{ background: c.sobre }}>
        <div className="absolute inset-x-0 top-0 h-7" style={{ background: c.sobre, filter: "brightness(1.15)", clipPath: "polygon(0 0,100% 0,50% 100%)" }} />
        <div className="absolute left-1/2 top-7 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: c.sello }} />
      </div>
    </div>
  );
}

/** Lo que llegó de un formulario de Google con algún dato por corregir (formularios.ts). */
export interface BorradorFormulario {
  formulario: string;
  datos: Partial<Omit<Invitacion, "lugar" | "dressCode">> & { lugar?: Partial<Invitacion["lugar"]>; dressCode?: Partial<Invitacion["dressCode"]> };
}

export function FormInvitacion({ inicial, desde }: { inicial?: Invitacion; desde?: BorradorFormulario }) {
  const router = useRouter();
  const ini = inicial ?? desde?.datos;
  const [tipo, setTipo] = useState<Tipo>(ini?.tipo ?? "boda");
  const [nombres, setNombres] = useState(ini?.nombres ?? "");
  const [fecha, setFecha] = useState(ini?.fecha ?? "");
  const [hora, setHora] = useState(ini?.hora ?? "18:00");
  const [zona] = useState(ini?.zona ?? zonaLocal());
  const [lugarNombre, setLugarNombre] = useState(ini?.lugar?.nombre ?? "");
  const [direccion, setDireccion] = useState(ini?.lugar?.direccion ?? "");
  const [mapa, setMapa] = useState(ini?.lugar?.mapa ?? "");
  const [whatsapp, setWhatsapp] = useState(ini?.whatsapp ?? "");
  const [plantilla, setPlantilla] = useState<EstiloId | "">(ini?.plantilla ?? "");
  const [tema, setTema] = useState<Tema | null>(ini?.tema ?? null);
  const [idea, setIdea] = useState(ini?.tema?.idea ?? "");
  const [disenando, setDisenando] = useState(false);
  const [avisoTema, setAvisoTema] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [mensaje, setMensaje] = useState(ini?.mensaje ?? "");
  const [ideasIa, setIdeasIa] = useState<string[]>([]);
  const [pensando, setPensando] = useState(false);
  const [musicaModo, setMusicaModo] = useState<"enlace" | "archivo" | "ninguna">(inicial?.musica.tipo === "archivo" ? "archivo" : ini?.musicaEnlace ? "enlace" : "enlace");
  const [musicaEnlace, setMusicaEnlace] = useState(inicial?.musicaEnlace ?? "");
  const [audio, setAudio] = useState<File | null>(null);
  const [audioInicio, setAudioInicio] = useState(0);
  const [permiso, setPermiso] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [quitarFoto, setQuitarFoto] = useState(false);
  const [fotoIdea, setFotoIdea] = useState("");
  const [dressEstilo, setDressEstilo] = useState(ini?.dressCode?.estilo ?? "");
  const [usarColores, setUsarColores] = useState((ini?.dressCode?.colores?.length ?? 0) > 0);
  const [colores, setColores] = useState<string[]>(ini?.dressCode?.colores?.length ? ini.dressCode.colores : []);
  const [evitar, setEvitar] = useState(ini?.dressCode?.evitar ?? "");
  const [confirmarAntes, setConfirmarAntes] = useState(ini?.confirmarAntes ?? "");
  const [pases, setPases] = useState(ini?.pases ? String(ini.pases) : "");
  const [regalos, setRegalos] = useState(ini?.regalos ?? "");
  const [hashtag, setHashtag] = useState(ini?.hashtag ?? "");
  const [efectoSobre, setEfectoSobre] = useState<EfectoSobre>(ini?.efectoSobre ?? "auto");
  const [duracion, setDuracion] = useState(String(ini?.duracionHoras ?? 5));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = TIPOS_INFO[tipo];
  const estilo: EstiloId = plantilla === "tema" && !tema ? info.plantilla : plantilla || info.plantilla;
  const dressSugerido = estilo === "tema" && tema ? (tema.dress.length ? tema.dress : PLANTILLAS_INFO[info.plantilla].dress) : PLANTILLAS_INFO[estilo === "tema" ? info.plantilla : estilo].dress;
  const coloresDress = usarColores ? (colores.length ? colores : dressSugerido) : [];
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

  function datosFormulario() {
    return {
      tipo, nombres, fecha, hora, zona, duracionHoras: Number(duracion) || 5,
      lugar: { nombre: lugarNombre, direccion, mapa },
      whatsapp, plantilla: estilo, tema: estilo === "tema" && tema ? tema : undefined, mensaje,
      musicaEnlace: musicaModo === "enlace" ? musicaEnlace : "",
      dressCode: { estilo: dressEstilo, colores: coloresDress, evitar },
      confirmarAntes, pases: pases ? Number(pases) : undefined, regalos, hashtag, efectoSobre,
    };
  }

  /** Pone el tema y, si la persona no los escribió, su mensaje y su dress code. */
  function usarTema(t: Tema) {
    setTema(t);
    setPlantilla("tema");
    setPrevia(null);
    if (t.mensaje && (!mensaje.trim() || mensaje === tema?.mensaje || info.mensajes.includes(mensaje))) setMensaje(t.mensaje);
    if (t.dress.length && !colores.length) setUsarColores(true);
    if (t.dressEstilo && (!dressEstilo.trim() || dressEstilo === tema?.dressEstilo)) setDressEstilo(t.dressEstilo);
  }

  async function disenarTema(sinIa = false) {
    setDisenando(true);
    setAvisoTema(null);
    try {
      const r = await postJson<{ tema: Tema; conIa: boolean; aviso?: string }>("/api/invitaciones/tema", { idea, tipo, nombres, sinIa });
      usarTema(r.tema);
      setAvisoTema(r.aviso ?? null);
    } catch (e) {
      setAvisoTema(e instanceof Error ? e.message : String(e));
    } finally {
      setDisenando(false);
    }
  }

  function cambiarColorTema(clave: keyof Tema["colores"], valor: string) {
    if (!tema) return;
    setTema({ ...tema, colores: { ...tema.colores, [clave]: valor } });
    setPrevia(null);
  }

  async function verPrevia() {
    setCargandoPrevia(true);
    setError(null);
    try {
      const r = await postJson<{ html: string }>("/api/invitaciones/vista-previa", { ...datosFormulario(), whatsapp: whatsapp || undefined });
      setPrevia(r.html);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargandoPrevia(false);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const datos = datosFormulario();
    const fd = new FormData();
    fd.set("datos", JSON.stringify(datos));
    if (desde && !inicial) fd.set("formulario", desde.formulario);
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
      // La foto con IA se pide en la página de la invitación (usa la tarjeta: ahí está el aviso de guardar antes).
      const q = new URLSearchParams();
      if (d.avisos?.length) q.set("avisos", JSON.stringify(d.avisos));
      if (!foto && fotoIdea.trim()) q.set("foto", fotoIdea.trim());
      router.push(`/invitaciones/${d.slug}${q.size ? `?${q}` : ""}`);
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

      <section>
        <h2 className="mb-2 font-medium">6. ¿Tienes una idea de tema? (opcional)</h2>
        <label className="etiqueta" htmlFor="inv-idea">Descríbelo como quieras: Geeper elige los colores, las letras, los adornos, la animación y los textos</label>
        <textarea id="inv-idea" className="campo min-h-20" maxLength={300} value={idea} onChange={(e) => setIdea(e.target.value)}
          placeholder="Un bosque encantado con luciérnagas, hongos y tonos verdes con dorado" />
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Ideas de ejemplo">
          {IDEAS.map((i) => <button key={i} type="button" className="rounded-full border border-borde px-3 py-1 text-xs text-tenue hover:text-white" onClick={() => setIdea(i)}>{i}</button>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="boton boton-primario" disabled={disenando || idea.trim().length < 3} onClick={() => disenarTema()}>
            {disenando ? "Diseñando… (la primera vez hasta 3 min)" : tema && estilo === "tema" ? "✨ Otra versión" : "✨ Diseñar mi tema"}
          </button>
          {tema && estilo === "tema" && <button type="button" className="boton" onClick={() => setPlantilla(info.plantilla)}>Quitar tema</button>}
        </div>
        <p className="mt-1 text-xs text-tenue">Usa la IA de tu PC un momento. Si está ocupada, se arma con las palabras que escribiste.</p>
        {avisoTema && <div className="mt-2"><Aviso tipo="alerta">{avisoTema}</Aviso></div>}
        {tema && estilo === "tema" && (
          <div className="tarjeta mt-3 flex flex-wrap items-center gap-4 p-3">
            <div className="w-28 shrink-0"><MuestraEstilo c={tema.colores} /></div>
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p className="font-medium">{tema.nombre}</p>
              <p className="text-xs text-tenue">Adornos: {NOMBRE_ADORNO[tema.adorno]} · {tema.particulas === "ninguna" ? NOMBRE_PARTICULAS.ninguna : `fondo con ${NOMBRE_PARTICULAS[tema.particulas]}`} · letras {tema.letras.titulos}</p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {([["fondo", "Fondo"], ["tarjeta", "Tarjetas"], ["acento", "Detalles"], ["sobre", "Sobre"], ["sello", "Sello"]] as const).map(([k, n]) => (
                  <label key={k} className="flex items-center gap-1 text-xs text-tenue">
                    <input type="color" aria-label={`Color: ${n}`} value={tema.colores[k]} onChange={(e) => cambiarColorTema(k, e.target.value)} className="h-7 w-9 cursor-pointer rounded" />{n}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <details className="tarjeta p-4" open={!!inicial}>
        <summary className="cursor-pointer font-medium">Más detalles (opcional: todo tiene un valor listo)</summary>
        <div className="mt-4 space-y-6">
          <fieldset>
            <legend className="etiqueta">Estilo</legend>
            <div className={`grid gap-3 ${tema ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              {tema && (
                <label className={`tarjeta cursor-pointer p-2 ${estilo === "tema" ? "ring-2 ring-cyan-600" : ""}`}>
                  <input type="radio" name="inv-estilo" className="sr-only" checked={estilo === "tema"} onChange={() => setPlantilla("tema")} />
                  <MuestraEstilo c={tema.colores} />
                  <span className="mt-2 block text-sm font-medium">✨ {tema.nombre}</span>
                  <span className="block text-xs text-tenue">Tu tema</span>
                </label>
              )}
              {PLANTILLAS.map((p) => (
                <label key={p} className={`tarjeta cursor-pointer p-2 ${estilo === p ? "ring-2 ring-cyan-600" : ""}`}>
                  <input type="radio" name="inv-estilo" className="sr-only" checked={estilo === p} onChange={() => { setPlantilla(p); setPrevia(null); }} />
                  <MuestraEstilo c={PLANTILLAS_INFO[p].colores} />
                  <span className="mt-2 block text-sm font-medium">{PLANTILLAS_INFO[p].nombre}{p === info.plantilla ? " (recomendado)" : ""}</span>
                  <span className="block text-xs text-tenue">{PLANTILLAS_INFO[p].desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="etiqueta" htmlFor="inv-efecto">Efecto al abrir el sobre</label>
            <select id="inv-efecto" className="campo" value={efectoSobre} onChange={(e) => setEfectoSobre(e.target.value as EfectoSobre)}>
              {EFECTOS_SOBRE.map((k) => <option key={k} value={k}>{NOMBRES_EFECTO[k]}</option>)}
            </select>
            <p className="mt-1 text-xs text-tenue">Lo que sale volando del sobre cuando el invitado toca el sello.</p>
          </div>

          <div>
            <label className="etiqueta" htmlFor="inv-foto">Foto para el sobre</label>
            <input id="inv-foto" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/avif" className="campo" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
            {inicial?.foto && !foto && (
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={quitarFoto} onChange={(e) => setQuitarFoto(e.target.checked)} />Quitar la foto actual</label>
            )}
            <p className="mt-1 text-xs text-tenue">Sale dentro del sobre al abrirlo. Sin foto, lleva sus iniciales.</p>
            {!foto && (
              <>
                <label className="etiqueta mt-3" htmlFor="inv-foto-ia">¿No tienes foto? Descríbela y Geeper la dibuja con IA (opcional)</label>
                <input id="inv-foto-ia" className="campo" maxLength={400} value={fotoIdea} onChange={(e) => setFotoIdea(e.target.value)}
                  placeholder={tema && estilo === "tema" ? `Por ejemplo: ${tema.idea || tema.nombre}` : "Por ejemplo: dos anillos de oro sobre pétalos de rosa"} />
                <p className="mt-1 text-xs text-tenue">Al crear la invitación te la dejo lista para dibujar: 4 opciones en 1 a 3 minutos (usa la tarjeta de video) y eliges una.</p>
              </>
            )}
          </div>

          <fieldset>
            <legend className="etiqueta">Mensaje</legend>
            <div className="space-y-2">
              {[...new Set([...(estilo === "tema" && tema?.mensaje ? [tema.mensaje] : []), ...info.mensajes, ...ideasIa])].map((m) => (
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

      {previa && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Así va quedando</h2>
            <button type="button" className="boton" onClick={() => setPrevia(null)}>Cerrar vista</button>
          </div>
          <div className="mx-auto max-w-full rounded-[2.2rem] border-[8px] border-neutral-800 bg-black" style={{ width: 406, height: 760 }}>
            <iframe title="Vista previa de la invitación" srcDoc={previa} className="h-full w-full rounded-[1.7rem] bg-white" sandbox="allow-scripts" />
          </div>
          <p className="text-center text-xs text-tenue">Toca el sello para abrirla. La foto y tu audio aparecen al crearla.</p>
        </section>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="boton" disabled={cargandoPrevia} onClick={verPrevia}>{cargandoPrevia ? "Armando la vista…" : previa ? "Actualizar vista" : "Ver cómo queda"}</button>
        <button className="boton boton-primario" disabled={enviando || !listo}>{enviando ? "Creando…" : inicial ? "Guardar cambios" : "Crear invitación"}</button>
        <span className="text-xs text-tenue">Tarda unos segundos. No usa la tarjeta de video.</span>
      </div>
    </form>
  );
}
