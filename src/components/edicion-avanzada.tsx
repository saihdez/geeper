"use client";
/**
 * Edición avanzada (esquema v2): edición por texto, efectos del plano de cada escena, destino del video,
 * música al ritmo, textos superpuestos y pistas libres. Todo son ediciones de geeper.json (sin GPU).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPT_IMAGEN } from "@/lib/formatos-vector";
import type { Fusion } from "@/lib/efectos-esquema";
import { segundos } from "./comun";
import { ASPECTOS, claveAspecto, claveTransicion, GaleriaAspectos, GaleriaTransiciones, nombreDe, SelectorMezcla, SelectorRitmo, TRANSICIONES, type TransicionV } from "./galeria-efectos";

export type Motivo = "palabras" | "silencio" | "muletilla";

export interface PalabraV {
  texto: string;
  /** En el tiempo del asset de voz (segundos). */
  inicio: number;
  fin: number;
  confianza: number | null;
  dudosa: boolean;
  recorte: Motivo | null;
}

export interface EfectosV {
  transicion: { tipo: string; duracion: number } | null;
  movimiento: { desde: { escala: number; x: number; y: number }; hasta: { escala: number; x: number; y: number }; curva?: string } | null;
  velocidad: number;
  color: { brillo: number; contraste: number; saturacion: number } | null;
  /** Efectos del clip (efectos.ts), tal como están en geeper.json. */
  efectos: object[] | null;
}

export interface ExtrasV {
  /** Si el proyecto es un clip de material ajeno: de dónde salió y la descripción sugerida del post. */
  clip?: {
    url: string; titulo: string; canal: string | null; inicio: number; fin: number; encuadre: string; reencuadre?: string;
    credito: string; descripcion: string; campania?: { nombre?: string } | null;
  } | null;
  destino: { comercial: boolean; plataformas: string[]; master: boolean; marca: boolean };
  textos: { id: string; texto: string; inicio: number; duracion: number; estilo: string; posicion: string }[];
  estilo: EstiloV;
  libres: {
    id: string; tipo: "video" | "audio";
    clips: {
      id: string; asset: string; ruta: string; inicio: number; duracion: number; desde: number; tipoAsset: string;
      fusion: string | null; efectos: object[] | null; transicion: object | null; opacidad: number;
    }[];
  }[];
  musica: { inicio: number; pulsos: number } | null;
  confianza: { medidas: number; dudosas: number; proporcion: number };
}

type Editar = (ed: object) => Promise<void>;

const MOTIVOS: Record<Motivo, string> = { palabras: "recortada", silencio: "silencio acortado", muletilla: "muletilla" };

/** Umbrales de confianza del tiempo de cada palabra (confianza.ts: < 0,6 = dudosa). */
const DUDOSA = 0.6;
const MEDIA = 0.8;
const nivel = (w: PalabraV): "baja" | "media" | null =>
  w.confianza === null ? null : w.confianza < DUDOSA ? "baja" : w.confianza < MEDIA ? "media" : null;

/** Reproduce sólo un tramo del audio (con un margen para entender la palabra en su contexto). */
function useTramo(audio: string) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [sonando, setSonando] = useState(false);
  useEffect(() => () => ref.current?.pause(), []);
  const tocar = useCallback((inicio: number, hasta: number) => {
    if (!ref.current) ref.current = new Audio(audio);
    const a = ref.current;
    if (!a.src.endsWith(audio)) a.src = audio;
    a.pause();
    const fin = hasta + 0.3;
    a.currentTime = Math.max(0, inicio - 0.3);
    const vigilar = () => {
      if (a.paused || a.currentTime >= fin) {
        a.pause();
        setSonando(false);
        return;
      }
      requestAnimationFrame(vigilar);
    };
    void a.play().then(() => {
      setSonando(true);
      requestAnimationFrame(vigilar);
    }).catch(() => setSonando(false));
  }, [audio]);
  const parar = useCallback(() => {
    ref.current?.pause();
    setSonando(false);
  }, []);
  return { tocar, parar, sonando };
}

/**
 * Palabras de una escena: se seleccionan con clic (Mayús+clic extiende), se escuchan y se recortan o
 * restauran. Las de tiempo dudoso se revisan una por una («Revisar dudosas»): se escucha el tramo y se
 * confirma («Suena bien»), se recorta o se salta. Idea de la pantalla «OCR Verify» de PdfCraft.
 */
