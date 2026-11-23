"use client";
/**
 * Galerías para elegir transiciones, aspecto y ritmo del movimiento sin saber de edición: cada opción
 * es una tarjeta con una miniatura animada, un nombre simple y cuándo conviene usarla.
 *
 * Las miniaturas de las transiciones con máscara usan la misma máscara CSS que el render
 * (`mascaraTransicion`), y la del ritmo, la misma curva Bézier: lo que se ve aquí es lo que sale.
 */
import { useId } from "react";
import { CURVAS, MEZCLAS_SIMPLES, mezclaSimple, type Fusion } from "@/lib/efectos-esquema";
import { curvaNiveles, factorVineta, mascaraTransicion, matrizTinte, VAR_AVANCE } from "@/lib/efectos-calculo";

// ---------------------------------------------------------------- tipos y catálogos

export interface TransicionV {
  tipo: string;
  duracion: number;
  angulo?: number;
  suavizado?: number;
  ancho?: number;
  sentido?: "horario" | "antihorario" | "ambos";
}
// Los efectos llegan de geeper.json tal cual: se leen con cuidado.
type EfectoV = { tipo: string } & Record<string, unknown>;

interface Opcion {
  clave: string;
  nombre: string;
  ayuda: string;
}

/** Transiciones con sus valores al elegirlas (las de máscara, con las fórmulas de EffectCraft). */
export const TRANSICIONES: (Opcion & { valor: TransicionV | null })[] = [
  { clave: "golpe", nombre: "Golpe de zoom", ayuda: "Corte con un pequeño empujón de zoom. Es la del estilo del canal: rápida y con energía.", valor: null },
  { clave: "corte", nombre: "Corte directo", ayuda: "Cambia de golpe, sin efecto. Para un ritmo rápido o un tono serio.", valor: { tipo: "corte", duracion: 0.4 } },
  { clave: "fundido", nombre: "Fundido", ayuda: "Una escena se disuelve en la otra. Suave, para momentos tranquilos o emotivos.", valor: { tipo: "fundido", duracion: 0.5 } },
  { clave: "deslizar", nombre: "Deslizar", ayuda: "La escena nueva entra desde un lado, como pasar de página. Para listas y pasos.", valor: { tipo: "deslizar", duracion: 0.45 } },
  { clave: "zoom", nombre: "Acercamiento", ayuda: "La escena nueva aparece creciendo. Para sorprender o subir la emoción.", valor: { tipo: "zoom", duracion: 0.45 } },
  { clave: "barrido", nombre: "Barrido", ayuda: "Un borde suave recorre la pantalla y descubre la escena nueva. Para cambiar de tema.", valor: { tipo: "barrido", duracion: 0.6, angulo: 90, suavizado: 60 } },
  { clave: "radial", nombre: "Reloj", ayuda: "Se descubre girando como una aguja. Para pasos, cuentas o «mientras tanto».", valor: { tipo: "radial", duracion: 0.7, suavizado: 30, sentido: "horario" } },
  { clave: "iris", nombre: "Círculo", ayuda: "Se abre un círculo desde el centro. Para revelar algo importante.", valor: { tipo: "iris", duracion: 0.6, suavizado: 40 } },
  { clave: "persianas", nombre: "Persianas", ayuda: "Franjas que se abren a la vez. Llamativa: mejor usarla poco.", valor: { tipo: "persianas", duracion: 0.6, angulo: 90, ancho: 90 } },
];

/** Direcciones de las transiciones que la tienen (en vez de grados). */
const DIRECCIONES: Record<string, { etiqueta: string; titulo: string; cambio: Partial<TransicionV> }[]> = {
  barrido: [
    { etiqueta: "→", titulo: "De izquierda a derecha", cambio: { angulo: 90 } },
    { etiqueta: "←", titulo: "De derecha a izquierda", cambio: { angulo: 270 } },
    { etiqueta: "↓", titulo: "De arriba abajo", cambio: { angulo: 180 } },
    { etiqueta: "↘", titulo: "En diagonal", cambio: { angulo: 135 } },
  ],
  persianas: [
    { etiqueta: "‖", titulo: "Franjas verticales", cambio: { angulo: 90 } },
    { etiqueta: "☰", titulo: "Franjas horizontales", cambio: { angulo: 180 } },
  ],
  radial: [
    { etiqueta: "↻", titulo: "Como el reloj", cambio: { sentido: "horario" } },
    { etiqueta: "↺", titulo: "Al revés del reloj", cambio: { sentido: "antihorario" } },
    { etiqueta: "⇅", titulo: "Hacia los dos lados", cambio: { sentido: "ambos" } },
  ],
};

