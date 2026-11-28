/**
 * Demo de producto desde una URL (flujo «Lanzamiento de producto», F4): reglas y composición.
 *
 * Idea de Cap (`apps/cli/skill/cap-demo`, AGPLv3: se reescribió, no se copió código). Allí se graba
 * una ventana de Chrome con el binario de Cap (sólo macOS) y se trata en su editor. Aquí:
 *  - la toma la hace `scripts/demo-web.ts` con Playwright headless y el screencast de CDP (sin
 *    permisos de pantalla, en Linux/WSL, con el cursor de la persona intacto),
 *  - el tratamiento es una composición de Hyperframes: tarjeta con perspectiva 3D apuntada a lo que
 *    importa (titular, botón, página siguiente), fondo con los colores de la marca, cursor dibujado
 *    desde el recorrido registrado y, en el estilo «plano», zoom en cada clic.
 *
 * Reglas editoriales de cap-demo que se mantienen: corta en la acción y quita la carga de la página;
 * un cambio de cámara sólo cuando cambia el contenido; un solo sistema de movimiento (en 3D no se
 * apilan zooms); 12 s como máximo; se apunta al contenido, no al contenedor.
 */

/** Lo que se puede decir en una demo: hasta ~45 s de voz (unas 110 palabras). */
export const MAX_CARACTERES_DEMO = 700;
/** Caracteres por segundo de Kokoro a velocidad 0,85 (medido 2026-11-20: 126 caracteres → ~11 s). */
export const CPS_VOZ = 11.5;

/** Lo que se escribió en «Desde una página web», para volver a Nuevo con todo puesto. */
export interface BorradorDemo {
  url: string;
  texto: string;
  formato: "16:9" | "9:16";
  estilo: "3d" | "plano";
  plantilla: string;
  propio: boolean;
}

/**
 * Enlace a Nuevo con lo que se escribió (UX-17): para el botón «Cambiar el link» de un video de
 * página web que falló antes de armarse. Lo arma quien tiene los datos del trabajo `demo.crear`.
 */
export function enlaceCambiarLink(b: Partial<BorradorDemo>): string {
  const q = new URLSearchParams({ modo: "web" });
  if (b.url) q.set("url", b.url);
  if (b.texto) q.set("texto", b.texto.slice(0, MAX_CARACTERES_DEMO));
  if (b.formato) q.set("formato", b.formato);
  if (b.estilo) q.set("estilo", b.estilo);
  if (b.plantilla) q.set("plantilla", b.plantilla);
  if (b.propio) q.set("propio", "1");
  return `/nuevo?${q.toString()}`;
}

/**
 * El enlace «Cambiar el link» de un trabajo `demo.crear` que falló (UX-17): el link, el texto, el
 * estilo y «es mío» salen del payload; la forma y el estilo del canal, del proyecto. Lo que no sea
 * válido se descarta (pasa por leerBorradorDemo).
 */
export function enlaceDeTrabajoDemo(payload: unknown, proyecto: { formato: string; plantilla: string } | null): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const q = new URLSearchParams();
  if (typeof p.url === "string") q.set("url", p.url);
  if (typeof p.texto === "string") q.set("texto", p.texto);
  if (typeof p.estilo === "string") q.set("estilo", p.estilo);
  if (p.propio === true) q.set("propio", "1");
  if (proyecto) {
    q.set("formato", proyecto.formato);
    q.set("plantilla", proyecto.plantilla);
  }
  return enlaceCambiarLink(leerBorradorDemo(q));
}

/** Lo que trae el enlace de enlaceCambiarLink (lo que no sea válido se ignora). */
export function leerBorradorDemo(q: Pick<URLSearchParams, "get">): Partial<BorradorDemo> {
  const b: Partial<BorradorDemo> = {};
  const url = q.get("url");
  if (url) b.url = url.slice(0, 2000);
  const texto = q.get("texto");
  if (texto) b.texto = texto.slice(0, MAX_CARACTERES_DEMO);
  const formato = q.get("formato");
  if (formato === "16:9" || formato === "9:16") b.formato = formato;
  const estilo = q.get("estilo");
  if (estilo === "3d" || estilo === "plano") b.estilo = estilo;
  const plantilla = q.get("plantilla");
  if (plantilla && /^[\w-]{1,80}$/.test(plantilla)) b.plantilla = plantilla;
  if (q.get("propio") === "1") b.propio = true;
  return b;
}