export function EdicionPorTexto({ escena, audio, palabras, duracion, duracionOriginal, editar, ocupado, vozReal = false, correcciones = [] }: {
  escena: string; audio: string; palabras: PalabraV[]; duracion: number; duracionOriginal: number; editar: Editar; ocupado: boolean;
  /**
   * Voz real (clips): el subtítulo es lo que entendió whisper, así que una palabra dudosa puede estar MAL
   * ESCRITA (no sólo mal ubicada) y se corrige escribiendo lo que se oye. En una voz TTS el texto sale del
   * guion y lo dudoso es el tiempo.
   */
  vozReal?: boolean;
  correcciones?: { desde: number; hasta: number; texto: string }[];
}) {
  const [sel, setSel] = useState<[number, number] | null>(null);
  // Revisión en clips: «No, dice otra cosa…» abre este campo con la palabra para corregirla.
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  /** Texto corregido de una palabra suelta (las correcciones de varias palabras se ven en los subtítulos). */
  const corregida = (i: number) => correcciones.find((c) => c.desde === i && c.hasta === i + 1)?.texto ?? null;
  const [revisando, setRevisando] = useState(false);
  // Al terminar: si hay otra escena con dudosas más abajo, para ofrecer seguir con ella.
  const [terminada, setTerminada] = useState<{ hayProxima: boolean } | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const { tocar, parar, sonando } = useTramo(audio);
  const elegir = (i: number, extender: boolean) => {
    if (extender && sel) setSel([Math.min(sel[0], i), Math.max(sel[1], i + 1)]);
    else setSel(sel && sel[0] === i && sel[1] === i + 1 ? null : [i, i + 1]);
  };
  const recortadas = sel ? palabras.slice(sel[0], sel[1]).every((w) => w.recorte) : false;
  // Pendientes de revisar: dudosas que todavía se oyen.
  const pendientes = palabras.map((w, i) => (w.dudosa && !w.recorte ? i : -1)).filter((i) => i >= 0);
  const medidas = palabras.some((w) => w.confianza !== null);
  const escuchar = (desde: number, hasta: number) => tocar(palabras[desde]!.inicio, palabras[hasta - 1]!.fin);
  const textoDe = (r: [number, number]) => palabras.slice(r[0], r[1]).map((w) => w.texto).join(" ");

  /** El botón «Revisarlas» de la próxima escena con dudosas (está más abajo en la página). */
  const proximaEscena = () => [...document.querySelectorAll<HTMLButtonElement>("[data-revisar-dudosas]")]
    .find((b) => caja.current && !caja.current.contains(b) && caja.current.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  /** Va a la siguiente dudosa después de `despues` (o la primera) y la hace sonar. */
  const siguiente = (despues: number, lista = pendientes) => {
    const i = lista.find((x) => x > despues) ?? lista.find((x) => x !== despues);
    if (i === undefined) {
      setSel(null);
      setRevisando(false);
      setTerminada({ hayProxima: !!proximaEscena() });
      parar();
      return;
    }
    setSel([i, i + 1]);
    setRevisando(true);
    setTerminada(null);
    setCorrigiendo(null);
    escuchar(i, i + 1);
  };
  const actual = revisando && sel ? sel[0] : null;
  const resolver = async (ed: object) => {
    if (actual === null) return;
    await editar(ed);
    siguiente(actual, pendientes.filter((x) => x !== actual));
  };

  return (
    <div className="space-y-2" ref={caja}>
      <p className="text-xs text-tenue">
        Edición por texto: haz clic en una palabra (Mayús+clic para un tramo) y escúchala o recórtala: recortar quita lo que se oye y su tiempo.
        {duracionOriginal - duracion > 0.05 && <> Recortado: {(duracionOriginal - duracion).toFixed(2)} s.</>}
      </p>
      {terminada && !revisando && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-800 bg-emerald-950/40 px-2 py-1.5 text-xs" role="status">
          <span>
            {pendientes.length === 0
              ? "Listo: revisaste las palabras dudosas de esta escena."
              : `Terminaste esta escena; ${pendientes.length === 1 ? "queda 1 palabra" : `quedan ${pendientes.length} palabras`} sin revisar.`}
          </span>
          {terminada.hayProxima && (
            <button type="button" className="boton ml-auto py-0.5" onClick={() => {
              const b = proximaEscena();
              setTerminada(null);
              b?.scrollIntoView({ behavior: "smooth", block: "center" });
              b?.click();
            }}>Seguir con la próxima escena</button>
          )}
          <button type="button" className="boton py-0.5" onClick={() => setTerminada(null)}>Cerrar</button>
        </div>
      )}
      {pendientes.length > 0 && !revisando && !terminada && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-xs">
          <span className="text-amber-200">
            {vozReal
              ? pendientes.length === 1
                ? "1 palabra que Geeper no está seguro de haber entendido bien: escúchala para que el subtítulo diga lo correcto."
                : `${pendientes.length} palabras que Geeper no está seguro de haber entendido bien: escúchalas para que el subtítulo diga lo correcto.`
              : `${pendientes.length === 1 ? "1 palabra" : `${pendientes.length} palabras`} con el tiempo dudoso: si recortas ahí, el corte podría caer mal.`}
          </span>
          <button type="button" data-revisar-dudosas className="boton ml-auto py-0.5" disabled={ocupado} onClick={() => siguiente(-1)}>Revisarlas una por una</button>
        </div>
      )}
      <p className="flex flex-wrap gap-1 text-sm leading-relaxed" aria-label="Palabras de la escena">
        {palabras.map((w, i) => {
          const elegida = sel && i >= sel[0] && i < sel[1];
          const n = nivel(w);
          return (
            <button key={i} type="button" disabled={ocupado}
              onClick={(ev) => { setRevisando(false); elegir(i, ev.shiftKey); }}
              aria-pressed={Boolean(elegida)}
              aria-description={n === "baja" ? (vozReal ? "quizás mal entendida" : "tiempo dudoso") : n === "media" ? (vozReal ? "poco segura" : "tiempo poco seguro") : undefined}
              title={[
                w.recorte ? MOTIVOS[w.recorte] : null,
                corregida(i) !== null ? `corregida (Geeper había entendido «${w.texto}»)` : null,
                w.confianza !== null ? `${vozReal ? "seguridad de lo entendido" : "seguridad del tiempo"}: ${Math.round(w.confianza * 100)} %` : null,
              ].filter(Boolean).join(" · ") || undefined}
              className={[
                "rounded px-1",
                elegida ? "bg-sky-700 text-white" : n === "baja" ? "bg-amber-500/20 hover:bg-amber-500/30" : "hover:bg-white/10",
                w.recorte ? "text-tenue line-through" : "",
                n === "baja" ? "underline decoration-amber-400 decoration-wavy underline-offset-4" : "",
                n === "media" ? "underline decoration-amber-200/60 decoration-dotted underline-offset-4" : "",
              ].join(" ")}>
              {corregida(i) ?? w.texto}
            </button>
          );
        })}
      </p>
      {medidas && palabras.some((w) => nivel(w)) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tenue" aria-label="Qué significan las marcas">
          <span><span className="rounded bg-amber-500/20 px-1 underline decoration-amber-400 decoration-wavy underline-offset-4">palabra</span> {vozReal ? "quizás mal entendida: escúchala y corrígela si hace falta" : `tiempo dudoso (menos de ${DUDOSA * 100} %): escúchala antes de recortar`}</span>
          <span><span className="px-1 underline decoration-amber-200/60 decoration-dotted underline-offset-4">palabra</span> poco seguro ({DUDOSA * 100}–{MEDIA * 100} %)</span>
          <span>sin marca: seguro</span>
        </p>
      )}
      {actual !== null && sel && (
        <div className="space-y-2 rounded border border-sky-800 bg-sky-950/40 p-2 text-sm" role="group" aria-label="Revisión de palabras dudosas">
          <p>
            Revisando {pendientes.indexOf(actual) + 1 > 0 ? `${pendientes.indexOf(actual) + 1} de ${pendientes.length}` : ""}:
            {" "}{vozReal ? "¿dice" : "¿se oye"} <span className="font-semibold">«{textoDe(sel)}»</span>{vozReal ? "?" : " en el audio?"}
          </p>
          {vozReal && corrigiendo !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`corregir-${escena}`}>Lo que se oye</label>
              <input id={`corregir-${escena}`} className="campo grow" autoFocus value={corrigiendo} maxLength={80}
                onChange={(e) => setCorrigiendo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && corrigiendo.trim()) { e.preventDefault(); void resolver({ tipo: "corregirSubtitulo", escena, desde: sel[0], hasta: sel[1], texto: corrigiendo, revisada: true }); }
                  if (e.key === "Escape") setCorrigiendo(null);
                }} />
              <button type="button" className="boton py-1" onClick={() => (sonando ? parar() : escuchar(sel[0], sel[1]))}>{sonando ? "■ Parar" : "▶ Escuchar otra vez"}</button>
              <button type="button" className="boton boton-primario py-1" disabled={ocupado || !corrigiendo.trim()}
                onClick={() => void resolver({ tipo: "corregirSubtitulo", escena, desde: sel[0], hasta: sel[1], texto: corrigiendo, revisada: true })}>Guardar y seguir</button>
              <button type="button" className="boton py-1" onClick={() => setCorrigiendo(null)}>Cancelar</button>
            </div>
          )}
          {corrigiendo === null && <div className="flex flex-wrap gap-2">
            <button type="button" className="boton py-1" onClick={() => (sonando ? parar() : escuchar(sel[0], sel[1]))}>{sonando ? "■ Parar" : "▶ Escuchar otra vez"}</button>
            <button type="button" className="boton boton-primario py-1" disabled={ocupado}
              onClick={() => void resolver({ tipo: "confirmarPalabras", escena, desde: sel[0], hasta: sel[1] })}>{vozReal ? "Sí, dice eso" : "Sí, suena bien"}</button>
            {vozReal && corrigiendo === null && (
              <button type="button" className="boton py-1" disabled={ocupado} onClick={() => setCorrigiendo(corregida(sel[0]) ?? textoDe(sel))}>No, dice otra cosa…</button>
            )}
            <button type="button" className="boton boton-peligro py-1" disabled={ocupado}
              onClick={() => void resolver({ tipo: "recortarPalabras", escena, desde: sel[0], hasta: sel[1] })}>Recortarla</button>
            <button type="button" className="boton py-1" onClick={() => siguiente(actual)}>Saltar</button>
            <button type="button" className="boton py-1" onClick={() => { setRevisando(false); setSel(null); setCorrigiendo(null); setTerminada({ hayProxima: !!proximaEscena() }); parar(); }}>Terminar</button>
          </div>}
          {vozReal ? (
            <p className="text-xs text-tenue">
              Es la voz real del video: si Geeper la escribió mal, elige «No, dice otra cosa…» y escribe lo que se oye; sólo cambia
              el subtítulo. «Recortarla» quita ese pedazo del clip.
            </p>
          ) : (
            <p className="text-xs text-tenue">
              «Sí, suena bien» la marca como revisada y deja de contar como dudosa en el control de calidad. Si se oye otra cosa,
              no la recortes: usa «Regenerar voz de la escena».
            </p>
          )}
        </div>
      )}
      {sel && actual === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton py-1" onClick={() => (sonando ? parar() : escuchar(sel[0], sel[1]))}>{sonando ? "■ Parar" : "▶ Escuchar"}</button>
          {recortadas
            ? <button type="button" className="boton py-1" disabled={ocupado} onClick={() => void editar({ tipo: "restaurarPalabras", escena, desde: sel[0], hasta: sel[1] }).then(() => setSel(null))}>Restaurar</button>
            : <button type="button" className="boton boton-peligro py-1" disabled={ocupado} onClick={() => void editar({ tipo: "recortarPalabras", escena, desde: sel[0], hasta: sel[1] }).then(() => setSel(null))}>Recortar «{textoDe(sel)}»</button>}
          {palabras.slice(sel[0], sel[1]).some((w) => w.dudosa) && (
            <button type="button" className="boton py-1" disabled={ocupado} onClick={() => void editar({ tipo: "confirmarPalabras", escena, desde: sel[0], hasta: sel[1] }).then(() => setSel(null))}>Suena bien</button>
          )}
          <button type="button" className="boton py-1" onClick={() => { setSel(null); parar(); }}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

const MOVIMIENTOS: Record<string, EfectosV["movimiento"]> = {
  ninguno: null,
  acercar: { desde: { escala: 1, x: 0, y: 0 }, hasta: { escala: 1.15, x: 0, y: 0 } },
  alejar: { desde: { escala: 1.15, x: 0, y: 0 }, hasta: { escala: 1, x: 0, y: 0 } },
  "izquierda-derecha": { desde: { escala: 1.15, x: -0.12, y: 0 }, hasta: { escala: 1.15, x: 0.12, y: 0 } },
  "derecha-izquierda": { desde: { escala: 1.15, x: 0.12, y: 0 }, hasta: { escala: 1.15, x: -0.12, y: 0 } },
};
const COLORES: Record<string, EfectosV["color"]> = {
  natural: null,
  vivo: { brillo: 1, contraste: 1.08, saturacion: 1.25 },
  claro: { brillo: 1.12, contraste: 1, saturacion: 1 },
  apagado: { brillo: 0.95, contraste: 0.95, saturacion: 0.75 },
  "blanco-negro": { brillo: 1, contraste: 1.1, saturacion: 0 },
};
const clave = <T,>(tabla: Record<string, T>, v: T) => Object.entries(tabla).find(([, x]) => JSON.stringify(x) === JSON.stringify(v))?.[0] ?? "personalizado";

const NOMBRES_MOV: Record<string, string> = {
  acercar: "acercar", alejar: "alejar", "izquierda-derecha": "paneo a la derecha", "derecha-izquierda": "paneo a la izquierda", personalizado: "personalizada",
};

/** Estilo del video tal como lo muestra la UI (vista.ts). */
export interface EstiloV {
  efectos: object[] | null;
  transicion: TransicionV | null;
  curva: string | null;
}

type EfectoUI = { tipo: string } & Record<string, unknown>;

/** Entrada, aspecto, movimiento de cámara, ritmo, velocidad y color del plano de una escena. */
export function EfectosEscena({ escena, indice, efectos, estilo, formato, imgA, imgB, editar, ocupado }: {
  escena: string; indice: number; efectos: EfectosV; estilo: EstiloV | null; formato: string;
  /** Miniaturas de la escena anterior y de ésta (para las vistas previas de las galerías). */
  imgA?: string; imgB?: string;
  editar: Editar; ocupado: boolean;
}) {
  const { curva, ...movSinCurva } = efectos.movimiento ?? {};
  const mov = clave(MOVIMIENTOS, efectos.movimiento ? (movSinCurva as EfectosV["movimiento"]) : null);
  const col = clave(COLORES, efectos.color);
  const propia = efectos.transicion as TransicionV | null;
  const trEfectiva = indice === 0 ? null : (propia ?? estilo?.transicion ?? null);
  const aspEfectivo = (efectos.efectos ?? estilo?.efectos ?? []) as EfectoUI[];
  const cambiosPropios = (indice > 0 && propia ? 1 : 0) + (efectos.efectos !== null ? 1 : 0) + (curva ? 1 : 0);
  const resumen = [
    indice === 0 ? null : `entrada: ${nombreDe(TRANSICIONES, claveTransicion(trEfectiva)).toLowerCase()}`,
    `aspecto: ${nombreDe(ASPECTOS, claveAspecto(aspEfectivo)).toLowerCase()}`,
    efectos.movimiento ? `cámara: ${NOMBRES_MOV[mov] ?? mov}` : null,
  ].filter(Boolean).join(" · ");
  const ed = (cambio: object) => editar({ tipo: "efectosVisual", escena, ...cambio });
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-tenue">
        Efectos del plano <span className="text-xs">({resumen}{cambiosPropios ? " · con cambios propios" : ""})</span>
      </summary>
      <div className="mt-3 space-y-4">
        {indice === 0
          ? <p className="text-xs text-tenue">La primera escena no tiene entrada: es el comienzo del video.</p>
          : <GaleriaTransiciones titulo="Cómo entra esta escena" valor={propia} heredado={estilo?.transicion ?? null} conGolpe={!estilo?.transicion}
              formato={formato} imgA={imgA} imgB={imgB} deshabilitado={ocupado}
              onElegir={(t) => void ed({ transicion: t })} onVolver={() => void ed({ transicion: null })} />}
        <GaleriaAspectos titulo="Aspecto de esta escena" valor={efectos.efectos as EfectoUI[] | null} heredado={(estilo?.efectos ?? null) as EfectoUI[] | null}
          formato={formato} img={imgB} deshabilitado={ocupado}
          // «Natural» sin estilo que heredar no es una excepción: se guarda como «sin valor propio».
          onElegir={(e) => void ed({ efectos: e.length === 0 && !estilo?.efectos?.length ? null : e })}
          onVolver={() => void ed({ efectos: null })} />
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="etiqueta">Movimiento de cámara
            <select className="campo py-1" disabled={ocupado} value={mov}
              onChange={(ev) => {
                const m = MOVIMIENTOS[ev.target.value];
                void ed({ movimiento: m ? { ...m, ...(curva ? { curva } : {}) } : null });
              }}>
              <option value="ninguno">Ninguno (imagen quieta)</option>
              <option value="acercar">Acercar despacio</option>
              <option value="alejar">Alejar despacio</option>
              <option value="izquierda-derecha">Paneo a la derecha</option>
              <option value="derecha-izquierda">Paneo a la izquierda</option>
              {mov === "personalizado" && <option value="personalizado" disabled>Personalizado</option>}
            </select>
          </label>
          <label className="etiqueta">Velocidad del clip
            <select className="campo py-1" disabled={ocupado} value={String(efectos.velocidad)}
              onChange={(ev) => void ed({ velocidad: Number(ev.target.value) })}>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((x) => <option key={x} value={String(x)}>{x === 1 ? "Normal" : x < 1 ? `${x}× (cámara lenta)` : `${x}× (más rápido)`}</option>)}
            </select>
          </label>
          <label className="etiqueta">Color
            <select className="campo py-1" disabled={ocupado} value={col}
              onChange={(ev) => void ed({ color: COLORES[ev.target.value] ?? null })}>
              <option value="natural">Natural</option>
              <option value="vivo">Más vivo</option>
              <option value="claro">Más claro</option>
              <option value="apagado">Apagado</option>
              <option value="blanco-negro">Blanco y negro</option>
              {col === "personalizado" && <option value="personalizado" disabled>Personalizado</option>}
            </select>
          </label>
        </div>
        {efectos.movimiento && (
          <SelectorRitmo titulo="Ritmo del movimiento de cámara" valor={curva ?? null} heredado={estilo?.curva ?? null} deshabilitado={ocupado}
            onElegir={(c) => void ed({ curva: c })} onVolver={() => void ed({ curva: null })} />
        )}
      </div>
    </details>
  );
}