/** Aspectos: combinaciones de efectos, en orden de aplicación. */
export const ASPECTOS: (Opcion & { valor: EfectoV[] })[] = [
  { clave: "natural", nombre: "Natural", ayuda: "La imagen tal como es, sin efectos.", valor: [] },
  {
    clave: "pelicula", nombre: "Película", ayuda: "Bordes un poco más oscuros y grano fino, como cine. Queda bien casi siempre.",
    valor: [{ tipo: "vineta", cantidad: 0.35, angulo: 60 }, { tipo: "grano", cantidad: 0.08, color: false, semilla: 1 }],
  },
  {
    clave: "sepia", nombre: "Recuerdo", ayuda: "Tonos cálidos de foto antigua. Para historia, nostalgia o el «antes».",
    valor: [{ tipo: "tinte", negro: "#1f1408", blanco: "#fff1d6", cantidad: 0.85 }, { tipo: "vineta", cantidad: 0.4, angulo: 60 }],
  },
  {
    clave: "noir", nombre: "Blanco y negro", ayuda: "Blanco y negro con contraste y grano. Dramático: misterio, crimen, momentos serios.",
    valor: [
      { tipo: "tinte", negro: "#000000", blanco: "#ffffff", cantidad: 1 },
      { tipo: "niveles", entradaNegro: 0.08, entradaBlanco: 0.92, gamma: 0.9, salidaNegro: 0, salidaBlanco: 1 },
      { tipo: "vineta", cantidad: 0.55, angulo: 70 },
      { tipo: "grano", cantidad: 0.12, color: false, semilla: 1 },
    ],
  },
  {
    clave: "sueno", nombre: "Sueño", ayuda: "Más claro y apenas desenfocado. Para recuerdos, fantasía o calma.",
    valor: [{ tipo: "niveles", entradaNegro: 0, entradaBlanco: 0.9, gamma: 1.15, salidaNegro: 0.06, salidaBlanco: 1 }, { tipo: "desenfoque", radio: 2 }],
  },
];

export const RITMOS: (Opcion & { clave: keyof typeof CURVAS })[] = [
  { clave: "suave", nombre: "Suave", ayuda: "Arranca y frena con suavidad. Se ve natural, como una cámara de cine." },
  { clave: "lineal", nombre: "Constante", ayuda: "Siempre a la misma velocidad. Más mecánico." },
  { clave: "acelera", nombre: "Arranca despacio", ayuda: "Empieza lento y termina rápido: lleva hacia lo que viene." },
  { clave: "frena", nombre: "Frena al final", ayuda: "Empieza rápido y se detiene suave: deja la mirada en el final." },
];

export const MEZCLAS: (Opcion & { clave: keyof typeof MEZCLAS_SIMPLES })[] = [
  { clave: "normal", nombre: "Normal", ayuda: "Se ve tal cual, tapando lo de abajo." },
  { clave: "aclarar", nombre: "Aclarar", ayuda: "Lo negro desaparece y sólo suman las partes claras. Para luces, destellos, polvo y partículas." },
  { clave: "oscurecer", nombre: "Oscurecer", ayuda: "Lo blanco desaparece y sólo quedan las partes oscuras. Para papel, manchas y trazos." },
  { clave: "contraste", nombre: "Contraste", ayuda: "Tiñe y da contraste sin tapar. Para texturas y colores encima." },
];

const igualesEfectos = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
export const claveAspecto = (efs: unknown[] | null | undefined) => ASPECTOS.find((x) => igualesEfectos(x.valor, efs))?.clave ?? "personalizado";
export const claveTransicion = (t: TransicionV | null | undefined) => (t ? t.tipo : "golpe");
export const nombreDe = (lista: Opcion[], clave: string | null | undefined) => lista.find((x) => x.clave === clave)?.nombre ?? "Personalizado";

// ---------------------------------------------------------------- estilos comunes

