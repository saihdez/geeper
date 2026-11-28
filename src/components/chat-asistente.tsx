"use client";
/**
 * El asistente de Geeper como chat: un ícono abajo a la izquierda en todas las páginas. Recomienda y
 * ejecuta las mismas acciones que los botones (las que cada página registra en el buscador Ctrl+K, las
 * secciones y las recomendaciones del proyecto abierto). Entiende sin IA; la IA local sólo cuando la
 * persona pulsa «Preguntarle a la IA» (src/lib/chat-asistente.ts).
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buscarAcciones, intencion, type AccionChat } from "@/lib/chat-asistente";
import { DESTINOS, destinoActual } from "@/lib/destinos";
import type { Recomendacion } from "@/lib/recomendaciones";
import { pedir, postJson } from "./comun";
import { useAccionesRegistradas, type AccionPaleta } from "./paleta";

interface Mensaje {
  id: number;
  /** De qué visita a una página es (la conversación sigue al navegar; lo de antes queda arriba, sin botones). */
  visita?: number;
  de: "persona" | "asistente";
  texto: string;
  /** Ids de acciones (del buscador o «rec:<id>» de las recomendaciones) que se ofrecen como botones. */
  acciones?: string[];
  /** Frases de ejemplo para tocar en vez de escribir. */
  sugerencias?: string[];
  enlaces?: { texto: string; href: string }[];
  /** Lo que la persona escribió, para ofrecer «Preguntarle a la IA». */
  ofrecerIa?: string;
  /** Versión a la que vuelve «Deshacer». */
  deshacer?: { proyecto: string; version: number };
  error?: boolean;
}

interface InformeAsistente {
  proyecto: { id: string; nombre: string; version: number };
  recomendaciones: Recomendacion[];
}

const SUGERENCIAS_INICIO = ["¿Qué le falta a mi video?", "Quiero hacer un video nuevo", "Sacar clips de un video largo", "¿Qué puedes hacer?"];
const SUGERENCIAS_PROYECTO = ["¿Qué le falta a este video?", "Quita los silencios", "Ponlo horizontal para YouTube", "Crea el video"];

let siguienteId = 1;
let siguienteVisita = 1;
const mensaje = (m: Omit<Mensaje, "id">): Mensaje => ({ ...m, id: siguienteId++ });

/** Lleva a una parte de la página y la marca un momento (como «Ir ahí» del panel). */
function irA(destino: string) {
  const el = document.querySelector<HTMLElement>(destino);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("ring-2", "ring-sky-400", "rounded-lg");
  setTimeout(() => el.classList.remove("ring-2", "ring-sky-400", "rounded-lg"), 2500);
  return true;
}

export function ChatAsistente() {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  /** Sube con «Empezar de nuevo»: la conversación se rehace desde cero (también al cambiar de página). */
  const [reinicio, setReinicio] = useState(0);
  /** Toda la conversación, también la de páginas anteriores (vive aquí para no perderse al navegar). */
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const idPanel = useId();

  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierto]);

  return (
    <>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} aria-controls={idPanel}
        aria-label={abierto ? "Cerrar el asistente" : "Abrir el asistente"} title="Asistente: pídeme lo que quieras hacer"
        className="fixed bottom-4 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white shadow-xl transition hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
        {abierto
          ? <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z" /><path d="M9 11h.01M12 11h.01M15 11h.01" strokeWidth={2.6} />
            </svg>}
      </button>
      {/* Cerrado queda montado (oculto): la conversación sigue al volver a abrirlo en la misma página. */}
      <section id={idPanel} role="dialog" aria-label="Asistente de Geeper" hidden={!abierto}
        className="fixed bottom-20 left-4 z-50 flex h-[min(36rem,calc(100dvh-7rem))] w-[min(25rem,calc(100vw-2rem))] flex-col rounded-xl border border-borde bg-[#0f131a]/95 shadow-2xl backdrop-blur [[hidden]]:hidden">
        <Conversacion key={`${ruta}:${reinicio}`} ruta={ruta} abierto={abierto} mensajes={mensajes} setMensajes={setMensajes}
          reiniciar={() => { setMensajes([]); setReinicio((n) => n + 1); }} />
      </section>
    </>
  );
}

/**
 * La conversación en la página actual. Al navegar se monta otra (con su saludo y las acciones de esa
 * página); lo dicho antes sigue arriba, sólo como texto: sus botones eran de la otra página.
 */
