/**
 * Todo lo del video como piezas sueltas en FilmCraft. El .otio genérico (otio.ts) sólo lleva clips de
 * medios: los textos van como marcadores y la marca, los subtítulos y la tarjeta final no viajan, porque
 * Resolve y Premiere no tienen cómo leerlos. FilmCraft sí: guarda sus gráficos en `metadata.filmcraft`
 * del mismo .otio (storytold/filmcraft v0.20.1, `crates/interchange/src/otio.rs`), así que para «Abrir en
 * FilmCraft» se agregan:
 *
 * - Cada texto superpuesto, cada subtítulo, la etiqueta de marca y la tarjeta final como un gráfico
 *   propio: un clip «Transparent Video» con capas de texto (`graphic_text`) y de forma (`graphic_shape`),
 *   editables en Essential Graphics. Van en pistas con nombre (Marca, Textos, Subtítulos, Tarjeta final).
 * - El encuadre de cada clip de video (Motion: posición y escala; `crates/edit/src/frame_size.rs`): las
 *   escenas cubren el cuadro como en el render, y el presentador queda en su burbuja con una máscara de
 *   círculo o rectángulo redondeado (`crates/project/src/mask.rs`), en su esquina.
 *
 * La voz, la música y los efectos de sonido ya van cada uno en su pista (otio.ts). Formato de los efectos:
 * `EffectInstance` de `crates/project/src/effect.rs`; si un campo no se puede leer, FilmCraft descarta en
 * silencio la lista entera del clip, por eso cada efecto lleva todos sus parámetros.
 *
 * Función pura: el servidor le pasa la plantilla y las zonas de caras (para la esquina «auto»).
 */
import { visibleDe, sigueCara } from "./caras";
import { textoSobre } from "./colores-marca";
import { aplicarEstilo, pistasLibres, type Asset, type Clip, type Proyecto, type Texto } from "./esquema";
import { ANCHO_CARACTER, caracteresPorLinea, metricas, type Caja, type Metricas } from "./formatos";
import { duracionEscenas, escenasEnLinea, intervalos, opcionesDe, todosLosGrupos } from "./linea";
import { cajaMarco } from "./marco";
import { resolverMarco, type Zona } from "./marco-auto";
import type { DatosPlantilla } from "./plantillas";
import { lineas } from "./subtitulos";

type J = Record<string, unknown>;
type RGBA = [number, number, number, number];

/** La fuente que FilmCraft web trae siempre (las del sistema no las ve en el navegador). */
export const FUENTE_FILMCRAFT = "Inter";