/** CSS de las animaciones de las miniaturas (una sola vez por página). */
function EstilosGaleria() {
  return (
    <style>{`
      @property ${VAR_AVANCE} { syntax: "<number>"; inherits: false; initial-value: 0; }
      @keyframes gx-avance { 0%, 20% { ${VAR_AVANCE}: 0; } 70%, 100% { ${VAR_AVANCE}: 1; } }
      @keyframes gx-fundido { 0%, 20% { opacity: 0; } 70%, 100% { opacity: 1; } }
      @keyframes gx-deslizar { 0%, 20% { transform: translateX(100%); } 70%, 100% { transform: translateX(0); } }
      @keyframes gx-zoom { 0%, 20% { transform: scale(1.3); opacity: 0; } 70%, 100% { transform: scale(1); opacity: 1; } }
      @keyframes gx-corte { 0%, 44.9% { opacity: 0; } 45%, 100% { opacity: 1; } }
      @keyframes gx-golpe { 0%, 44.9% { opacity: 0; transform: scale(1.07); } 45% { opacity: 1; transform: scale(1.07); } 70%, 100% { opacity: 1; transform: scale(1); } }
      @keyframes gx-punto { 0%, 15% { left: 0; } 75%, 100% { left: calc(100% - 10px); } }
      .gx-b { position: absolute; inset: 0; }
      /* La animación sólo existe al pasar el cursor, con foco o elegida: así empieza desde el principio. */
      .gx-tarjeta:hover .gx-b, .gx-tarjeta:focus-visible .gx-b, .gx-tarjeta[aria-checked="true"] .gx-b,
      .gx-tarjeta:hover .gx-punto, .gx-tarjeta:focus-visible .gx-punto, .gx-tarjeta[aria-checked="true"] .gx-punto {
        animation-name: var(--gx-anim); animation-duration: 2.4s; animation-iteration-count: infinite;
        animation-timing-function: var(--gx-curva, linear);
      }
      @media (prefers-reduced-motion: reduce) {
        .gx-b, .gx-punto { animation: none !important; }
      }
    `}</style>
  );
}

const tamMini = (formato: string) => (formato === "16:9" ? { w: 112, h: 63 } : formato === "1:1" ? { w: 80, h: 80 } : { w: 63, h: 112 });

/** Fondo de una miniatura: la imagen de la escena o, sin ella, un degradado. */
function Fondo({ src, color }: { src?: string; color: string }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
    : <div className="absolute inset-0" style={{ background: color }} />;
}

// ---------------------------------------------------------------- tarjeta genérica

function Tarjeta({ opcion, elegida, heredada, deshabilitada, onElegir, children }: {
  opcion: Opcion; elegida: boolean; heredada: boolean; deshabilitada?: boolean; onElegir: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" role="radio" aria-checked={elegida} disabled={deshabilitada} onClick={onElegir} title={opcion.ayuda}
      className={`gx-tarjeta group flex w-[92px] shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 text-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        elegida ? "border-acento bg-acento/10" : "border-borde hover:border-white/30 hover:bg-white/5"}`}>
      {children}
      <span className={`leading-tight ${elegida ? "font-medium text-white" : ""}`}>{opcion.nombre}</span>
      {heredada && <span className="rounded bg-white/10 px-1 text-[10px] leading-4 text-tenue">del estilo</span>}
    </button>
  );
}

/** Texto de ayuda de la opción elegida (y de dónde viene). */
function Ayuda({ opcion, heredada, onVolver, deshabilitado }: { opcion?: Opcion; heredada: boolean; onVolver?: () => void; deshabilitado?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-tenue">
      {opcion && <span><strong className="text-white/90">{opcion.nombre}:</strong> {opcion.ayuda}</span>}
      {heredada && <span>(viene del estilo del video)</span>}
      {onVolver && <button type="button" className="boton py-0.5 text-xs" disabled={deshabilitado} onClick={onVolver}>Volver al estilo del video</button>}
    </div>
  );
}

// ---------------------------------------------------------------- transiciones