function Conversacion({ ruta, abierto, reiniciar, mensajes: todos, setMensajes }: {
  ruta: string;
  abierto: boolean;
  reiniciar: () => void;
  mensajes: Mensaje[];
  setMensajes: React.Dispatch<React.SetStateAction<Mensaje[]>>;
}) {
  const router = useRouter();
  const registradas = useAccionesRegistradas();
  const [visita] = useState(() => siguienteVisita++);
  const mensajes = useMemo(() => todos.filter((m) => m.visita === visita), [todos, visita]);
  const antes = useMemo(() => todos.filter((m) => m.visita !== visita).slice(-10), [todos, visita]);
  /** Mientras se hace algo, los botones esperan (para no aplicarlo dos veces). */
  const [haciendo, setHaciendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [informe, setInforme] = useState<InformeAsistente | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const final = useRef<HTMLDivElement>(null);
  const idTexto = useId();

  const proyectoId = /^\/proyectos\/([^/]+)/.exec(ruta)?.[1] ?? null;
  const pagina = proyectoId ? `Editor del proyecto${informe?.proyecto.id === proyectoId ? ` «${informe.proyecto.nombre}»` : ""}` : destinoActual(ruta)?.titulo ?? "Geeper";
  const recs = useMemo(() => (informe && informe.proyecto.id === proyectoId ? informe.recomendaciones : []), [informe, proyectoId]);

  // Todo lo que se puede hacer desde aquí: lo de la página, las secciones y las recomendaciones.
  const todas = useMemo<AccionPaleta[]>(() => [
    ...registradas,
    ...DESTINOS.filter((d) => d.ruta !== ruta).map((d) => ({ id: `ir:${d.ruta}`, titulo: `Ir a ${d.titulo}`, grupo: "Ir a", palabras: `${d.titulo} ${d.palabras}`, hacer: () => router.push(d.ruta) })),
  ], [registradas, ruta, router]);
  const porId = useMemo(() => new Map(todas.map((a) => [a.id, a])), [todas]);
  const recPorId = useMemo(() => new Map(recs.map((r) => [`rec:${r.id}`, r])), [recs]);
  const paraBuscar = useMemo<AccionChat[]>(() => [
    ...recs.map((r) => ({ id: `rec:${r.id}`, titulo: r.titulo, grupo: "Recomendado", palabras: r.porque })),
    ...todas.map(({ id, titulo, grupo, palabras, detalle }) => ({ id, titulo, grupo, palabras, detalle })),
  ], [recs, todas]);

  const decir = (m: Omit<Mensaje, "id">) => setMensajes((xs) => [...xs, mensaje({ ...m, visita })]);
  /** Corre `fn` con los botones desactivados (un clic, una vez). */
  const conEspera = async (fn: () => Promise<unknown>) => {
    if (haciendo) return;
    setHaciendo(true);
    try {
      await fn();
    } finally {
      setHaciendo(false);
    }
  };

  async function cargarInforme(): Promise<InformeAsistente | null> {
    if (!proyectoId) return null;
    try {
      const r = await pedir<InformeAsistente>(`/api/proyectos/${proyectoId}/asistente`);
      setInforme(r);
      return r;
    } catch {
      return null;
    }
  }

  /** Lo más importante del proyecto abierto, o de los videos recientes si no hay uno abierto. */
  async function recomendar(intro: string) {
    if (proyectoId) {
      const r = await cargarInforme();
      const lista = r?.recomendaciones ?? [];
      if (!lista.length) return decir({ de: "asistente", texto: "No veo nada que mejorar en este video ahora mismo. Si cambias algo, lo vuelvo a revisar." });
      return decir({ de: "asistente", texto: `${intro} De lo más urgente a lo opcional:`, acciones: lista.slice(0, 4).map((x) => `rec:${x.id}`) });
    }
    try {
      const r = await pedir<{ siguientes: { proyecto: { id: string; nombre: string }; recomendacion: { titulo: string } }[] }>("/api/asistente");
      if (!r.siguientes.length) return decir({ de: "asistente", texto: "Tus videos recientes no tienen nada pendiente. ¿Quieres hacer uno nuevo?", sugerencias: ["Quiero hacer un video nuevo"] });
      decir({
        de: "asistente", texto: "Esto es lo que más mejoraría tus videos recientes. Abre uno y te digo cómo hacerlo:",
        enlaces: r.siguientes.map((s) => ({ texto: `${s.proyecto.nombre}: ${s.recomendacion.titulo}`, href: `/proyectos/${s.proyecto.id}#asistente-titulo` })),
      });
    } catch {
      decir({ de: "asistente", texto: "No pude revisar tus videos ahora. Prueba en un momento.", error: true });
    }
  }

  // Las recomendaciones del proyecto abierto (para el saludo y para buscar entre ellas).
  useEffect(() => {
    if (!proyectoId) return;
    let vivo = true;
    pedir<InformeAsistente>(`/api/proyectos/${proyectoId}/asistente`).then((r) => { if (vivo) setInforme(r); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [proyectoId]);

  useEffect(() => {
    if (abierto) entrada.current?.focus();
  }, [abierto]);

  useEffect(() => {
    final.current?.scrollIntoView({ block: "end" });
  }, [mensajes, pensando]);

  /** El saludo depende de la página: no se guarda, se calcula con lo que ya se sabe. */
  const saludo: Mensaje = proyectoId
    ? {
        id: 0, de: "asistente", sugerencias: SUGERENCIAS_PROYECTO, acciones: recs.slice(0, 3).map((x) => `rec:${x.id}`),
        texto: !informe ? "Hola. Estoy revisando este video…"
          : recs.length ? `Hola. Estoy viendo «${informe.proyecto.nombre}». Esto es lo que más lo mejoraría; dime si quieres otra cosa.`
          : "Hola. Dime qué quieres hacer con este video y lo hago contigo.",
      }
    : { id: 0, de: "asistente", sugerencias: SUGERENCIAS_INICIO, texto: `Hola. Estás en «${pagina}». Dime con tus palabras qué quieres hacer y te muestro el botón, o lo hago por ti.` };

  async function enviar(t: string) {
    const limpio = t.trim();
    if (!limpio || pensando) return;
    setTexto("");
    decir({ de: "persona", texto: limpio });
    const i = intencion(limpio);
    if (i === "saludo") return decir({ de: "asistente", texto: "¡Hola! Dime qué quieres hacer con tus palabras, por ejemplo «quita los silencios» o «quiero un avatar».", sugerencias: proyectoId ? SUGERENCIAS_PROYECTO : SUGERENCIAS_INICIO });
    if (i === "gracias") return decir({ de: "asistente", texto: "¡Con gusto! Aquí sigo si necesitas algo más." });
    if (i === "ayuda") {
      return decir({
        de: "asistente",
        texto: "Te digo qué mejorar en tus videos y hago las cosas por ti: quitar silencios, cambiar la forma del video, crear el video, ir a otra sección… Escríbelo como se lo dirías a alguien. Antes de algo grande te pregunto, y lo que cambie se puede deshacer.",
        sugerencias: proyectoId ? SUGERENCIAS_PROYECTO : SUGERENCIAS_INICIO,
      });
    }
    if (i === "recomendar") return recomendar("Esto es lo que haría.");
    const encontradas = buscarAcciones(limpio, paraBuscar, 4);
    if (encontradas.length) {
      return decir({ de: "asistente", texto: encontradas.length === 1 ? "Esto es lo que encontré:" : "Encontré esto. Elige una:", acciones: encontradas.map((a) => a.id), ofrecerIa: limpio });
    }
    decir({ de: "asistente", texto: "No encontré un botón para eso. ¿Le pregunto a la IA de tu PC? Tarda unos segundos y usa la tarjeta de video.", ofrecerIa: limpio });
  }

  async function preguntarIa(t: string) {
    setPensando(true);
    try {
      const historial = mensajes.slice(-6).map((m) => ({ de: m.de, texto: m.texto.slice(0, 600) }));
      const acciones = paraBuscar.slice(0, 80).map(({ id, titulo, detalle }) => ({ id, titulo: titulo.slice(0, 160), detalle: detalle?.slice(0, 240) }));
      const r = await postJson<{ respuesta: string; acciones: string[] }>("/api/asistente/chat", {
        mensaje: t.slice(0, 500), pagina, acciones, recomendaciones: recs.slice(0, 8).map((x) => x.titulo), historial,
      });
      decir({ de: "asistente", texto: r.respuesta, acciones: r.acciones });
    } catch (e) {
      decir({ de: "asistente", texto: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setPensando(false);
    }
  }

  async function hacerRecomendacion(r: Recomendacion, ediciones?: object[]) {
    if (!proyectoId) return;
    const eds = ediciones ?? r.ediciones;
    const antes = informe?.proyecto.version ?? 0;
    try {
      if (eds?.length) {
        await postJson(`/api/proyectos/${proyectoId}/editar`, { ediciones: eds });
        decir({ de: "asistente", texto: `Listo: «${r.titulo}». Ya se ve en la vista previa.`, deshacer: { proyecto: proyectoId, version: antes } });
      } else if (r.accion === "renderizar") {
        await postJson(`/api/proyectos/${proyectoId}/render`, {});
        decir({ de: "asistente", texto: "Listo: estoy armando el video. Tarda 1 o 2 minutos y no usa la tarjeta de video; verás el avance abajo a la derecha." });
      } else if (r.accion === "alinearMusica") {
        const x = await postJson<{ cambio: boolean; motivo?: string }>(`/api/proyectos/${proyectoId}/musica`, {});
        decir(x.cambio ? { de: "asistente", texto: "Listo: los cortes caen al ritmo de la música.", deshacer: { proyecto: proyectoId, version: antes } } : { de: "asistente", texto: x.motivo ?? "No se pudo alinear la música.", error: true });
      } else if (r.escribir) {
        irA("#asistente-titulo");
        decir({ de: "asistente", texto: `Eso lo escribes tú: te llevé al Asistente del proyecto, donde está el campo «${r.escribir.etiqueta}»${r.escribir.sugerir ? " y el botón «✨ Sugiéreme 3»" : ""}.` });
      } else if (r.ir) {
        const fue = r.ir.startsWith("#") ? irA(r.ir) : (router.push(r.ir), true);
        decir({ de: "asistente", texto: fue ? "Te llevé ahí: lo marqué en la página." : "No encontré esa parte en la página." });
      }
      void cargarInforme();
    } catch (e) {
      decir({ de: "asistente", texto: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  async function ejecutar(id: string) {
    const r = recPorId.get(id);
    if (r) return hacerRecomendacion(r);
    const a = porId.get(id);
    if (!a) return decir({ de: "asistente", texto: "Esa acción ya no está disponible en esta página.", error: true });
    if (a.deshabilitada) return decir({ de: "asistente", texto: "Ahora no se puede: hay algo en curso. Espera a que termine y vuelve a pedírmelo.", error: true });
    if (a.confirmar && !confirm(a.confirmar)) return decir({ de: "asistente", texto: "Bien, no lo hice." });
    try {
      await a.hacer();
      // Los botones de la página muestran su propio aviso (y si no había nada que cambiar, lo dicen ahí).
      decir({ de: "asistente", texto: id.startsWith("ir:") ? `Listo, estás en ${a.titulo.replace(/^Ir a /, "")}.` : `Hecho: «${a.titulo}». Arriba en la página ves cómo quedó.` });
      if (proyectoId) void cargarInforme();
    } catch (e) {
      decir({ de: "asistente", texto: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  async function deshacer(d: NonNullable<Mensaje["deshacer"]>) {
    try {
      await postJson(`/api/proyectos/${d.proyecto}/version`, { numero: d.version });
      decir({ de: "asistente", texto: "Listo: lo dejé como estaba (se guardó como versión nueva, no se pierde nada)." });
      void cargarInforme();
    } catch (e) {
      decir({ de: "asistente", texto: e instanceof Error ? e.message : String(e), error: true });
    }
  }

  /** Un botón por acción ofrecida; una recomendación muestra también sus opciones. */
  function botones(ids: string[]) {
    return (
      <div className="mt-2 space-y-1.5">
        {ids.map((id) => {
          const r = recPorId.get(id);
          const a = porId.get(id);
          if (!r && !a) return null;
          if (r) {
            return (
              <div key={id} className="rounded border border-borde bg-black/20 p-2">
                <p className="text-sm font-medium">{r.titulo}{r.efecto && <span className="ml-1 text-xs text-emerald-300">{r.efecto}</span>}</p>
                <p className="mt-0.5 text-xs text-tenue">{r.porque}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.opciones
                    ? r.opciones.map((o) => <button key={o.etiqueta} type="button" className="boton py-0.5 text-xs" disabled={haciendo} onClick={() => void conEspera(() => hacerRecomendacion(r, o.ediciones))}>{o.etiqueta}</button>)
                    : <button type="button" className="boton boton-primario py-0.5 text-xs" disabled={haciendo} onClick={() => void conEspera(() => hacerRecomendacion(r))}>
                        {r.ediciones?.length ? "Hacerlo" : r.accion === "renderizar" ? "Armar el video" : r.accion === "alinearMusica" ? "Alinear al ritmo" : r.escribir ? "Escribirlo" : "Llévame ahí"}
                      </button>}
                  {r.gpu && <span className="self-center text-xs text-amber-300">usa la tarjeta de video</span>}
                </div>
              </div>
            );
          }
          return (
            <button key={id} type="button" disabled={a!.deshabilitada || haciendo} onClick={() => void conEspera(() => ejecutar(id))}
              className="block w-full rounded border border-borde bg-black/20 px-2 py-1.5 text-left text-sm hover:bg-sky-900/40 disabled:opacity-50">
              {a!.titulo}
              {a!.detalle && <span className="block text-xs text-tenue">{a!.detalle}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b border-borde px-4 py-3">
        <h2 className="font-medium">Asistente</h2>
        <span className="truncate text-xs text-tenue">{pagina}</span>
        <button type="button" className="ml-auto text-xs text-tenue hover:text-white" onClick={reiniciar}>Empezar de nuevo</button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {antes.map((m) => (
              <div key={m.id} className={`opacity-60 ${m.de === "persona" ? "flex justify-end" : ""}`}>
                <p className={`max-w-[92%] whitespace-pre-wrap wrap-break-word rounded-lg px-3 py-2 text-sm ${m.de === "persona" ? "bg-sky-900 text-white" : "bg-white/5"}`}>{m.texto}</p>
              </div>
            ))}
            {antes.length > 0 && <p className="border-t border-borde pt-2 text-center text-xs text-tenue">Ahora estás en «{pagina}»</p>}
            {[saludo, ...mensajes].map((m) => (
          <div key={m.id} className={m.de === "persona" ? "flex justify-end" : ""}>
            <div className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${m.de === "persona" ? "bg-sky-800 text-white" : m.error ? "border border-red-800 bg-red-950/50" : "bg-white/5"}`}>
              <p className="whitespace-pre-wrap wrap-break-word">{m.texto}</p>
              {m.acciones && m.acciones.length > 0 && botones(m.acciones)}
              {m.enlaces && (
                <ul className="mt-2 space-y-1">
                  {m.enlaces.map((e) => (
                    <li key={e.href}><button type="button" className="text-left text-sky-300 hover:underline" onClick={() => router.push(e.href)}>{e.texto}</button></li>
                  ))}
                </ul>
              )}
              {m.deshacer && <button type="button" className="boton mt-2 py-0.5 text-xs" disabled={haciendo} onClick={() => void conEspera(() => deshacer(m.deshacer!))}>Deshacer</button>}
              {m.ofrecerIa && (
                <button type="button" disabled={pensando} onClick={() => void preguntarIa(m.ofrecerIa!)}
                  className={m.acciones?.length ? "mt-2 block text-xs text-tenue underline hover:text-white" : "boton mt-2 py-0.5 text-xs"}>
                  {m.acciones?.length ? "¿No era esto? Preguntarle a la IA" : "✨ Preguntarle a la IA"}
                </button>
              )}
              {m.sugerencias && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.sugerencias.map((s) => <button key={s} type="button" className="rounded-full border border-borde px-2 py-0.5 text-xs hover:bg-white/10" onClick={() => void enviar(s)}>{s}</button>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {pensando && <p className="text-sm text-tenue" role="status">La IA de tu PC está pensando… (puede tardar hasta 1 minuto la primera vez)</p>}
        <div ref={final} />
      </div>
      <form className="flex gap-2 border-t border-borde p-3" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        <label htmlFor={idTexto} className="sr-only">Escribe lo que quieres hacer</label>
        <input id={idTexto} ref={entrada} className="campo min-w-0 flex-1" value={texto} maxLength={500} autoComplete="off"
          placeholder="Escribe lo que quieres hacer…" onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="boton boton-primario" disabled={!texto.trim() || pensando}>Enviar</button>
      </form>
    </>
  );
}