// ---- Colores CSS de la plantilla → RGBA 0..1 (sRGB, sin premultiplicar: lo que lee FilmCraft).
export function rgba(css: string): RGBA {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s)?.[1];
  if (hex) {
    const h = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => (h.length >= i + 2 ? parseInt(h.slice(i, i + 2), 16) / 255 : 1);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1].map(red) as RGBA;
  }
  const f = /^rgba?\(([^)]+)\)$/i.exec(s)?.[1];
  if (f) {
    const v = f.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (v.length >= 3 && v.every(Number.isFinite)) return [v[0]! / 255, v[1]! / 255, v[2]! / 255, v[3] ?? 1].map((x) => red(Math.min(1, Math.max(0, x)))) as RGBA;
  }
  return [1, 1, 1, 1];
}
function red(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

// ---- Parámetros (serde de `ParamValue`: enum etiquetado por fuera).
const F = (v: number) => ({ value: { Float: red(v) } });
const B = (v: boolean) => ({ value: { Bool: v } });
const T = (v: string) => ({ value: { Text: v } });
const C = (v: number) => ({ value: { Choice: v } });
const COL = (v: RGBA) => ({ value: { Color: v } });
/** `null` = automático (el centro del cuadro o de la fuente). */
const P = (x: number | null, y: number | null) => ({ value: { Vec2: { x: x === null ? null : red(x), y: y === null ? null : red(y) } } });

const efecto = (id: string, params: J, extra: J = {}): J => ({ effect: id, enabled: true, params, ...extra });

/**
 * Motion, Opacity y Time Remapping: los efectos que todo clip de video lleva (`intrinsic_video`).
 * `ancla`: el centro de la fuente, en sus píxeles. Va siempre explícito: el «automático» lo resuelve
 * FilmCraft con el tamaño que conoce al importar y, si el video todavía no se leyó, usa 1920×1080 y el
 * clip queda corrido (visto con el presentador, FilmCraft 0.20.1, 2026-11-22).
 */
function intrinsecos(o: { posicion?: [number, number] | null; ancla?: [number, number]; escala?: number; opacidad?: number; mascaras?: J[] } = {}): J[] {
  return [
    efecto("motion", {
      position: o.posicion ? P(o.posicion[0], o.posicion[1]) : P(null, null),
      scale: F(o.escala ?? 100), scale_width: F(100), uniform_scale: B(true), rotation: F(0),
      anchor: o.ancla ? P(o.ancla[0], o.ancla[1]) : P(null, null), anti_flicker: F(0),
    }),
    efecto("opacity", { opacity: F((o.opacidad ?? 1) * 100), blend: C(0) }, o.mascaras?.length ? { masks: o.mascaras } : {}),
    efecto("time_remap", { speed: F(100) }),
  ];
}

const APARIENCIA: J = {
  fill: B(true), fill_color: COL([1, 1, 1, 1]), fill_kind: C(0), gradient_start: COL([1, 1, 1, 1]), gradient_end: COL([0.15, 0.15, 0.15, 1]), gradient_angle: F(0),
  stroke: B(false), stroke_color: COL([0, 0, 0, 1]), stroke_width: F(4), stroke_type: C(0),
  stroke2: B(false), stroke2_color: COL([1, 0.85, 0.2, 1]), stroke2_width: F(10), stroke2_type: C(0),
  background: B(false), background_color: COL([0, 0, 0, 1]), background_opacity: F(75), background_size: F(12), background_radius: F(0),
  shadow: B(false), shadow_color: COL([0, 0, 0, 1]), shadow_opacity: F(75), shadow_angle: F(135), shadow_distance: F(10), shadow_size: F(0), shadow_blur: F(40),
};
const TRANSFORMACION = (x: number, y: number): J => ({
  position: P(x, y), anchor: P(0, 0), scale: F(100), scale_width: F(100), uniform_scale: B(true), rotation: F(0), opacity: F(100),
});

export interface EstiloTexto {
  relleno: RGBA | { de: RGBA; a: RGBA };
  fondo?: { color: RGBA; margen: number; radio: number };
  sombra?: boolean;
  mayusculas?: boolean;
  cursiva?: boolean;
  /** Espaciado entre letras, en milésimas de eme. */
  tracking?: number;
  /** Alto de línea sobre el cuerpo (el `line-height` del render; 1,15 si no se dice). */
  alto?: number;
}

/** Alto de línea natural de Inter (ascendente 0,969 + descendente 0,242): FilmCraft suma el interlineado a esto. */
const LINEA_INTER = 1.211;
const ASCENDENTE_INTER = 0.969;

/**
 * Una capa de texto de una o más líneas, centrada en `x`, con la primera línea arriba en `y` (texto de
 * punto: el origen es el punto de alineación de la primera línea base, `crates/text/README.md`).
 */
export function capaTexto(nombre: string, texto: string, x: number, y: number, fs: number, e: EstiloTexto, uid: number): J {
  const degradado = !Array.isArray(e.relleno);
  const alto = e.alto ?? 1.15;
  const relleno = e.relleno as RGBA;
  const grad = e.relleno as { de: RGBA; a: RGBA };
  return efecto("graphic_text", {
    name: T(nombre), text: T(texto), font: T(FUENTE_FILMCRAFT), font_style: T("Bold"), size: F(fs), align: C(1),
    tracking: F(e.tracking ?? 0), kerning: B(true), ligatures: B(true), leading: F((alto - LINEA_INTER) * fs), baseline_shift: F(0),
    faux_bold: B(false), faux_italic: B(!!e.cursiva), caps: C(e.mayusculas ? 1 : 0), underline: B(false), strikethrough: B(false),
    box_width: F(0), box_height: F(0), vertical: B(false),
    ...APARIENCIA,
    fill_color: COL(degradado ? grad.de : relleno), fill_kind: C(degradado ? 1 : 0),
    ...(degradado ? { gradient_start: COL(grad.de), gradient_end: COL(grad.a) } : {}),
    ...(e.fondo ? {
      background: B(true), background_color: COL([e.fondo.color[0], e.fondo.color[1], e.fondo.color[2], 1]),
      background_opacity: F(e.fondo.color[3] * 100), background_size: F(e.fondo.margen), background_radius: F(e.fondo.radio),
    } : {}),
    ...(e.sombra ? { shadow: B(true), shadow_opacity: F(65), shadow_angle: F(90), shadow_distance: F(4), shadow_blur: F(14) } : {}),
    // La línea base de la primera línea, como en CSS: medio interlineado + ascendente desde arriba.
    ...TRANSFORMACION(x, y + fs * ((alto - LINEA_INTER) / 2 + ASCENDENTE_INTER)),
  }, { layer: { uid } });
}

/** Un rectángulo de color (el fondo de la tarjeta final). */
export function capaRectangulo(nombre: string, caja: Caja, color: RGBA, uid: number): J {
  return efecto("graphic_shape", {
    name: T(nombre), shape: C(0), size: P(caja.w, caja.h), sides: F(6), corner_radius: F(0), points: { value: { Curve: [] } },
    ...APARIENCIA,
    fill_color: COL(color),
    ...TRANSFORMACION(caja.x + caja.w / 2, caja.y + caja.h / 2),
  }, { layer: { uid } });
}

const rt = (s: number, rate: number): J => ({ OTIO_SCHEMA: "RationalTime.1", rate, value: Math.round(s * rate * 1000) / 1000 });
const tr = (inicio: number, duracion: number, rate: number): J => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(inicio, rate), duration: rt(duracion, rate) });
const hueco = (duracion: number, rate: number): J => ({
  OTIO_SCHEMA: "Gap.1", name: "", source_range: tr(0, duracion, rate), effects: [], markers: [], enabled: true, metadata: {},
});