function MiniTransicion({ op, formato, imgA, imgB }: { op: (typeof TRANSICIONES)[number]; formato: string; imgA?: string; imgB?: string }) {
  const { w, h } = tamMini(formato);
  const k = w / (formato === "16:9" ? 1920 : 1080); // px del cuadro → px de la miniatura
  // En reposo se ve la mitad de la transición (así se reconoce sin animar); al pasar el cursor, anima.
  let estilo: React.CSSProperties;
  let anim: string;
  const v = op.valor;
  if (v && (v.tipo === "barrido" || v.tipo === "radial" || v.tipo === "iris" || v.tipo === "persianas")) {
    const m = mascaraTransicion({ ...v, tipo: v.tipo, suavizado: (v.suavizado ?? 0) * k, ancho: v.ancho !== undefined ? Math.max(4, v.ancho * k * 1.6) : undefined }, w, h);
    estilo = { ...cssDe(m.estilo.replace(`${VAR_AVANCE}: 0;`, "")), [VAR_AVANCE]: 0.5 } as React.CSSProperties;
    anim = "gx-avance";
  } else {
    const tipo = v ? v.tipo : "golpe";
    anim = `gx-${tipo}`;
    estilo = tipo === "fundido" ? { opacity: 0.5 }
      : tipo === "deslizar" ? { transform: "translateX(50%)" }
      : tipo === "zoom" ? { transform: "scale(1.15)", opacity: 0.6 }
      : tipo === "golpe" ? { transform: "scale(1.07)" }
      : { clipPath: "inset(0 0 0 50%)" };
  }
  return (
    <span className="relative block overflow-hidden rounded bg-black" style={{ width: w, height: h }} aria-hidden>
      <Fondo src={imgA} color="linear-gradient(160deg,#334155,#0f172a)" />
      <span className="gx-b" style={{ ...estilo, ["--gx-anim" as string]: anim } as React.CSSProperties}>
        <Fondo src={imgB} color="linear-gradient(160deg,#f59e0b,#be185d)" />
      </span>
    </span>
  );
}

/** Convierte `prop: valor; …` en un objeto de estilo de React (sólo para las máscaras generadas). */
function cssDe(css: string): React.CSSProperties {
  const o: Record<string, string> = {};
  for (const decl of css.split(/;(?![^(]*\))/)) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop || !val) continue;
    const clave = prop.startsWith("--") ? prop : prop.replace(/^-webkit-/, "Webkit-").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    o[clave] = val;
  }
  return o as React.CSSProperties;
}

export function GaleriaTransiciones({ valor, heredado, conGolpe = true, formato, imgA, imgB, onElegir, onVolver, deshabilitado, titulo }: {
  /** Transición propia (null = no tiene: usa la heredada o, sin ella, el golpe de zoom). */
  valor: TransicionV | null;
  /** La del estilo del video (null si no hay). */
  heredado?: TransicionV | null;
  conGolpe?: boolean;
  formato: string;
  imgA?: string;
  imgB?: string;
  onElegir: (t: TransicionV | null) => void;
  onVolver?: () => void;
  deshabilitado?: boolean;
  titulo: string;
}) {
  const id = useId();
  const efectiva = valor ?? heredado ?? null;
  const elegida = claveTransicion(efectiva);
  const esHeredada = !valor && Boolean(heredado);
  const opciones = TRANSICIONES.filter((o) => conGolpe || o.clave !== "golpe");
  const dirs = efectiva ? DIRECCIONES[efectiva.tipo] : undefined;
  return (
    <div className="space-y-2">
      <EstilosGaleria />
      <span id={id} className="etiqueta">{titulo}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-2 overflow-x-auto pb-1">
        {opciones.map((o) => (
          <Tarjeta key={o.clave} opcion={o} elegida={elegida === o.clave} heredada={esHeredada && elegida === o.clave} deshabilitada={deshabilitado}
            onElegir={() => onElegir(o.valor ? { ...o.valor } : null)}>
            <MiniTransicion op={o} formato={formato} imgA={imgA} imgB={imgB} />
          </Tarjeta>
        ))}
      </div>
      {dirs && efectiva && (
        <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label="Dirección">
          <span className="mr-1 text-tenue">Dirección:</span>
          {dirs.map((d) => {
            const actual: Record<string, unknown> = { angulo: efectiva.tipo === "radial" ? 0 : 90, sentido: "horario", ...efectiva };
            const activa = Object.entries(d.cambio).every(([k, v]) => actual[k] === v);
            return (
              <button key={d.titulo} type="button" title={d.titulo} aria-label={d.titulo} aria-pressed={activa} disabled={deshabilitado}
                className={`h-8 w-8 rounded border text-base ${activa ? "border-acento bg-acento/10" : "border-borde hover:bg-white/5"}`}
                onClick={() => onElegir({ ...efectiva, ...d.cambio })}>{d.etiqueta}</button>
            );
          })}
        </div>
      )}
      <Ayuda opcion={TRANSICIONES.find((o) => o.clave === elegida)} heredada={esHeredada} onVolver={valor && onVolver ? onVolver : undefined} deshabilitado={deshabilitado} />
    </div>
  );
}

