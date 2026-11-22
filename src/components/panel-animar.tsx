"use client";
import { useEffect, useMemo, useState } from "react";
import { Aviso, useSondeo } from "./comun";
import { NOMBRES, type Camara } from "@/lib/prompt-camara";

interface ModeloV { id: string; nombre: string; nota: string; descripcion: string; simple: boolean; maxSegundos: number; necesitaImagen: boolean; licencia: string; estado: string | null }
interface TrabajoV { id: string; estado: string; etapa: string; progreso: number; escena: string | null }
interface PlanV { numero: number; duracionEscena: number; modelo: string; promptBase: string; origenPrompt: "pedido" | "imagen" | "texto"; prompt: string; segundos: number; notas: string[]; avisos: string[]; largo: number; velocidad: number | null }
interface Datos {
  wan2gp: { listo: boolean; falta: string | null; instalando: boolean };
  modeloPorDefecto: string;
  modelos: ModeloV[];
  plan: PlanV | null;
  error: string | null;
  trabajos: TrabajoV[];
}

export interface OpcionesAnimar {
  modelo?: string;
  prompt?: string;
  segundos?: number;
  semilla?: number;
  sinImagen?: boolean;
  camara?: Camara;
}

const MOVS: { id: keyof typeof NOMBRES.movimiento; icono: string }[] = [
  { id: "fijo", icono: "■" },
  { id: "acercar", icono: "⊕" },
  { id: "alejar", icono: "⊖" },
  { id: "paneo-izq", icono: "←" },
  { id: "paneo-der", icono: "→" },
  { id: "orbita", icono: "⟳" },
  { id: "mano", icono: "≈" },
];

const ESTADO_PESOS: Record<string, string> = {
  listo: "descargado",
  "sin-pesos": "se descarga la primera vez",
  definido: "listo",
  "no-existe": "no está en esta versión de Wan2GP",
};

/** Cada cuánto se consulta /plano: abierto, 3 s; cerrado y animando, 10 s; cerrado y quieto, nunca. */
export const intervaloAnimar = (abierto: boolean, animando: boolean) => (abierto ? 3000 : animando ? 10_000 : Infinity);

/**
 * «Animar esta escena»: convierte la imagen de la escena en un video corto con Wan2GP (en la GPU de este
 * equipo). Lo simple a la vista (movimiento, duración, rápido o calidad); lo demás en «Más opciones».
 */