/** Estilo del video: aspecto, transición entre escenas y ritmo para todas las escenas a la vez. */
export function PanelEstilo({ estilo, escenas, formato, imgs, editar, editarVarias, ocupado }: {
  estilo: EstiloV;
  escenas: { id: string; indice: number; efectos: EfectosV }[];
  formato: string;
  /** Miniaturas de las dos primeras escenas (vistas previas). */
  imgs: (string | undefined)[];
  editar: Editar;
  editarVarias: (ediciones: object[]) => Promise<void>;
  ocupado: boolean;
}) {
  const excepciones = escenas.filter((e) => (e.indice > 0 && e.efectos.transicion) || e.efectos.efectos !== null || e.efectos.movimiento?.curva);
  return (
    <section className="tarjeta space-y-5 p-4">
      <div>
        <h2 className="font-medium">Estilo del video</h2>
        <p className="text-xs text-tenue">
          Se aplica a todas las escenas de una vez. Si una escena necesita algo distinto, cámbialo en sus «Efectos del plano»;
          el resto sigue este estilo. Pasa el cursor sobre cada opción para verla en movimiento.
        </p>
      </div>
      <GaleriaAspectos titulo="Aspecto" valor={(estilo.efectos ?? []) as EfectoUI[]} formato={formato} img={imgs[0]} deshabilitado={ocupado}
        onElegir={(e) => void editar({ tipo: "estiloVideo", efectos: e.length ? e : null })} />
      <GaleriaTransiciones titulo="Cómo se pasa de una escena a la siguiente" valor={estilo.transicion} formato={formato} imgA={imgs[0]} imgB={imgs[1]} deshabilitado={ocupado}
        onElegir={(t) => void editar({ tipo: "estiloVideo", transicion: t })} />
      <SelectorRitmo titulo="Ritmo del movimiento de cámara (en las escenas que se mueven)" valor={estilo.curva ?? "lineal"} deshabilitado={ocupado}
        onElegir={(c) => void editar({ tipo: "estiloVideo", curva: c })} />
      {excepciones.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-borde pt-3 text-sm">
          <span className="text-tenue">
            {excepciones.length === 1 ? "1 escena tiene" : `${excepciones.length} escenas tienen`} ajustes propios que no siguen este estilo
            (escena {excepciones.map((e) => e.indice + 1).join(", ")}).
          </span>
          <button type="button" className="boton ml-auto" disabled={ocupado}
            onClick={() => {
              if (!confirm("¿Quitar los ajustes propios de esas escenas para que todas sigan el estilo del video? Puedes volver atrás en el historial.")) return;
              void editarVarias(excepciones.map((e) => ({
                tipo: "efectosVisual", escena: e.id,
                ...(e.indice > 0 && e.efectos.transicion ? { transicion: null } : {}),
                ...(e.efectos.efectos !== null ? { efectos: null } : {}),
                ...(e.efectos.movimiento?.curva ? { curva: null } : {}),
              })));
            }}>Que todas sigan el estilo</button>
        </div>
      )}
    </section>
  );
}