/** Ticks por segundo de FilmCraft (`filmcraft_time::TICKS_PER_SECOND`, los de Premiere). */
const TICKS = 254_016_000_000;

/**
 * `MediaInfo` del gráfico: sin esto FilmCraft lo crea de 1920×1080 y opaco, y en un 9:16 las capas quedan
 * corridas y recortadas (visto con FilmCraft 0.20.1 el 2026-11-22). Mismo formato que su `GeneratorSource`.
 */
const infoGrafico = (nombre: string, duracion: number, cuadro: Cuadro): J => ({
  name: nombre, kind: "Synthetic", duration: Math.round(duracion * TICKS),
  video: {
    width: cuadro.W, height: cuadro.H, frame_rate: { num: cuadro.fps, den: 1 }, par: [1, 1], codec: "Synthetic", pixel_format: "RGBA 8-bit",
    color: { matrix: "Bt709", transfer: "Srgb", primaries: "Bt709", range: "Full" }, has_alpha: true, bitrate: null,
  },
  audio_streams: [], container: "Synthetic", start_timecode: null, file_size: null,
});

interface Cuadro { W: number; H: number; fps: number }

/** Un gráfico: un clip «Transparent Video» con sus capas. `item` lo separa en el proyecto de FilmCraft. */
function grafico(nombre: string, duracion: number, capas: J[], cuadro: Cuadro, item: number): J {
  const rate = cuadro.fps;
  return {
    OTIO_SCHEMA: "Clip.2",
    name: nombre,
    source_range: tr(0, duracion, rate),
    effects: [],
    markers: [],
    enabled: true,
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: "GeneratorReference.1", name: nombre, generator_kind: "FilmCraftGenerator", parameters: {},
        available_range: tr(0, duracion, rate),
        metadata: { filmcraft: { item, generator: "TransparentVideo", info: infoGrafico(nombre, duracion, cuadro) } },
      },
    },
    active_media_reference_key: "DEFAULT_MEDIA",
    metadata: { filmcraft: { effects: [...intrinsecos(), ...capas] } },
  };
}