export function PanelAnimar({ proyectoId, escena, numero, ocupado, animar }: {
  proyectoId: string; escena: string; numero: number; ocupado: boolean;
  animar: (escena: string, opciones: OpcionesAnimar) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  // Abierto: cada 3 s. Cerrado: sólo mientras esta escena se anima (para mostrar el avance en el título);
  // si no, una consulta al abrir la página y nada más (la animación sólo se lanza desde aquí).
  const { datos, recargar } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/plano?escena=${encodeURIComponent(escena)}`,
    (d) => intervaloAnimar(abierto, d?.trabajos.some((t) => t.escena === escena) ?? false));
  const trabajo = datos?.trabajos.find((t) => t.escena === escena) ?? null;
  const animarYVer = async (e: string, o: OpcionesAnimar) => {
    await animar(e, o);
    await recargar();
  };
  return (
    <details className="text-sm" open={abierto} onToggle={(ev) => {
      const abre = (ev.target as HTMLDetailsElement).open;
      setAbierto(abre);
      if (abre) void recargar(); // al abrir, datos frescos y vuelve el ritmo de 3 s
    }}>
      <summary className="cursor-pointer text-tenue">
        Animar esta escena con IA <span className="text-xs">(convierte la imagen en video{trabajo ? ` · ${trabajo.estado === "pendiente" ? "en espera" : trabajo.etapa || "animando"}` : ""})</span>
      </summary>
      {abierto && <Contenido proyectoId={proyectoId} escena={escena} numero={numero} ocupado={ocupado} animar={animarYVer} trabajo={trabajo} base={datos} />}
    </details>
  );
}

function Contenido({ proyectoId, escena, numero, ocupado, animar, trabajo, base }: {
  proyectoId: string; escena: string; numero: number; ocupado: boolean; trabajo: TrabajoV | null; base: Datos | null;
  animar: (escena: string, opciones: OpcionesAnimar) => Promise<void>;
}) {
  const [modelo, setModelo] = useState<string | null>(null);
  const [mov, setMov] = useState<Camara["movimiento"]>();
  const [segundos, setSegundos] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [lente, setLente] = useState<Camara["lente"]>();
  const [plano, setPlano] = useState<Camara["plano"]>();
  const [luz, setLuz] = useState<Camara["luz"]>();
  const [look, setLook] = useState<Camara["look"]>();
  const [focal, setFocal] = useState<Camara["focal"]>();
  const [apertura, setApertura] = useState<Camara["apertura"]>();
  const [camara, setCamara] = useState<Camara["camara"]>();
  const [sinImagen, setSinImagen] = useState(false);
  const [semilla, setSemilla] = useState("");

  const opciones: OpcionesAnimar = useMemo(() => {
    const cam: Camara = { movimiento: mov, lente, focal, apertura, camara, plano, luz, look };
    const o: OpcionesAnimar = {};
    if (modelo) o.modelo = modelo;
    if (prompt.trim()) o.prompt = prompt.trim();
    if (segundos) o.segundos = segundos;
    if (sinImagen) o.sinImagen = true;
    if (semilla.trim() && /^\d+$/.test(semilla.trim())) o.semilla = Number(semilla.trim());
    if (Object.values(cam).some((v) => v !== undefined)) o.camara = Object.fromEntries(Object.entries(cam).filter(([, v]) => v !== undefined)) as Camara;
    return o;
  }, [modelo, mov, segundos, prompt, lente, focal, apertura, camara, plano, luz, look, sinImagen, semilla]);

  // El plan se vuelve a pedir con las opciones elegidas (descripción final, avisos, duración real), sin
  // hacerlo en cada tecla.
  const [pedidas, setPedidas] = useState(opciones);
  useEffect(() => {
    const t = setTimeout(() => setPedidas(opciones), 400);
    return () => clearTimeout(t);
  }, [opciones]);
  const { datos: conOpciones } = useSondeo<Datos>(`/api/proyectos/${proyectoId}/plano?escena=${encodeURIComponent(escena)}&opciones=${encodeURIComponent(JSON.stringify(pedidas))}`, 15_000);
  const d = conOpciones ?? base;
  if (!d) return <p className="mt-2 text-xs text-tenue">Cargando…</p>;

  if (!d.wan2gp.listo) {
    return (
      <div className="mt-3 space-y-2">
        <Aviso tipo="info">
          {d.wan2gp.instalando
            ? "Se está instalando el programa que anima las escenas. Puedes ver cómo va en Sistema; cuando termine, vuelve aquí."
            : "Para animar escenas hace falta instalar una vez Wan2GP, el programa gratuito que genera el video con la tarjeta de video de este equipo. Ocupa unos 10 GB y tarda entre 15 y 30 minutos."}
        </Aviso>
        <a className="boton boton-primario inline-block" href="/sistema#wan2gp">Ir a Sistema para instalarlo</a>
      </div>
    );
  }

  const elegido = d.modelos.find((m) => m.id === (modelo ?? d.modeloPorDefecto))!;
  const plan = d.plan;
  const max = elegido.maxSegundos;
  const valorSeg = segundos ?? Math.min(plan?.largo ?? max, max);

  if (trabajo) {
    const pct = Math.round(trabajo.progreso * 100);
    return (
      <div className="mt-3 space-y-2" aria-live="polite">
        <p>{trabajo.estado === "pendiente" ? "En espera: empieza cuando la tarjeta de video quede libre." : (trabajo.etapa || "Animando…")}</p>
        <div className="h-2 w-72 max-w-full overflow-hidden rounded bg-white/10" role="progressbar" aria-label={`Animando la escena ${numero}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-sky-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-tenue">Puedes seguir editando. Cuando termine, la escena queda con el video nuevo en una versión nueva («Historial» la deshace). Para cancelar, usa «Trabajos» más abajo.</p>
      </div>
    );
  }

  async function lanzar() {
    if (!confirm(`Animar la escena ${numero} usa toda la tarjeta de video durante varios minutos (la primera vez, además, baja el modelo) y pausa la IA de MoneyPrinterTurbo mientras tanto.\n\nGuarda lo que tengas abierto en Windows antes de seguir.\n\n¿Animar ahora?`)) return;
    // Las opciones de este momento, no las de la última consulta (puede faltar la espera de 400 ms).
    await animar(escena, opciones);
  }

  const simples = d.modelos.filter((m) => m.simple);
  return (
    <div className="mt-3 space-y-4">
      <fieldset>
        <legend className="etiqueta mb-1">Cómo se mueve la cámara en el video nuevo</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          <button type="button" role="radio" aria-checked={!mov} className={`boton py-1 ${!mov ? "boton-primario" : ""}`} onClick={() => setMov(undefined)}>Que decida la IA</button>
          {MOVS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mov === m.id} className={`boton py-1 ${mov === m.id ? "boton-primario" : ""}`} onClick={() => setMov(m.id)}>
              <span aria-hidden="true" className="mr-1">{m.icono}</span>{NOMBRES.movimiento[m.id]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="etiqueta block">
        Duración del video nuevo: {valorSeg.toFixed(1)} s{plan ? <span className="text-tenue"> (la escena dura {plan.largo.toFixed(1)} s; como mucho {max} s)</span> : null}
        <input type="range" className="mt-1 block w-72 max-w-full" min={1} max={max} step={0.5} value={valorSeg} onChange={(ev) => setSegundos(Number(ev.target.value))} />
      </label>

      <fieldset>
        <legend className="etiqueta mb-1">¿Más rápido o más detalle?</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {simples.map((m) => {
            const activo = elegido.id === m.id;
            return (
              <button key={m.id} type="button" role="radio" aria-checked={activo} onClick={() => setModelo(m.id)}
                className={`rounded border p-2 text-left ${activo ? "border-sky-400 bg-sky-400/10" : "border-white/10 hover:border-white/30"}`}>
                <span className="font-medium">{m.nombre}</span>
                <span className="block text-xs text-tenue">{m.descripcion}{m.estado === "sin-pesos" ? " La primera vez tarda unos 10 minutos más: descarga lo que necesita (unos 14 GB)." : ""}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <details>
        <summary className="cursor-pointer text-tenue">Más opciones</summary>
        <div className="mt-3 space-y-3">
          <label className="etiqueta block">Qué tiene que pasar en el video
            <textarea className="campo mt-1" rows={2} maxLength={1500} value={prompt} placeholder={plan?.promptBase ?? ""} onChange={(ev) => setPrompt(ev.target.value)} />
            <span className="text-xs text-tenue">
              {plan?.origenPrompt === "imagen" && !prompt ? "Vacío: se usa la descripción con la que se hizo la imagen. " : ""}
              {plan?.origenPrompt === "texto" && !prompt ? "Vacío: se usa lo que se dice en la escena. " : ""}
              En inglés suele funcionar mejor (p. ej. «waves crash against the rocks, seagulls fly»).
            </span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Selector etiqueta="Plano" valor={plano} opciones={NOMBRES.plano} cambiar={setPlano} />
            <Selector etiqueta="Luz" valor={luz} opciones={NOMBRES.luz} cambiar={setLuz} />
            <Selector etiqueta="Look" valor={look} opciones={NOMBRES.look} cambiar={setLook} />
            <Selector etiqueta="Lente" valor={lente} opciones={NOMBRES.lente} cambiar={setLente} />
            <Selector etiqueta="Distancia focal" valor={focal === undefined ? undefined : String(focal)} opciones={NOMBRES.focal as Record<string, string>} cambiar={(v) => setFocal(v === undefined ? undefined : (Number(v) as Camara["focal"]))} />
            <Selector etiqueta="Desenfoque del fondo" valor={apertura} opciones={NOMBRES.apertura} cambiar={setApertura} />
            <Selector etiqueta="Tipo de cámara" valor={camara} opciones={NOMBRES.camara} cambiar={setCamara} />
          </div>
          <fieldset>
            <legend className="etiqueta mb-1">Motor</legend>
            <div className="space-y-1">
              {d.modelos.map((m) => (
                <label key={m.id} className="flex items-start gap-2">
                  <input type="radio" name={`modelo-${escena}`} className="mt-1" checked={elegido.id === m.id} onChange={() => setModelo(m.id)} />
                  <span>{m.nombre} <span className="text-xs text-tenue">· {m.nota} · {m.licencia}{m.estado ? ` · ${ESTADO_PESOS[m.estado] ?? m.estado}` : ""}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!sinImagen} disabled={elegido.necesitaImagen} onChange={(ev) => setSinImagen(!ev.target.checked)} />
            Partir de la imagen de la escena <span className="text-xs text-tenue">(si no, el video sale sólo de la descripción)</span>
          </label>
          <label className="etiqueta block">Semilla <span className="text-tenue">(el mismo número repite el mismo resultado; vacío = al azar)</span>
            <input className="campo mt-1 w-40" inputMode="numeric" value={semilla} onChange={(ev) => setSemilla(ev.target.value.replace(/\D/g, "").slice(0, 10))} />
          </label>
          {plan && <p className="text-xs text-tenue">Se pedirá: «{plan.prompt}»</p>}
        </div>
      </details>

      {d.error && <Aviso tipo="error">{d.error}</Aviso>}
      {plan?.notas.map((a) => <p key={a} className="text-xs text-tenue">{a}</p>)}
      {plan?.avisos.map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="boton boton-primario" disabled={ocupado || !plan} onClick={() => void lanzar()}>Animar la escena {numero}</button>
        <span className="text-xs text-tenue">Queda como versión nueva: si no te gusta, vuelves atrás en «Historial».</span>
      </div>
    </div>
  );
}

function Selector<K extends string>({ etiqueta, valor, opciones, cambiar }: {
  etiqueta: string; valor: K | undefined; opciones: Record<K, string>; cambiar: (v: K | undefined) => void;
}) {
  return (
    <label className="etiqueta">{etiqueta}
      <select className="campo mt-1 py-1" value={valor ?? ""} onChange={(ev) => cambiar((ev.target.value || undefined) as K | undefined)}>
        <option value="">Sin indicar</option>
        {(Object.entries(opciones) as [K, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}