// ---------------------------------------------------------------- aspecto

const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

/** Miniatura con los efectos aplicados (filtros SVG con las mismas fórmulas; grano estático). */
function MiniAspecto({ efectos, formato, img }: { efectos: EfectoV[]; formato: string; img?: string }) {
  const fid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { w, h } = tamMini(formato);
  const prims: React.ReactNode[] = [];
  let entrada = "SourceGraphic";
  let blur = 0;
  const vinetas: { cantidad: number; angulo: number }[] = [];
  efectos.forEach((e, i) => {
    const out = `r${i}`;
    if (e.tipo === "tinte") {
      prims.push(<feColorMatrix key={i} in={entrada} type="matrix" values={matrizTinte(hex(e.negro, "#000000"), hex(e.blanco, "#ffffff"), num(e.cantidad, 1)).join(" ")} result={out} />);
    } else if (e.tipo === "niveles") {
      const n = { entradaNegro: num(e.entradaNegro, 0), entradaBlanco: num(e.entradaBlanco, 1), gamma: num(e.gamma, 1), salidaNegro: num(e.salidaNegro, 0), salidaBlanco: num(e.salidaBlanco, 1) };
      const tabla = Array.from({ length: 33 }, (_, j) => curvaNiveles(n, j / 32).toFixed(4)).join(" ");
      prims.push(
        <feComponentTransfer key={i} in={entrada} result={out}>
          <feFuncR type="table" tableValues={tabla} /><feFuncG type="table" tableValues={tabla} /><feFuncB type="table" tableValues={tabla} />
        </feComponentTransfer>,
      );
    } else if (e.tipo === "grano") {
      const c = num(e.cantidad, 0.12);
      prims.push(
        <feTurbulence key={`${i}t`} type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={num(e.semilla, 1)} result={`${out}n`} />,
        <feColorMatrix key={`${i}g`} in={`${out}n`} type="saturate" values="0" result={`${out}m`} />,
        <feComposite key={`${i}c`} in={entrada} in2={`${out}m`} operator="arithmetic" k1={0} k2={1} k3={c} k4={-c / 2} result={out} />,
      );
    } else if (e.tipo === "vineta") {
      vinetas.push({ cantidad: num(e.cantidad, 0.5), angulo: num(e.angulo, 60) });
      return;
    } else if (e.tipo === "desenfoque") {
      blur += num(e.radio, 8) * (w / 1080);
      return;
    } else return;
    entrada = out;
  });
  const filtro = [prims.length ? `url(#${fid})` : "", blur > 0 ? `blur(${blur.toFixed(2)}px)` : ""].filter(Boolean).join(" ");
  return (
    <span className="relative block overflow-hidden rounded bg-black" style={{ width: w, height: h }} aria-hidden>
      {prims.length > 0 && (
        <svg width="0" height="0" className="absolute">
          <filter id={fid} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">{prims}</filter>
        </svg>
      )}
      <span className="absolute inset-0" style={{ filter: filtro || undefined }}>
        <Fondo src={img} color="linear-gradient(160deg,#f97316,#0ea5e9 55%,#14532d)" />
      </span>
      {vinetas.map((vn, i) => (
        // Viñeta: multiplicar por k es tapar con negro de opacidad 1 − k.
        <span key={i} className="absolute inset-0" style={{
          background: `radial-gradient(circle farthest-corner at 50% 50%, ${Array.from({ length: 9 }, (_, j) => `rgb(0 0 0 / ${(1 - factorVineta(vn.cantidad, vn.angulo, j / 8)).toFixed(3)}) ${(j * 12.5).toFixed(1)}%`).join(", ")})`,
        }} />
      ))}
    </span>
  );
}