interface Pieza { nombre: string; inicio: number; duracion: number; capas: J[] }

/** Reparte piezas en pistas sin que se encimen en el tiempo (las que se pisan van a otra pista). */
function enPistas(nombre: string, piezas: Pieza[], cuadro: Cuadro, siguienteItem: () => number): J[] {
  const rate = cuadro.fps;
  const carriles: { fin: number; hijos: J[] }[] = [];
  for (const pz of [...piezas].sort((a, b) => a.inicio - b.inicio)) {
    let c = carriles.find((x) => x.fin <= pz.inicio + 1e-3);
    if (!c) carriles.push((c = { fin: 0, hijos: [] }));
    if (pz.inicio > c.fin + 1e-3) c.hijos.push(hueco(pz.inicio - c.fin, rate));
    c.hijos.push(grafico(pz.nombre, pz.duracion, pz.capas, cuadro, siguienteItem()));
    c.fin = Math.max(c.fin, pz.inicio) + pz.duracion;
  }
  return carriles.map((c, i) => ({
    OTIO_SCHEMA: "Track.1", name: carriles.length > 1 ? `${nombre} ${i + 1}` : nombre, kind: "Video",
    source_range: null, children: c.hijos, effects: [], markers: [], enabled: true, metadata: {},
  }));
}

/** Cuerpo de letra de un texto superpuesto (el mismo que el compilador). */
export function cuerpoTexto(t: Texto, m: Metricas): number {
  if (t.estilo === "titulo") return Math.round(m.tituloFs * 0.62);
  if (t.estilo === "cita") return Math.round(m.subsFs * 0.8);
  return Math.round(m.subsFs * 0.85);
}

/** Motion (y máscara) para que un clip se vea como en el render. null: no se sabe el tamaño del medio. */
export function encuadre(c: Clip, a: Asset, m: Metricas, marco: ReturnType<typeof resolverMarco> | null): J[] | null {
  if (!a.ancho || !a.alto) return null;
  const aw = a.ancho;
  const ah = a.alto;
  const opacidad = c.opacidad ?? 1;
  const ancla: [number, number] = [aw / 2, ah / 2];
  if (marco) {
    const caja = cajaMarco(marco, m);
    if (!caja.w || !caja.h) return null;
    if ((marco.forma as string) === "recorte") {
      // Sin fondo: entero dentro del recuadro, apoyado abajo.
      const s = Math.min(caja.w / aw, caja.h / ah);
      return intrinsecos({ posicion: [caja.x + caja.w / 2, caja.y + caja.h - (ah * s) / 2], ancla, escala: s * 100, opacidad });
    }
    const s = Math.max(caja.w / aw, caja.h / ah);
    const vx = caja.w / (aw * s);
    const vy = caja.h / (ah * s);
    // Igual que el compilador: sigue la cara si hay; si no, el tercio de arriba.
    const v = sigueCara(c, a) ? visibleDe({ ajuste: "cubrir" }, a, caja.w, caja.h) : null;
    const x0 = (v && !v.todo ? v.x : 0.5 * (1 - vx)) * aw;
    const y0 = (v && !v.todo ? v.y : 0.3 * (1 - vy)) * ah;
    const w = vx * aw;
    const h = vy * ah;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    const ruta = marco.forma === "circulo" ? elipse(cx, cy, w / 2, h / 2) : rectRedondeado(x0, y0, w, h, (caja.w * 0.12) / s);
    const mascara = {
      name: "Burbuja", path: { value: { Path: ruta } }, feather: F(1), opacity: F(100), expansion: F(0), inverted: false, mode: "Add",
    };
    return intrinsecos({
      posicion: [caja.x + caja.w / 2 + (aw / 2 - cx) * s, caja.y + caja.h / 2 + (ah / 2 - cy) * s], ancla, escala: s * 100, opacidad, mascaras: [mascara],
    });
  }
  const v = visibleDe(c, a, m.W, m.H);
  if (v.todo) return intrinsecos({ posicion: [m.W / 2, m.H / 2], ancla, escala: Math.min(m.W / aw, m.H / ah) * 100, opacidad });
  const s = m.W / (v.w * aw);
  const cx = (v.x + v.w / 2) * aw;
  const cy = (v.y + v.h / 2) * ah;
  return intrinsecos({ posicion: [m.W / 2 + (aw / 2 - cx) * s, m.H / 2 + (ah / 2 - cy) * s], ancla, escala: s * 100, opacidad });
}