/** Mezcla, entrada y aspecto de una superposición ya agregada. */
function AjustesSuperposicion({ clip, formato, img, editar, ocupado }: {
  clip: ExtrasV["libres"][number]["clips"][number]; formato: string; img?: string; editar: Editar; ocupado: boolean;
}) {
  const ed = (cambio: object) => editar({ tipo: "editarClipLibre", clip: clip.id, ...cambio });
  return (
    <div className="space-y-3 rounded border border-borde p-2">
      <SelectorMezcla fusion={clip.fusion as Fusion | null} deshabilitado={ocupado} onElegir={(f) => void ed({ fusion: f })} />
      <details>
        <summary className="cursor-pointer text-xs text-tenue">Cómo aparece y su aspecto</summary>
        <div className="mt-2 space-y-3">
          <GaleriaTransiciones titulo="Cómo aparece" valor={clip.transicion as TransicionV | null} conGolpe={false} formato={formato} imgB={img} deshabilitado={ocupado}
            onElegir={(t) => void ed({ transicion: t })} />
          <GaleriaAspectos titulo="Aspecto" valor={(clip.efectos ?? []) as EfectoUI[]} formato={formato} img={img} deshabilitado={ocupado}
            onElegir={(e) => void ed({ efectos: e.length ? e : null })} />
        </div>
      </details>
    </div>
  );
}