export function GaleriaAspectos({ valor, heredado, formato, img, onElegir, onVolver, deshabilitado, titulo }: {
  /** Efectos propios (null = hereda; [] = «Natural» como excepción). */
  valor: EfectoV[] | null;
  heredado?: EfectoV[] | null;
  formato: string;
  img?: string;
  onElegir: (efectos: EfectoV[]) => void;
  onVolver?: () => void;
  deshabilitado?: boolean;
  titulo: string;
}) {
  const id = useId();
  const efectiva = valor ?? heredado ?? [];
  const elegida = claveAspecto(efectiva);
  const esHeredada = valor === null && Boolean(heredado?.length);
  return (
    <div className="space-y-2">
      <span id={id} className="etiqueta">{titulo}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-2 overflow-x-auto pb-1">
        {ASPECTOS.map((o) => (
          <Tarjeta key={o.clave} opcion={o} elegida={elegida === o.clave} heredada={esHeredada && elegida === o.clave} deshabilitada={deshabilitado}
            onElegir={() => onElegir(o.valor)}>
            <MiniAspecto efectos={o.valor} formato={formato} img={img} />
          </Tarjeta>
        ))}
        {elegida === "personalizado" && (
          <Tarjeta opcion={{ clave: "personalizado", nombre: "Personalizado", ayuda: "Efectos puestos a mano o por Claude." }} elegida heredada={esHeredada} onElegir={() => undefined}>
            <MiniAspecto efectos={efectiva} formato={formato} img={img} />
          </Tarjeta>
        )}
      </div>
      <Ayuda opcion={ASPECTOS.find((o) => o.clave === elegida)} heredada={esHeredada} onVolver={valor !== null && onVolver ? onVolver : undefined} deshabilitado={deshabilitado} />
    </div>
  );
}

// ---------------------------------------------------------------- ritmo del movimiento

export function SelectorRitmo({ valor, heredado, onElegir, onVolver, deshabilitado, titulo }: {
  valor: string | null;
  heredado?: string | null;
  onElegir: (c: keyof typeof CURVAS) => void;
  onVolver?: () => void;
  deshabilitado?: boolean;
  titulo: string;
}) {
  const id = useId();
  const efectiva = valor ?? heredado ?? "lineal";
  const esHeredada = !valor && Boolean(heredado);
  return (
    <div className="space-y-2">
      <EstilosGaleria />
      <span id={id} className="etiqueta">{titulo}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {RITMOS.map((o) => {
          const pc = CURVAS[o.clave];
          return (
            <Tarjeta key={o.clave} opcion={o} elegida={efectiva === o.clave} heredada={esHeredada && efectiva === o.clave} deshabilitada={deshabilitado} onElegir={() => onElegir(o.clave)}>
              <span className="relative block h-3 w-[76px] rounded-full bg-white/10" aria-hidden>
                <span className="gx-punto absolute top-px h-2.5 w-2.5 rounded-full bg-acento"
                  style={{ left: 0, ["--gx-anim" as string]: "gx-punto", ["--gx-curva" as string]: pc ? `cubic-bezier(${pc.join(",")})` : "linear" } as React.CSSProperties} />
              </span>
            </Tarjeta>
          );
        })}
      </div>
      <Ayuda opcion={RITMOS.find((o) => o.clave === efectiva)} heredada={esHeredada} onVolver={valor && onVolver ? onVolver : undefined} deshabilitado={deshabilitado} />
    </div>
  );
}

// ---------------------------------------------------------------- mezcla de una superposición

export function SelectorMezcla({ fusion, onElegir, deshabilitado }: { fusion: Fusion | null; onElegir: (f: Fusion) => void; deshabilitado?: boolean }) {
  const id = useId();
  const actual = mezclaSimple(fusion ?? undefined);
  return (
    <div className="space-y-1">
      <span id={id} className="etiqueta">Cómo se mezcla con el video</span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1">
        {MEZCLAS.map((o) => (
          <button key={o.clave} type="button" role="radio" aria-checked={actual === o.clave} title={o.ayuda} disabled={deshabilitado}
            className={`rounded border px-2 py-1 text-xs ${actual === o.clave ? "border-acento bg-acento/10 text-white" : "border-borde hover:bg-white/5"}`}
            onClick={() => onElegir(MEZCLAS_SIMPLES[o.clave])}>{o.nombre}</button>
        ))}
        {actual === null && <span className="self-center text-xs text-tenue">(modo avanzado: {fusion})</span>}
      </div>
      <p className="text-xs text-tenue">{MEZCLAS.find((o) => o.clave === actual)?.ayuda}</p>
    </div>
  );
}