const KAPPA = 0.5522847498307934;
const vtx = (x: number, y: number, tx = 0, ty = 0) =>
  tx || ty ? { p: { x: red(x), y: red(y) }, t_in: { x: red(-tx), y: red(-ty) }, t_out: { x: red(tx), y: red(ty) } } : { p: { x: red(x), y: red(y) } };
function elipse(cx: number, cy: number, rx: number, ry: number): J {
  const k = KAPPA;
  return { closed: true, vertices: [vtx(cx, cy - ry, rx * k, 0), vtx(cx + rx, cy, 0, ry * k), vtx(cx, cy + ry, -rx * k, 0), vtx(cx - rx, cy, 0, -ry * k)] };
}
function rectRedondeado(x: number, y: number, w: number, h: number, radio: number): J {
  const r = Math.max(0, Math.min(radio, w / 2, h / 2));
  const k = r * KAPPA;
  const v = (px: number, py: number, inx: number, iny: number, outx: number, outy: number) =>
    ({ p: { x: red(px), y: red(py) }, t_in: { x: red(inx), y: red(iny) }, t_out: { x: red(outx), y: red(outy) } });
  // En el sentido de las agujas del reloj (y hacia abajo), dos vértices por esquina.
  return {
    closed: true,
    vertices: [
      v(x + r, y, -k, 0, 0, 0), v(x + w - r, y, 0, 0, k, 0),
      v(x + w, y + r, 0, -k, 0, 0), v(x + w, y + h - r, 0, 0, 0, k),
      v(x + w - r, y + h, k, 0, 0, 0), v(x + r, y + h, 0, 0, -k, 0),
      v(x, y + h - r, 0, k, 0, 0), v(x, y + r, 0, 0, 0, -k),
    ],
  };
}

export interface CapasFilmcraft {
  otio: J;
  avisos: string[];
  /** Cuántos gráficos van (marca, textos, subtítulos y tarjeta final): la página espera verlos todos. */
  graficos: number;
}

/**
 * El .otio de `aOtio` con todo como piezas sueltas de FilmCraft. `zonas`: las caras de las escenas, para
 * resolver la esquina «auto» del presentador igual que el render. Devuelve una copia.
 */