/** Segundos aproximados que dura decir `texto` (contador de la página Nuevo). */
export function segundosEstimados(texto: string): number {
  return Math.round((texto.replace(/\s+/g, " ").trim().length / CPS_VOZ) * 10) / 10;
}

export type Rgb = [number, number, number];
export type Historia = "clic" | "scroll";
export type FormatoDemo = "16:9" | "9:16";
export type EstiloDemo = "3d" | "plano";

export interface Caja {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Botón o enlace visible, tal como lo mide la página. */
export interface Candidato {
  texto: string;
  href: string | null;
  relleno: boolean;
  fondo: string;
  caja: Caja;
}

/** Marca de tiempo de la toma (s desde el primer fotograma); x, y en fracción de la ventana. */
export interface Evento {
  nombre: string;
  t: number;
  x?: number;
  y?: number;
}

export interface PuntoCursor {
  t: number;
  x: number;
  y: number;
}

export interface RegistroDemo {
  url: string;
  titulo: string;
  historia: Historia;
  formato: FormatoDemo;
  cta: string | null;
  acento: Rgb | null;
  fondoPagina: Rgb | null;
  eventos: Evento[];
  cursor: PuntoCursor[];
  /** Pulsaciones (s). */
  clics: number[];
  /** Duración del video de la toma (s). */
  duracion: number;
  ancho: number;
  alto: number;
}

// ---------------------------------------------------------------------------------------------------
// Elegir el botón

/** Llevan a contenido (cuentan la historia). */
export const PALABRAS_CONTENIDO =
  /c[oó]mo funciona|funciones|caracter[ií]sticas|producto|explora|descubre|conoce|ver m[aá]s|ver |mira|demo|aprende|cursos|eventos|nosotros|precios|planes|galer[ií]a|herramientas|documentaci[oó]n|docs|how it works|features|product|explore|browse|see|watch|learn|pricing|showcase|gallery|tools/i;
/** Llevan a un formulario o a un callejón sin salida (registro, login, agenda). */
export const PALABRAS_CONVERSION =
  /prueba|gratis|reg[ií]str|crea(r)? (tu )?cuenta|empieza|comienza|[uú]nete|reserva|agenda|descarga|inicia(r)? sesi[oó]n|entrar|ingresa|suscr[ií]b|contacto|cont[aá]ctanos|habla con|cotiza|solicita|try|free|sign ?up|register|get started|start now|join|book|download|log ?in|sign in|subscribe|contact|talk to|request a demo|get a demo/i;

/**
 * Puntaje de un candidato a «botón que abre la historia» (pesos de cap-demo, palabras en español e
 * inglés). Sólo se considera con 5 o más.
 */
export function puntuarCta(c: Candidato, pagina: { url: string; altoVentana: number }): number {
  const texto = c.texto.trim();
  let destino: URL | null = null;
  try {
    destino = c.href ? new URL(c.href, pagina.url) : null;
  } catch {
    destino = null;
  }
  const actual = new URL(pagina.url);
  let s = 0;
  if (PALABRAS_CONTENIDO.test(texto)) s += 3;
  if (c.relleno) s += 2;
  if (c.caja.width > 110) s += 1;
  if (c.caja.y > 120 && c.caja.y < pagina.altoVentana * 0.85) s += 2;
  const mismaPagina = !!destino && destino.host === actual.host && destino.pathname === actual.pathname;
  if (destino && destino.host === actual.host && !destino.hash && !mismaPagina) s += 2;
  // Cap resta 3, pero un enlace a la misma página sumaba igual 7: el clic no lleva a ningún lado.
  if (mismaPagina) s -= 6;
  if (PALABRAS_CONVERSION.test(texto)) s -= 5;
  // Cap resta 5; con eso un botón relleno «Ver el blog» todavía llegaba a 5. Aquí nunca abre la historia.
  if (destino && /\/(blog|changelog|careers|jobs|empleos|trabaja|news|noticias|prensa|press)(\/|$)/i.test(destino.pathname)) s -= 8;
  if (/↗|external|externo/i.test(texto)) s -= 3;
  return s;
}

export function elegirCta(candidatos: Candidato[], pagina: { url: string; altoVentana: number }): (Candidato & { puntaje: number }) | null {
  const ok = candidatos
    .filter((c) => c.texto.trim())
    .map((c) => ({ ...c, puntaje: puntuarCta(c, pagina) }))
    .filter((c) => c.puntaje >= 5)
    .sort((a, b) => b.puntaje - a.puntaje);
  return ok[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Fondo de marca

function aHls([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, l, s];
}

function deHls(h: number, l: number, s: number): Rgb {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as Rgb;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)) as Rgb;
}

/** Lleva un color a una luminosidad [lo, hi] y le pone un techo de saturación. */
function afinar(c: Rgb, lo: number, hi: number, techoSat = 0.75): Rgb {
  const [h, l, s] = aHls(c);
  return deHls(h, Math.min(Math.max(l, lo), hi), Math.min(s, techoSat));
}

export function hex(c: Rgb): string {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function leerHex(s: string): Rgb {
  const h = s.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Color inválido: ${s} (se espera RRGGBB)`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/**
 * Degradado de fondo con los colores de la página (reglas de cap-demo): acento oscurecido hacia el
 * fondo de la página; sin acento, una marca clara da un degradado claro suave y el resto, uno oscuro.
 * Ojo: en sitios con degradados o pasteles el color que da el navegador miente; por eso `--fondo`.
 */
export function gradienteMarca(acento: Rgb | null, fondo: Rgb | null): { desde: string; hasta: string } {
  if (acento && fondo) return { desde: hex(afinar(acento, 0.18, 0.42)), hasta: hex(afinar(fondo, 0.1, 0.3)) };
  if (acento) return { desde: hex(afinar(acento, 0.18, 0.42)), hasta: hex(afinar(acento, 0.08, 0.2)) };
  if (fondo && (fondo[0] + fondo[1] + fondo[2]) / 3 > 150)
    return { desde: hex(afinar(fondo, 0.86, 0.94, 0.25)), hasta: hex(afinar(fondo, 0.72, 0.82, 0.35)) };
  return { desde: "#26283a", hasta: "#10111a" };
}

/**
 * Color de marca: el primer botón relleno con color de verdad. Blanco, negro y grises no cuentan (en
 * cap.so el botón blanco daba un fondo gris apagado); cap-demo tomaba cualquiera.
 */
export function acentoDe(candidatos: Pick<Candidato, "relleno" | "fondo">[]): Rgb | null {
  for (const c of candidatos) {
    const rgb = c.relleno ? leerRgb(c.fondo) : null;
    if (!rgb) continue;
    const [, l, s] = aHls(rgb);
    if (s >= 0.25 && l > 0.12 && l < 0.9) return rgb;
  }
  return null;
}

export function leerRgb(css: string | null | undefined): Rgb | null {
  const m = css?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // transparente
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// ---------------------------------------------------------------------------------------------------
// Zoom por clics (estilo «plano»)

/**
 * Tramos de zoom a partir de los clics (reglas de `crates/project/src/auto_zoom.rs` de Cap): cada clic
 * abre [t − 0,3 s, t + 2,5 s]; se ignoran los del último segundo; terminan 0,8 s antes del final; dos
 * tramos a 2,5 s o menos se juntan; nada de menos de 0,1 s.
 */
export function rangosZoomPorClics(clics: number[], duracion: number): [number, number][] {
  if (!(duracion > 0)) return [];
  const techo = duracion - 0.8;
  const r = clics
    .filter((t) => t >= 0 && t < duracion - 1)
    .map((t) => [Math.max(0.001, t - 0.3), Math.min(techo, t + 2.5)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of r) {
    const u = out[out.length - 1];
    if (u && a - u[1] <= 2.5) u[1] = Math.max(u[1], b);
    else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a >= 0.1);
}

/**
 * Fotogramas por segundo reales de una captura de cuadro variable: la moda de los fps instantáneos
 * (la media la tiran abajo las pausas largas al navegar). Idea de cap-demo `treat.py`.
 */
export function fpsDominante(tiempos: number[]): number | null {
  const cuenta = new Map<number, number>();
  for (let i = 1; i < tiempos.length; i++) {
    const d = tiempos[i]! - tiempos[i - 1]!;
    if (d > 1e-6) {
      const f = Math.round(1 / d);
      cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
    }
  }
  let mejor: number | null = null;
  let n = 0;
  for (const [f, c] of cuenta) if (c > n || (c === n && f > (mejor ?? 0))) [mejor, n] = [f, c];
  return mejor === null ? null : Math.max(2, Math.min(60, mejor));
}

// ---------------------------------------------------------------------------------------------------
// Montaje: cortes y tomas

export interface Pose {
  /** Grados. */
  rx: number;
  ry: number;
  rz: number;
  escala: number;
  /** Punto de la página (fracción) al que se apunta. */
  mira: [number, number];
}

export interface Toma {
  inicio: number;
  fin: number;
  desde: Pose;
  hasta: Pose;
}

export interface Montaje {
  /** Tramos de la toma [inicio, fin) en segundos de la grabación, en orden. */
  cortes: [number, number][];
  total: number;
  tomas: Toma[];
  /** Tramos de zoom (segundos del video final), sólo en estilo «plano». */
  zooms: { inicio: number; fin: number; mira: [number, number] }[];
}

const ev = (r: RegistroDemo, nombre: string) => r.eventos.find((e) => e.nombre === nombre);
const fr = (r: RegistroDemo, nombre: string, def: [number, number]): [number, number] => {
  const e = ev(r, nombre);
  return e && e.x !== undefined && e.y !== undefined ? [e.x, e.y] : def;
};

/** Pasa un tiempo de la grabación al video final (null si cae en un tramo quitado). */
export function aSalida(cortes: [number, number][], t: number): number | null {
  let base = 0;
  for (const [a, b] of cortes) {
    if (t >= a && t < b) return base + (t - a);
    base += b - a;
  }
  return null;
}

/**
 * Corta en la acción y quita la carga: en «clic», del principio a 0,4 s después del clic y de la página
 * ya cargada al final; en «scroll», hasta que empieza el primer desplazamiento y de ahí (ya en la sección
 * siguiente) al final. La cola se recorta para no pasar de `maximo` s. Cada corte de contenido es un
 * cambio de cámara; la última toma (acercamiento) empieza cuando entra contenido nuevo.
 */
export function planDemo(r: RegistroDemo, estilo: EstiloDemo = "3d", maximo = 12): Montaje {
  const D = r.duracion;
  const t = (n: string, def: number) => Math.min(D, Math.max(0, ev(r, n)?.t ?? def));
  const fijar = (a: number, b: number): [number, number] => {
    const ini = Math.max(0, Math.min(a, D - 0.4));
    return [ini, Math.max(ini + 0.4, Math.min(b, D))];
  };
  const heroe = fr(r, "heroe", [0.5, 0.4]);
  let cta = heroe;
  let pag2: [number, number] = [0.5, 0.45];
  let A: [number, number];
  let B: [number, number];
  if (r.historia === "clic") {
    cta = fr(r, "cta", [0.5, 0.6]);
    pag2 = fr(r, "pagina2", [0.42, 0.45]);
    const clic = t("clic", D * 0.35);
    const listo = t("listo", clic + 1);
    A = fijar(0.25, Math.min(clic + 0.4, listo - 0.1));
    B = fijar(listo + 0.3, D - 0.05);
  } else {
    const s1 = t("scroll1", D * 0.3);
    A = fijar(0.25, s1 + 0.9);
    B = fijar(s1 + 1.1, D - 0.05);
  }
  if (B[0] < A[1]) B = fijar(A[1], B[1]);
  // Se recorta la cola de B; si el primer tramo solo ya se pasa (clic tardío, página lenta), se le
  // quita el principio y se conserva lo que lleva al clic.
  if (A[1] - A[0] + (B[1] - B[0]) > maximo) B = [B[0], Math.max(B[0] + 0.4, B[1] - (A[1] - A[0] + (B[1] - B[0]) - maximo))];
  if (A[1] - A[0] + (B[1] - B[0]) > maximo) A = [A[1] - (maximo - (B[1] - B[0])), A[1]];
  const largoA = A[1] - A[0];
  const total = largoA + (B[1] - B[0]);
  const cortes: [number, number][] = [A, B];

  // Inicio de la última toma: cuando el segundo desplazamiento trae contenido nuevo.
  const scrollSalida = aSalida(cortes, t("scroll2", B[0] + (B[1] - B[0]) * 0.4)) ?? largoA + (B[1] - B[0]) * 0.4;
  const libre = total - largoA;
  const b2 =
    libre >= 3.4
      ? Math.min(Math.max(scrollSalida + 0.45, largoA + 1.2), total - 2.2)
      : Math.min(Math.max(scrollSalida + 0.45, largoA + libre * 0.25), total - libre * 0.25);

  const centro: [number, number] = [0.5, 0.45];
  const tomas: Toma[] =
    estilo === "3d"
      ? [
          { inicio: 0, fin: largoA, desde: { rx: 16, ry: -18, rz: 1, escala: 0.98, mira: heroe }, hasta: { rx: 16, ry: -22, rz: 1, escala: 1.1, mira: cta } },
          { inicio: largoA, fin: b2, desde: { rx: 20, ry: 16, rz: -1, escala: 1.0, mira: pag2 }, hasta: { rx: 24, ry: 10, rz: -1, escala: 1.06, mira: pag2 } },
          { inicio: b2, fin: total, desde: { rx: 9, ry: 0, rz: 0, escala: 0.96, mira: centro }, hasta: { rx: 7, ry: 0, rz: 0, escala: 1.16, mira: centro } },
        ]
      : [{ inicio: 0, fin: total, desde: { rx: 0, ry: 0, rz: 0, escala: 1, mira: centro }, hasta: { rx: 0, ry: 0, rz: 0, escala: 1, mira: centro } }];

  // Plano: zoom en cada clic, apuntado a donde estaba el cursor. En 3D el acercamiento ya es el golpe.
  const zooms: Montaje["zooms"] = [];
  if (estilo === "plano") {
    const clicsSalida = r.clics.map((c) => aSalida(cortes, c)).filter((x): x is number => x !== null);
    for (const [a, b] of rangosZoomPorClics(clicsSalida, total)) {
      const tc = clicsSalida.find((c) => c >= a && c <= b) ?? a;
      zooms.push({ inicio: a, fin: b, mira: cursorEn(r, cortes, tc) ?? centro });
    }
  }
  return { cortes, total, tomas, zooms };
}

/** Posición del cursor (fracción) en un momento del video final. */
function cursorEn(r: RegistroDemo, cortes: [number, number][], tSalida: number): [number, number] | null {
  let mejor: PuntoCursor | null = null;
  for (const p of r.cursor) {
    const s = aSalida(cortes, p.t);
    if (s !== null && s <= tSalida) mejor = p;
  }
  return mejor ? [mejor.x, mejor.y] : null;
}

// ---------------------------------------------------------------------------------------------------
// Composición de Hyperframes

export interface OpcionesComposicion {
  registro: RegistroDemo;
  montaje: Montaje;
  /** Ruta del video de la toma dentro del proyecto Hyperframes (p. ej. assets/toma.mp4). */
  video: string;
  fondo: { desde: string; hasta: string };
  fps?: number;
  /** `src` del script de GSAP: la copia local dentro del proyecto (gsap-local.ts), sin internet. */
  gsap: string;
}

const f3 = (n: number) => n.toFixed(3);

/**
 * Medidas de salida y de la tarjeta: 16:9 → 1920×1080; 9:16 (toma de móvil) → 1080×1920. La tarjeta
 * ocupa como mucho el 80 % del ancho y el 80 % del alto (zona segura de acción).
 */
export function medidas(r: Pick<RegistroDemo, "formato" | "ancho" | "alto">) {
  const [W, H] = r.formato === "9:16" ? [1080, 1920] : [1920, 1080];
  const k = Math.min((W * 0.8) / r.ancho, (H * 0.8) / r.alto);
  const w = Math.round(r.ancho * k);
  const h = Math.round(r.alto * k);
  return { W, H, w, h, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) };
}

/** Traslado para que el punto mirado quede cerca del centro (60 %: la tarjeta no se va del cuadro). */
function pose(p: Pose, w: number, h: number) {
  const k = 0.6 * p.escala;
  return {
    rotationX: p.rx,
    rotationY: p.ry,
    rotation: p.rz,
    scale: p.escala,
    x: Math.round(-(p.mira[0] - 0.5) * w * k),
    y: Math.round(-(p.mira[1] - 0.5) * h * k),
  };
}

export function componerDemo(o: OpcionesComposicion): string {
  const { registro: r, montaje: m } = o;
  const { W, H, w, h, x, y } = medidas(r);
  const movil = r.formato === "9:16";
  let base = 0;
  const videos = m.cortes
    .map(([a, b], i) => {
      const html = `        <video id="toma${i + 1}" class="clip toma" src="${o.video}" data-start="${f3(base)}" data-duration="${f3(b - a)}" data-media-start="${f3(a)}" data-track-index="${i + 1}" muted playsinline></video>`;
      base += b - a;
      return html;
    })
    .join("\n");

  // Cursor: muestras cada ~50 ms dentro de los tramos que quedan.
  const pasos: { t: number; x: number; y: number }[] = [];
  for (const p of r.cursor) {
    const s = aSalida(m.cortes, p.t);
    if (s === null) continue;
    const u = pasos[pasos.length - 1];
    if (!u || s - u.t >= 0.05) pasos.push({ t: +s.toFixed(3), x: +(p.x * w).toFixed(1), y: +(p.y * h).toFixed(1) });
  }
  const clics = r.clics
    .map((c) => aSalida(m.cortes, c))
    .filter((c): c is number => c !== null)
    .map((c) => {
      const p = [...pasos].reverse().find((q) => q.t <= c) ?? pasos[0];
      return { t: +c.toFixed(3), x: p?.x ?? w / 2, y: p?.y ?? h / 2 };
    });
  const tomas = m.tomas.map((t) => ({ t: +t.inicio.toFixed(3), d: +(t.fin - t.inicio).toFixed(3), de: pose(t.desde, w, h), a: pose(t.hasta, w, h) }));
  const zooms = m.zooms.map((z) => ({ t: +z.inicio.toFixed(3), d: +(z.fin - z.inicio).toFixed(3), ...pose({ rx: 0, ry: 0, rz: 0, escala: 1.8, mira: z.mira }, w, h) }));

  // Flecha propia (no los cursores de macOS de Cap); en móvil, un toque translúcido.
  const cursor = movil
    ? `<div class="toque"></div>`
    : `<svg width="34" height="40" viewBox="0 0 17 20" aria-hidden="true"><path d="M1 1 L1 16 L5 12.4 L7.8 19 L10.4 17.9 L7.7 11.6 L13 11.6 Z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

  return `<!doctype html>
<html lang="es" data-resolution="${movil ? "portrait" : "landscape"}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <!-- Generado por Geeper (demo-web.ts): no editar a mano. -->
    <script src="${o.gsap}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${o.fondo.hasta}; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden;
              background: radial-gradient(120% 90% at 20% 10%, rgba(255,255,255,0.10), transparent 60%), linear-gradient(135deg, ${o.fondo.desde}, ${o.fondo.hasta});
              perspective: ${movil ? 2600 : 2200}px; }
      #tarjeta { position: absolute; left: ${x}px; top: ${y}px; width: ${w}px; height: ${h}px; border-radius: ${movil ? 44 : 18}px; overflow: hidden;
                 box-shadow: 0 50px 140px rgba(0,0,0,0.45), 0 12px 30px rgba(0,0,0,0.25); background: #000; transform-style: preserve-3d; }
      .toma { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      #cursor { position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35)); }
      .toque { width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%; background: rgba(255,255,255,0.45); border: 3px solid rgba(0,0,0,0.25); }
      #pulso { position: absolute; left: 0; top: 0; width: 70px; height: 70px; margin: -35px 0 0 -35px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.9); opacity: 0; z-index: 4; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${f3(m.total)}" data-width="${W}" data-height="${H}">
      <div id="tarjeta">
${videos}
        <div id="pulso"></div>
        <div id="cursor">${cursor}</div>
      </div>
    </div>
    <script>
      const TOMAS = ${JSON.stringify(tomas)};
      const ZOOMS = ${JSON.stringify(zooms)};
      const CURSOR = ${JSON.stringify(pasos)};
      const CLICS = ${JSON.stringify(clics)};
      const tl = gsap.timeline({ paused: true });
      // Cámara: cada toma es un corte duro (cambio de contenido) y un movimiento suave dentro.
      // Estados iniciales fuera de la línea de tiempo: un tl.set en 0 no se pinta en el fotograma 0.
      if (TOMAS.length) gsap.set("#tarjeta", TOMAS[0].de);
      if (CURSOR.length) gsap.set("#cursor", { x: CURSOR[0].x, y: CURSOR[0].y });
      else gsap.set("#cursor", { opacity: 0 });
      TOMAS.forEach((s, i) => {
        if (i > 0) tl.set("#tarjeta", s.de, s.t);
        tl.to("#tarjeta", Object.assign({}, s.a, { duration: s.d, ease: "sine.inOut" }), s.t);
      });
      // Estilo plano: zoom hacia el cursor en cada clic (entra y sale en 0,5 s).
      ZOOMS.forEach((z) => {
        const ida = Math.min(0.5, z.d / 3);
        tl.to("#tarjeta", { scale: z.scale, x: z.x, y: z.y, duration: ida, ease: "power2.inOut" }, z.t);
        tl.to("#tarjeta", { scale: 1, x: 0, y: 0, duration: ida, ease: "power2.inOut" }, z.t + z.d - ida);
      });
      for (let i = 1; i < CURSOR.length; i++) {
        const a = CURSOR[i - 1], b = CURSOR[i];
        tl.to("#cursor", { x: b.x, y: b.y, duration: Math.max(0.001, b.t - a.t), ease: "none" }, a.t);
      }
      CLICS.forEach((c) => {
        tl.to("#cursor", { scale: 0.82, duration: 0.07, ease: "power2.out" }, c.t);
        tl.to("#cursor", { scale: 1, duration: 0.12, ease: "power2.in" }, c.t + 0.07);
        tl.fromTo("#pulso", { x: c.x, y: c.y, scale: 0.3, opacity: 0.9 },
          { x: c.x, y: c.y, scale: 1.6, opacity: 0, duration: 0.45, ease: "power2.out", immediateRender: false }, c.t);
      });
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

/** Lo que se mide de la página en el navegador antes de grabar. */
export interface SaludPagina {
  /** Código HTTP de la página principal en el navegador (null si no hubo respuesta, p. ej. una página local). */
  estado: number | null;
  /** Caracteres de texto visible. */
  texto: number;
  /** Imágenes, videos, lienzos y dibujos SVG visibles y cargados. */
  medios: number;
  /** Imágenes visibles que no cargaron. */
  rotas: number;
}

/**
 * ¿Vale la pena grabar esta página? (Idea de la verificación de sitios de storytold/craft-anything,
 * `website.rs` `health_notes` y `screenshot.rs` `is_blank`: una página de error o en blanco no se
 * compara ni se graba.) `probarLink` tolera un error porque muchos sitios rechazan a los robots y el
 * navegador entra igual; si el navegador también recibe un error, lo que se ve es la página de error y
 * la demo no sirve. Devuelve el mensaje para la persona si no se puede grabar, y avisos para el registro.
 */
export function revisarPagina(s: SaludPagina): { error: string | null; avisos: string[] } {
  const avisos: string[] = [];
  if (s.rotas > 0) avisos.push(`Aviso: ${s.rotas === 1 ? "una imagen de la página no cargó" : `${s.rotas} imágenes de la página no cargaron`}; se verán vacías en la demo.`);
  let error: string | null = null;
  if (s.estado !== null && s.estado >= 400) {
    if (s.estado === 404 || s.estado === 410) error = "Esa página no existe: el sitio dice que no la encuentra. Revisa el link.";
    else if (s.estado === 401 || s.estado === 403 || s.estado === 429)
      error = "La página no dejó entrar al grabador (algunos sitios bloquean a los programas automáticos). Prueba con otra página de tu sitio.";
    else if (s.estado >= 500) error = "La página tiene un problema en este momento. Prueba de nuevo en un rato.";
    else error = "La página respondió con un error y no muestra su contenido. Revisa que abra bien en tu navegador.";
  } else if (s.texto < 20 && s.medios === 0) {
    error = "La página abrió en blanco: no hay nada que mostrar en la demo. Revisa que abra bien en tu navegador.";
  }
  return { error, avisos };
}