const PLATAFORMAS = [["youtube", "YouTube Shorts"], ["tiktok", "TikTok"], ["instagram", "Instagram Reels"], ["facebook", "Facebook Reels"]] as const;

/** Destino, edición por texto global, música, textos superpuestos y pistas libres del proyecto. */
export function PanelAvanzado({ extras, formato, total, editar, alinearMusica, subirLibre, ocupado, slug }: {
  extras: ExtrasV; formato: string; total: number; ocupado: boolean;
  /** Para las miniaturas de las superposiciones. */
  slug?: string;
  editar: Editar;
  alinearMusica: () => Promise<void>;
  subirLibre: (f: File, pista: string, inicio: number, licencia: string) => Promise<void>;
}) {
  const d = extras.destino;
  const [texto, setTexto] = useState({ texto: "", inicio: "0", duracion: "3", estilo: "rotulo", posicion: "arriba" });
  const [libre, setLibre] = useState({ inicio: "0", licencia: "" });
  const conPlataformas = (pl: string, on: boolean) => editar({ tipo: "cambiarDestino", plataformas: on ? [...d.plataformas, pl] : d.plataformas.filter((x) => x !== pl) });
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <div className="tarjeta space-y-3 p-4">
        <h2 className="font-medium">Destino y entrega</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={d.comercial} disabled={ocupado} onChange={(e) => void editar({ tipo: "cambiarDestino", comercial: e.target.checked })} />
          <span>Uso comercial (monetizado o para un cliente): el QC <strong>bloquea</strong> cualquier asset cuya licencia no lo permita o no se sepa.</span>
        </label>
        <fieldset className="space-y-1 text-sm" disabled={ocupado}>
          <legend className="etiqueta">Dónde se publica {formato !== "9:16" && <span className="text-tenue">(sólo cambia algo en 9:16)</span>}</legend>
          {PLATAFORMAS.map(([id, nombre]) => (
            <label key={id} className="mr-4 inline-flex items-center gap-1">
              <input type="checkbox" checked={d.plataformas.includes(id)} onChange={(e) => void conPlataformas(id, e.target.checked)} /> {nombre}
            </label>
          ))}
          <p className="text-xs text-tenue">Marca, subtítulos y textos se acomodan dentro de lo que no tapa la interfaz de todas las elegidas.</p>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={d.master} disabled={ocupado} onChange={(e) => void editar({ tipo: "cambiarDestino", master: e.target.checked })} />
          <span>Guardar también un máster de archivo (.mov, calidad alta) en cada render. Tarda más y ocupa mucho más disco.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={d.marca} disabled={ocupado} onChange={(e) => void editar({ tipo: "cambiarDestino", marca: e.target.checked })} />
          <span>Mostrar la marca del canal arriba durante el video (la tarjeta final la muestra siempre). Apágala si tapa una cara.</span>
        </label>
      </div>

      <div className="tarjeta space-y-3 p-4">
        <h2 className="font-medium">Edición por texto y ritmo</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton" disabled={ocupado} onClick={() => void editar({ tipo: "quitarSilencios" })} title="Pausas de más de 0,6 s quedan en 0,25 s">Acortar silencios largos</button>
          <button type="button" className="boton" disabled={ocupado} onClick={() => void editar({ tipo: "quitarMuletillas" })} title="eh, em, mmm, uh…">Quitar muletillas</button>
          <button type="button" className="boton" disabled={ocupado} onClick={() => { if (confirm("¿Deshacer todos los recortes del proyecto?")) void editar({ tipo: "quitarRecortes" }); }}>Deshacer recortes</button>
        </div>
        {extras.confianza.medidas > 0
          ? <p className="text-xs text-tenue">Tiempos de la voz: {extras.confianza.dudosas} de {extras.confianza.medidas} palabras dudosas ({Math.round(extras.confianza.proporcion * 100)} %).{extras.confianza.dudosas > 0 && " Revísalas en cada escena con «Revisarlas una por una»: se escuchan y se confirman o se recortan."}</p>
          : <p className="text-xs text-tenue">Tiempos de la voz sin medir (proyecto anterior): regenera la voz para medir su confianza.</p>}
        {extras.musica && (
          <div className="flex flex-wrap items-center gap-2 border-t border-borde pt-3 text-sm">
            <span>Música desde {extras.musica.inicio.toFixed(2)} s · {extras.musica.pulsos ? `${extras.musica.pulsos} pulsos marcados` : "sin pulsos"}</span>
            <button type="button" className="boton ml-auto" disabled={ocupado} onClick={() => void alinearMusica()}>Alinear cortes al ritmo</button>
          </div>
        )}
      </div>

      <div className="tarjeta space-y-3 p-4">
        <h2 className="font-medium">Textos en pantalla</h2>
        {extras.textos.length > 0 && (
          <ul className="space-y-1 text-sm">
            {extras.textos.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-mono text-xs text-tenue">{t.inicio.toFixed(1)}–{(t.inicio + t.duracion).toFixed(1)} s</span>
                <span className="min-w-0 flex-1 truncate">«{t.texto}» <span className="text-xs text-tenue">({t.estilo}, {t.posicion})</span></span>
                <button type="button" className="boton py-0.5 text-xs" disabled={ocupado} onClick={() => void editar({ tipo: "quitarTexto", id: t.id })}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
        <form className="grid gap-2 sm:grid-cols-6" onSubmit={(ev) => {
          ev.preventDefault();
          void editar({ tipo: "agregarTexto", texto: { texto: texto.texto.trim(), inicio: Number(texto.inicio), duracion: Number(texto.duracion), estilo: texto.estilo, posicion: texto.posicion } })
            .then(() => setTexto({ ...texto, texto: "" }));
        }}>
          <input aria-label="Texto" className="campo sm:col-span-6" placeholder="Título, dato o rótulo" maxLength={160} value={texto.texto} onChange={(e) => setTexto({ ...texto, texto: e.target.value })} />
          <label className="etiqueta sm:col-span-1">Desde (s)<input className="campo py-1" type="number" min={0} max={total} step={0.1} value={texto.inicio} onChange={(e) => setTexto({ ...texto, inicio: e.target.value })} /></label>
          <label className="etiqueta sm:col-span-1">Dura (s)<input className="campo py-1" type="number" min={0.3} max={60} step={0.1} value={texto.duracion} onChange={(e) => setTexto({ ...texto, duracion: e.target.value })} /></label>
          <label className="etiqueta sm:col-span-2">Estilo<select className="campo py-1" value={texto.estilo} onChange={(e) => setTexto({ ...texto, estilo: e.target.value })}><option value="rotulo">Rótulo</option><option value="titulo">Título</option><option value="cita">Cita</option></select></label>
          <label className="etiqueta sm:col-span-2">Dónde<select className="campo py-1" value={texto.posicion} onChange={(e) => setTexto({ ...texto, posicion: e.target.value })}><option value="arriba">Arriba</option><option value="centro">Centro</option><option value="abajo">Sobre los subtítulos</option></select></label>
          <button type="submit" className="boton sm:col-span-6" disabled={ocupado || !texto.texto.trim()}>Agregar texto</button>
        </form>
      </div>

      <div className="tarjeta space-y-3 p-4">
        <h2 className="font-medium">Superposiciones y efectos de sonido</h2>
        {extras.libres.length > 0 && (
          <ul className="space-y-1 text-sm">
            {extras.libres.flatMap((pi) => pi.clips.map((c) => (
              <li key={c.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono text-xs text-tenue">{c.inicio.toFixed(1)} s · {segundos(c.duracion)}</span>
                  <span className="min-w-0 flex-1 truncate">{pi.tipo === "audio" ? "Sonido" : "Imagen/video"}: {c.ruta.split("/").pop()}</span>
                  <button type="button" className="boton py-0.5 text-xs" disabled={ocupado} onClick={() => void editar({ tipo: "quitarClipLibre", clip: c.id })}>Quitar</button>
                </div>
                {pi.tipo === "video" && (
                  <AjustesSuperposicion clip={c} formato={formato} editar={editar} ocupado={ocupado}
                    img={slug ? `/api/miniatura?p=${slug}&ruta=${encodeURIComponent(c.ruta)}&t=${(c.desde + 0.5).toFixed(1)}` : undefined} />
                )}
              </li>
            )))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="etiqueta">Desde (s)<input className="campo py-1" type="number" min={0} max={total} step={0.1} value={libre.inicio} onChange={(e) => setLibre({ ...libre, inicio: e.target.value })} /></label>
          <label className="etiqueta">Licencia (si no es tuyo)<input className="campo py-1" placeholder="p. ej. CC0, Pixabay" value={libre.licencia} onChange={(e) => setLibre({ ...libre, licencia: e.target.value })} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          {([["broll", "Agregar imagen o video encima…", `video/*,${ACCEPT_IMAGEN}`], ["efectos", "Agregar efecto de sonido…", "audio/*"]] as const).map(([pista, nombre, accept]) => (
            <label key={pista} className="boton cursor-pointer">
              {nombre}
              <input type="file" accept={accept} className="sr-only" disabled={ocupado}
                onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void subirLibre(f, pista, Number(libre.inicio), libre.licencia); ev.target.value = ""; }} />
            </label>
          ))}
        </div>
        <p className="text-xs text-tenue">
          La imagen o video va encima del plano de fondo (debajo de marca y subtítulos). Geeper elige sola cómo mezclarla: si tiene fondo negro
          (luces, destellos) sólo se ven las partes claras; si es blanco (papel, manchas), sólo las oscuras. Lo puedes cambiar después.
          El sonido suena fuera del ducking de la música.
        </p>
      </div>
    </section>
  );
}