export function capasFilmcraft(otioOriginal: J, original: Proyecto, plantilla: DatosPlantilla, zonas: Zona[] = []): CapasFilmcraft {
  const otio = structuredClone(otioOriginal);
  const p = aplicarEstilo(original);
  const m = metricas(p.formato, opcionesDe(p));
  const rate = p.fps;
  const avisos: string[] = [];
  const pilas = (otio.tracks as J).children as J[];

  // ---- Encuadre de cada clip de video (escenas y pistas libres).
  const visualDe = new Map(escenasEnLinea(p).map((e) => [e.escena.id, e.visual]));
  const libres = new Map(pistasLibres(p).flatMap((pi) => pi.clips.map((c) => [c.id, c] as const)));
  let sinTamano = 0;
  for (const pista of pilas) {
    if (pista.kind !== "Video") continue;
    for (const hijo of pista.children as J[]) {
      if (hijo.OTIO_SCHEMA !== "Clip.2") continue;
      const ref = (hijo.media_references as J).DEFAULT_MEDIA as J;
      const g = ((ref.metadata as J)?.geeper ?? {}) as { asset?: string };
      const a = g.asset ? p.assets[g.asset] : undefined;
      const meta = hijo.metadata as J;
      const escena = (meta.geeper as { escena?: string } | undefined)?.escena;
      const c = escena ? visualDe.get(escena) : libres.get(String(hijo.name));
      if (!a || !c) continue;
      // Un SVG pasado a PNG tiene otro tamaño que el asset: que FilmCraft lo ajuste al cuadro.
      const sustituido = typeof ref.target_url === "string" && /\.svg$/i.test(a.ruta) && !/\.svg$/i.test(ref.target_url);
      const marco = c.marco ? resolverMarco(c.marco, m, zonas) : null;
      const fx = sustituido ? null : encuadre(c, a, m, marco);
      const fc = ((meta.filmcraft as J | undefined) ?? {}) as J;
      if (fx) fc.effects = fx;
      else {
        fc.scale_to_frame = true;
        if (!sustituido) sinTamano++;
      }
      meta.filmcraft = fc;
    }
  }
  if (sinTamano) avisos.push(`${sinTamano} clip${sinTamano === 1 ? "" : "s"} sin tamaño conocido: se ajusta${sinTamano === 1 ? "" : "n"} al cuadro.`);

  // ---- Gráficos.
  let item = 900_000;
  let uid = 1;
  const nuevoItem = () => item++;
  const colores = plantilla.colores;
  const tinta = rgba(colores.tinta);
  const degradado = { de: rgba(colores.acento1), a: rgba(colores.acento2) };
  const S = m.segura;
  const centroX = S.x + S.w / 2;
  const centroY = S.y + S.h / 2;
  const inicioTarjeta = duracionEscenas(p);
  const chipH = m.marcaFs * 1.15 + 30;
  const pastilla = rgba(colores.fondoPastilla);

  const marca: Pieza[] = [];
  if (p.marca && plantilla.marca.texto.trim()) {
    marca.push({
      nombre: "Marca", inicio: 0, duracion: inicioTarjeta,
      capas: [capaTexto("Marca", plantilla.marca.texto, centroX, m.marcaTop + 14, m.marcaFs, {
        relleno: degradado, mayusculas: true, tracking: 60, fondo: { color: [0, 0, 0, 0.5], margen: 18, radio: chipH / 2 },
      }, uid++)],
    });
    if (plantilla.marca.logo) avisos.push("El logo de la marca no va: agrégalo en FilmCraft si lo quieres junto al nombre.");
  }

  const textos: Pieza[] = [];
  for (const t of p.textos) {
    if (t.inicio >= inicioTarjeta) continue;
    const fs = cuerpoTexto(t, m);
    const cpl = Math.max(4, Math.floor((S.w - 40 - 48) / (fs * ANCHO_CARACTER)));
    const ls = lineas(t.estilo === "titulo" ? t.texto.toUpperCase() : t.texto, cpl);
    const h = ls.length * fs * 1.15 + 32;
    const y = t.posicion === "arriba" ? m.marcaTop + (p.marca ? chipH : 0) + 24
      : t.posicion === "abajo" ? m.subs.y - h - 20
      : S.y + (S.h - h) / 2;
    const estilo: EstiloTexto = t.estilo === "titulo"
      ? { relleno: rgba(textoSobre([colores.acento1, colores.acento2], colores.tinta)), fondo: { color: degradado.de, margen: 20, radio: 18 }, mayusculas: true }
      : { relleno: tinta, fondo: { color: pastilla, margen: 20, radio: 18 }, cursiva: t.estilo === "cita" };
    textos.push({
      nombre: `Texto: ${t.texto.slice(0, 40)}`, inicio: t.inicio, duracion: Math.min(t.duracion, inicioTarjeta - t.inicio),
      capas: [capaTexto(t.texto.slice(0, 40), ls.join("\n"), centroX, y + 16, fs, estilo, uid++)],
    });
  }

  const subtitulos: Pieza[] = [];
  const grupos = todosLosGrupos(p);
  const cpl = caracteresPorLinea(p.formato, opcionesDe(p));
  intervalos(grupos, inicioTarjeta).forEach((iv, i) => {
    const g = grupos[i]!;
    const ls = lineas(g.texto.trim(), cpl);
    const alto = ls.length * m.subsFs * 1.12;
    if (iv.fin - iv.ini < 0.02) return;
    subtitulos.push({
      nombre: `Subtítulo ${i + 1}`, inicio: iv.ini, duracion: iv.fin - iv.ini,
      capas: [capaTexto(g.texto.trim().slice(0, 40), ls.join("\n"), m.subs.x + m.subs.w / 2, m.subs.y + (m.subs.h - alto) / 2, m.subsFs, {
        relleno: tinta, fondo: { color: pastilla, margen: 20, radio: 26 }, sombra: true, alto: 1.12,
      }, uid++)],
    });
  });

  const tarjeta: Pieza[] = [];
  const dt = plantilla.tarjetaFinal.duracion;
  if (dt > 0) {
    const tituloCpl = Math.max(4, Math.floor((S.w - 60) / (m.tituloFs * ANCHO_CARACTER)));
    const tl = lineas(plantilla.tarjetaFinal.titulo.toUpperCase(), tituloCpl);
    const cierreH = tl.length * m.tituloFs + 28 + m.ctaFs * 1.2 + 32;
    const arriba = centroY - cierreH / 2;
    const cta = p.cta ?? plantilla.cta;
    tarjeta.push({
      nombre: "Tarjeta final", inicio: inicioTarjeta, duracion: dt,
      capas: [
        capaRectangulo("Fondo", { x: 0, y: 0, w: m.W, h: m.H }, rgba(colores.fondoCierre), uid++),
        capaTexto("Título", tl.join("\n"), centroX, arriba, m.tituloFs, { relleno: degradado, mayusculas: true, alto: 1 }, uid++),
        capaTexto("Botón", cta, centroX, arriba + tl.length * m.tituloFs + 28 + 16, m.ctaFs, {
          relleno: rgba(textoSobre(colores.acento1, colores.tinta)), fondo: { color: degradado.de, margen: 20, radio: (m.ctaFs * 1.2 + 32) / 2 },
        }, uid++),
      ],
    });
  }

  // Encima de los medios, en el orden del render: marca, textos, subtítulos y la tarjeta final arriba de todo.
  const cuadro = { W: m.W, H: m.H, fps: rate };
  pilas.push(
    ...enPistas("Marca", marca, cuadro, nuevoItem),
    ...enPistas("Textos", textos, cuadro, nuevoItem),
    ...enPistas("Subtítulos", subtitulos, cuadro, nuevoItem),
    ...enPistas("Tarjeta final", tarjeta, cuadro, nuevoItem),
  );
  avisos.push(`Las letras van en ${FUENTE_FILMCRAFT} (la que trae FilmCraft); las animaciones de entrada y el resaltado palabra por palabra no viajan.`);
  return { otio, avisos, graficos: marca.length + textos.length + subtitulos.length + tarjeta.length };
}
