/**
 * Compuerta de control de calidad. Mide el archivo entregado y devuelve un informe JSON; si una
 * regla falla, el render no se marca entregado.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { CajaRevisada } from "./compilador";
import type { Ampliacion } from "./nitidez";
import { MAX_DUDOSAS, type ResumenConfianza } from "./confianza";
import type { Formato, Plataforma } from "./esquema";
import { caracteresPorLinea, metricas } from "./formatos";
import { usoComercial } from "./licencias";
import { intervalos, type Grupo } from "./linea";
import { ffmpeg, fotograma, probar } from "./media";
import { correr, type Registro } from "./proceso";
import type { Ritmo } from "./pulsos";
import { FFMPEG, FFPROBE } from "./rutas";
import { lineas } from "./subtitulos";

export const OBJETIVO = {
  lufs: -14,
  toleranciaLufs: 1,
  picoMaxDbtp: -1,
  maxCaracteresLinea: 42,
  maxLineas: 2,
  maxCps: 17,
  fps: 30,
  /** Congelado máximo antes de la tarjeta final (s). */
  maxCongelado: 1.0,
  maxDuplicados: 0.1,
} as const;

export interface Regla {
  id: string;
  nombre: string;
  ok: boolean;
  /** Los avisos no bloquean la entrega. */
  aviso?: boolean;
  medido: unknown;
  objetivo: string;
  detalle?: string;
}

export interface InformeQc {
  aprobado: boolean;
  archivo: string;
  medidoEn: string;
  reglas: Regla[];
  hojaContacto?: string;
  fotogramas: { t: number; ruta: string; nota: string }[];
  /** Máster de archivo (si el proyecto lo pide): ProRes/MOV del mismo render. */
  master?: string;
}

export interface Esperado {
  formato: Formato;
  fps?: number;
  plataformas?: readonly Plataforma[];
  total: number;
  inicioTarjeta: number;
  grupos: Grupo[];
  cajas: CajaRevisada[];
  /** Momentos clave (medio de cada escena) para la hoja de contacto. */
  momentos: { t: number; nota: string }[];
  licencias: { asset: string; licencia: string }[];
  /** Uso comercial: las licencias dudosas bloquean en vez de avisar. */
  comercial?: boolean;
  /** Confianza de la alineación de la voz (sin medir en proyectos viejos). */
  confianza?: ResumenConfianza;
  /** Cortes en pulso de la música (null: la música no tiene pulso estable o no hay música). */
  ritmo?: Ritmo | null;
  /** Ampliación de cada clip raster en la salida (`ampliaciones()` de nitidez.ts). */
  ampliaciones?: Ampliacion[];
  check?: { ok: boolean; errores: number; avisos: number; resumen: string };
  /**
   * Clips de material ajeno: la voz es del creador y no se puede hacer más lenta, así que pasarse de
   * car./s sólo avisa (DECISIONES §21). El largo de línea y el número de líneas siguen bloqueando.
   */
  ritmoSubtitulosAviso?: boolean;
  /** Reglas propias del proyecto (p. ej. la de clips de material ajeno). */
  extras?: Regla[];
  /**
   * Proporción de fotogramas repetidos que el material ya trae (fuentes de menos fps que la salida,
   * imágenes fijas sin movimiento): se suma al tope de duplicados. Ver `duplicadosEsperados`.
   */
  duplicadosEsperados?: number;
  /**
   * Clips de material ajeno: la proporción de cuadros repetidos sólo avisa; sigue bloqueando un
   * congelado de 1 s o más (`reglasDuplicados`).
   */
  duplicadosAviso?: boolean;
}

/**
 * Cuántos fotogramas repetidos son de esperar antes de la tarjeta: un video de 15 fps en una salida
 * de 30 repite 1 de cada 2 (0,5 de su tramo); una imagen fija sin movimiento repite todos. Ponderado
 * por la duración de cada escena.
 */
export function duplicadosEsperados(escenas: { dur: number; fpsFuente?: number; fija?: boolean }[], fps: number): number {
  const total = escenas.reduce((s, e) => s + e.dur, 0);
  if (!total) return 0;
  const repetidos = escenas.reduce((s, e) => s + e.dur * (e.fija ? 1 : e.fpsFuente && e.fpsFuente < fps ? 1 - e.fpsFuente / fps : 0), 0);
  return Math.min(1, repetidos / total);
}

export interface Sonoridad {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** Mide con loudnorm (primera pasada); devuelve los valores medidos. */
export async function medirSonoridad(archivo: string, log?: Registro): Promise<Sonoridad> {
  const r = await correr(FFMPEG, [
    "-hide_banner", "-nostdin", "-i", archivo, "-vn",
    "-af", `loudnorm=I=${OBJETIVO.lufs}:TP=-2:LRA=11:print_format=json`, "-f", "null", "-",
  ], { log: undefined });
  const j = /\{[\s\S]*?"target_offset"[\s\S]*?\}/.exec(r.stderr)?.[0];
  if (!j) throw new Error("loudnorm no devolvió medidas");
  const m = JSON.parse(j) as Sonoridad;
  log?.(`sonoridad: ${m.input_i} LUFS, pico ${m.input_tp} dBTP`);
  return m;
}

/**
 * Codificación de entrega. El render de Hyperframes sale a calidad «delivery» (~16 Mbps, perfil Main) y
 * se usa como máster; lo publicable se recodifica con libx264 High CRF 20: medido sobre un short de 57 s,
 * 115 MB → 31 MB con SSIM 0,992 frente al máster (imperceptible), en ~15 s de CPU. Keyframe cada 2 s
 * (lo que piden YouTube/TikTok/Instagram), tope de 12 Mbps para que ninguna escena dispare el peso, y
 * etiquetas Rec.709 explícitas porque el QC las exige.
 */
export const ENTREGA = {
  crf: 20,
  preset: "slow",
  gopSegundos: 2,
  maxrate: "12M",
  bufsize: "24M",
  audioKbps: 192,
} as const;

/**
 * Segunda pasada de loudnorm (lineal, con las medidas de la primera) a −14 LUFS / −2 dBTP y, en la
 * misma pasada, la codificación de entrega del video (ver ENTREGA).
 */
export async function normalizarAudio(entrada: string, salida: string, log: Registro, fps: number = OBJETIVO.fps): Promise<Sonoridad> {
  const m = await medirSonoridad(entrada, log);
  await ffmpeg([
    "-v", "error", "-i", entrada, "-map", "0:v:0", "-map", "0:a:0",
    "-c:v", "libx264", "-preset", ENTREGA.preset, "-crf", String(ENTREGA.crf), "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-g", String(ENTREGA.gopSegundos * fps), "-fps_mode", "passthrough",
    "-maxrate", ENTREGA.maxrate, "-bufsize", ENTREGA.bufsize,
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    "-af",
    `loudnorm=I=${OBJETIVO.lufs}:TP=-2:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
    // -aac_pns 0: el AAC nativo convierte pasajes suaves en chasquidos con PNS (truco de explainroo).
    "-c:a", "aac", "-b:a", `${ENTREGA.audioKbps}k`, "-aac_pns", "0", "-ar", "48000",
    "-movflags", "+faststart", "-f", "mp4", salida,
  ], log);
  return m;
}

/** Topes del limitador en cada reintento de pico real (dBTP), del más suave al más firme. */
export const TOPES_PICO = [-1.5, -1.8, -2.1, -2.4] as const;

/**
 * Pico real tras codificar (HEREDADO.md §2, de explainroo `src/ffmpeg.js:96-150`): el AAC sube el pico
 * unas décimas por encima de lo que dejó loudnorm. Si el archivo final pasa de −1 dBTP, se limita el
 * audio a 192 kHz (el limitador ve los picos entre muestras) y se recodifica sólo el audio, hasta 4
 * veces con un tope cada vez más bajo. El video se copia sin tocar.
 */
export async function asegurarPicoReal(archivo: string, log: Registro): Promise<{ tp: number; intentos: number }> {
  let tp = Number((await medirSonoridad(archivo)).input_tp);
  let intentos = 0;
  for (const tope of TOPES_PICO) {
    if (tp <= OBJETIVO.picoMaxDbtp) break;
    intentos++;
    const tmp = `${archivo}.pico.mp4`;
    const lineal = Math.pow(10, tope / 20).toFixed(4);
    await ffmpeg([
      "-v", "error", "-y", "-i", archivo, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
      "-af", `aresample=192000,alimiter=limit=${lineal}:attack=1:release=50:level=disabled,aresample=48000`,
      "-c:a", "aac", "-b:a", `${ENTREGA.audioKbps}k`, "-aac_pns", "0", "-ar", "48000",
      "-movflags", "+faststart", "-f", "mp4", tmp,
    ], log);
    await fs.rename(tmp, archivo);
    const antes = tp;
    tp = Number((await medirSonoridad(archivo)).input_tp);
    log(`pico real ${antes.toFixed(2)} → ${tp.toFixed(2)} dBTP (limitador a ${tope} dBTP)`);
  }
  return { tp, intentos };
}

async function congelados(archivo: string, hasta: number): Promise<{ inicio: number; dur: number }[]> {
  const r = await correr(FFMPEG, [
    "-hide_banner", "-nostdin", "-t", hasta.toFixed(3), "-i", archivo, "-an",
    "-vf", "freezedetect=n=-60dB:d=0.5", "-f", "null", "-",
  ]);
  const out: { inicio: number; dur: number }[] = [];
  const re = /freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g;
  for (let m = re.exec(r.stderr); m; m = re.exec(r.stderr)) out.push({ inicio: Number(m[1]), dur: Number(m[2]) });
  return out;
}

async function duplicados(archivo: string, hasta: number, fps: number): Promise<{ entrada: number; salida: number }> {
  const r = await correr(FFMPEG, [
    "-hide_banner", "-nostdin", "-t", hasta.toFixed(3), "-i", archivo, "-an",
    "-vf", "mpdecimate", "-fps_mode", "vfr", "-f", "null", "-",
  ]);
  const salida = Number([...r.stderr.matchAll(/frame=\s*(\d+)/g)].pop()?.[1] ?? 0);
  return { entrada: Math.round(hasta * fps), salida };
}

export async function contarFotogramas(archivo: string): Promise<number> {
  const r = await correr(FFPROBE, ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", archivo]);
  return Number(r.stdout.trim());
}

/** Visualización de cada grupo: el mismo intervalo que usa la animación del compilador. */
export function intervalosSubtitulos(grupos: Grupo[], finSubs: number) {
  const iv = intervalos(grupos, finSubs);
  return grupos.map((g, i) => ({ texto: g.texto, ini: iv[i]!.ini, fin: iv[i]!.fin }));
}

export function revisarSubtitulos(formato: Formato, grupos: Grupo[], finSubs: number, plataformas: readonly Plataforma[] = []) {
  const cpl = caracteresPorLinea(formato, { plataformas });
  const malos: string[] = [];
  /** Sólo los que fallan por forma (largo de línea o número de líneas), no por ritmo. */
  const malosForma: string[] = [];
  let peorLinea = 0;
  let peorLineas = 0;
  let peorCps = 0;
  for (const g of intervalosSubtitulos(grupos, finSubs)) {
    const ls = lineas(g.texto, cpl);
    const largo = Math.max(...ls.map((l) => l.length));
    const cps = g.texto.length / (g.fin - g.ini);
    peorLinea = Math.max(peorLinea, largo);
    peorLineas = Math.max(peorLineas, ls.length);
    peorCps = Math.max(peorCps, cps);
    const forma = largo > OBJETIVO.maxCaracteresLinea || ls.length > OBJETIVO.maxLineas;
    if (forma || cps > OBJETIVO.maxCps) {
      const d = `«${g.texto}» (${ls.length} líneas, ${largo} car./línea, ${cps.toFixed(1)} car./s, ${g.ini.toFixed(2)} s)`;
      malos.push(d);
      if (forma) malosForma.push(d);
    }
  }
  return { cpl, peorLinea, peorLineas, peorCps: Number(peorCps.toFixed(2)), malos, malosForma, grupos: grupos.length };
}

export async function hojaDeContacto(archivo: string, momentos: { t: number; nota: string }[], dirSalida: string, log: Registro) {
  await fs.rm(dirSalida, { recursive: true, force: true });
  await fs.mkdir(dirSalida, { recursive: true });
  const fotos: { t: number; ruta: string; nota: string }[] = [];
  for (const [i, m] of momentos.entries()) {
    const ruta = path.join(dirSalida, `${String(i + 1).padStart(2, "0")}.jpg`);
    await fotograma(archivo, m.t, ruta, 360);
    fotos.push({ t: m.t, ruta, nota: m.nota });
  }
  const cols = Math.min(6, fotos.length);
  const filas = Math.ceil(fotos.length / cols);
  const hoja = path.join(dirSalida, "hoja.jpg");
  await ffmpeg(
    ["-v", "error", "-framerate", "1", "-i", path.join(dirSalida, "%02d.jpg"), "-vf", `tile=${cols}x${filas}:padding=6:color=0x111111`, "-frames:v", "1", "-q:v", "3", hoja],
    log,
  );
  return { hoja, fotos };
}

/**
 * Licencias. Sin uso comercial es un aviso (la persona decide antes de publicar); con `comercial: true`
 * bloquea todo asset cuya licencia no permita uso comercial o no se sepa (BRECHAS.md Q1).
 */
export function reglaLicencias(licencias: { asset: string; licencia: string }[], comercial: boolean): Regla {
  const clasificadas = licencias.map((l) => ({ ...l, comercial: usoComercial(l.licencia) }));
  const malas = clasificadas.filter((l) => l.comercial !== "si");
  return {
    id: "licencias",
    nombre: comercial ? "Licencias de los assets (uso comercial)" : "Licencias de los assets",
    ok: malas.length === 0,
    aviso: !comercial,
    medido: clasificadas,
    objetivo: comercial ? "todas permiten uso comercial" : "todas conocidas y comerciales (aviso: el proyecto no está marcado de uso comercial)",
    detalle: malas.map((d) => `${d.asset}: ${d.licencia} (${d.comercial === "no" ? "no comercial" : "sin confirmar"})`).join("\n") || undefined,
  };
}

/** Alineación de la voz: avisa si hay palabras dudosas; bloquea si son más del 20 % (transcripción fallida). */
export function reglaAlineacion(c: ResumenConfianza | undefined): Regla | null {
  if (!c || c.medidas === 0) return null;
  const fallida = c.proporcion > MAX_DUDOSAS;
  return {
    id: "alineacion",
    nombre: "Tiempos de la voz (alineación)",
    ok: c.dudosas === 0,
    aviso: !fallida,
    medido: { dudosas: c.dudosas, medidas: c.medidas, proporcion: Number(c.proporcion.toFixed(3)) },
    objetivo: `sin palabras dudosas; más del ${MAX_DUDOSAS * 100} % = transcripción fallida`,
    detalle: c.escenas.map((e) => `${e.escena}: ${e.palabras.slice(0, 8).join(", ")}`).join("\n") || undefined,
  };
}

/**
 * Más allá de 2× un texto o un logo raster se ve blando. Los clips de MPT (832×1216) en 9:16 se
 * amplían 1,58× y pasan; un logo PNG chico como superposición a pantalla completa, no.
 */
export const AMPLIACION_MAX = 2;

/** Resolución efectiva de imágenes y clips en la salida. Aviso: no bloquea la entrega. */
export function reglaAmpliacion(lista: Ampliacion[] | undefined): Regla | null {
  if (!lista?.length) return null;
  const malas = lista.filter((x) => x.factor > AMPLIACION_MAX + 1e-3);
  const maxima = Math.max(...lista.map((x) => x.factor));
  const veces = (k: number) => `${k.toFixed(1).replace(".", ",")}×`;
  return {
    id: "ampliacion",
    nombre: "Nitidez de imágenes y clips",
    ok: malas.length === 0,
    aviso: true,
    medido: {
      "más estirado": veces(maxima),
      revisados: lista.length,
      // Para el botón «Vectorizar» de la UI (no se muestra como texto): imágenes borrosas, una por asset.
      vectorizables: [...new Map(malas.filter((x) => x.imagen).map((x) => [x.asset, { asset: x.asset, donde: x.donde }])).values()],
    },
    objetivo: `nada estirado a más de ${AMPLIACION_MAX}× su tamaño (se vería borroso); los SVG nunca se ven borrosos`,
    detalle: malas
      .map((x) => {
        const w = Math.ceil((x.ancho * x.factor) / AMPLIACION_MAX);
        const h = Math.ceil((x.alto * x.factor) / AMPLIACION_MAX);
        return `${x.donde}: se estira ${veces(x.factor)} y se verá borrosa. Cámbiala por una de al menos ${w}×${h} px, o por un SVG.`;
      })
      .join("\n") || undefined,
  };
}

/**
 * Fotogramas repetidos y congelados antes de la tarjeta. En un proyecto propio, pasarse de la
 * proporción bloquea. En un clip de material ajeno (`enClip`), el video original puede moverse poco
 * (fotos con voz, diapositivas, pantalla en pausa) y al entrar achicado con fondo borroso se repiten
 * más cuadros: la proporción sólo avisa y lo que bloquea es un congelado de 1 s o más (REN-02).
 */
export function reglasDuplicados(ratio: number, cong: { inicio: number; dur: number }[], esperadoDup: number, enClip: boolean): Regla[] {
  const topeDup = Math.min(1, OBJETIVO.maxDuplicados + esperadoDup);
  const proporcion = Number(ratio.toFixed(3));
  const delMaterial = esperadoDup ? { delMaterial: Number(esperadoDup.toFixed(3)) } : {};
  const tope = `≤ ${Math.round(topeDup * 100)} %${esperadoDup ? ` (${OBJETIVO.maxDuplicados * 100} % + lo que ya repite el material)` : ""}`;
  const sinCongelados = `sin congelados de ≥ ${OBJETIVO.maxCongelado} s`;
  if (!enClip) {
    return [{
      id: "duplicados", nombre: "Fotogramas duplicados (antes de la tarjeta final)", ok: ratio <= topeDup && cong.length === 0,
      medido: { proporcion, congelados: cong, ...delMaterial },
      objetivo: `${tope} y ${sinCongelados}`,
    }];
  }
  return [
    {
      id: "duplicados", nombre: "Imagen congelada (antes de la tarjeta final)", ok: cong.length === 0,
      medido: { congelados: cong }, objetivo: sinCongelados,
      detalle: cong.map((c) => `Congelada ${c.dur.toFixed(1)} s desde el segundo ${c.inicio.toFixed(1)}`).join("\n") || undefined,
    },
    {
      id: "duplicados-material", nombre: "Partes con poco movimiento", ok: ratio <= topeDup, aviso: true,
      medido: { proporcion, ...delMaterial }, objetivo: `${tope} (aviso: el video original puede moverse poco)`,
      detalle: ratio <= topeDup ? undefined : "Hay partes donde la imagen casi no se mueve. Si tu video original es así, está bien.",
    },
  ];
}

/** Ritmo: qué parte de los cortes cae en un pulso de la música. Informativo (aviso). */
export function reglaRitmo(r: Ritmo | null | undefined): Regla | null {
  if (!r || r.cortes === 0) return null;
  return {
    id: "ritmo",
    nombre: "Cortes en el pulso de la música",
    ok: r.enPulso / r.cortes >= 0.5,
    aviso: true,
    medido: { enPulso: r.enPulso, cortes: r.cortes, distanciaMedia: Number(r.media.toFixed(3)) },
    objetivo: "al menos la mitad de los cortes a ≤ 70 ms de un pulso",
  };
}

export async function correrQc(archivo: string, esp: Esperado, dirHoja: string, log: Registro): Promise<InformeQc> {
  const m = metricas(esp.formato, { plataformas: esp.plataformas });
  const fps = esp.fps ?? OBJETIVO.fps;
  const info = await probar(archivo);
  const reglas: Regla[] = [];

  // Sonoridad (segunda medición, sobre el archivo ya corregido).
  const s = await medirSonoridad(archivo, log);
  const lufs = Number(s.input_i);
  const tp = Number(s.input_tp);
  reglas.push({
    id: "sonoridad", nombre: "Sonoridad integrada", ok: Math.abs(lufs - OBJETIVO.lufs) <= OBJETIVO.toleranciaLufs,
    medido: lufs, objetivo: `${OBJETIVO.lufs} ± ${OBJETIVO.toleranciaLufs} LUFS`,
  });
  reglas.push({ id: "pico", nombre: "Pico real", ok: tp <= OBJETIVO.picoMaxDbtp, medido: tp, objetivo: `≤ ${OBJETIVO.picoMaxDbtp} dBTP` });

  // Color.
  const v = info.video ?? {};
  const color = { color_space: v.color_space, color_transfer: v.color_transfer, color_primaries: v.color_primaries, color_range: v.color_range, pix_fmt: v.pix_fmt };
  reglas.push({
    id: "color", nombre: "Color Rec.709, rango limitado",
    ok: v.color_space === "bt709" && v.color_transfer === "bt709" && v.color_primaries === "bt709" && v.color_range === "tv" && v.pix_fmt === "yuv420p",
    medido: color, objetivo: "bt709 / bt709 / bt709, tv, yuv420p",
  });

  // Integridad.
  const fotogramas = await contarFotogramas(archivo);
  const esperados = Math.round(esp.total * fps);
  reglas.push({
    id: "resolucion", nombre: "Resolución", ok: info.ancho === m.W && info.alto === m.H,
    medido: `${info.ancho}x${info.alto}`, objetivo: `${m.W}x${m.H}`,
  });
  reglas.push({ id: "fps", nombre: "Fotogramas por segundo", ok: v.r_frame_rate === `${fps}/1`, medido: v.r_frame_rate, objetivo: `${fps}/1` });
  // Duración del stream de video (el contenedor suma el relleno del códec de audio).
  const durVideo = Number(v.duration ?? info.duracion);
  const durAudio = Number(info.audio?.duration ?? durVideo);
  reglas.push({
    id: "duracion", nombre: "Duración (video y audio)",
    ok: Math.abs(durVideo - esp.total) <= 2 / fps + 0.05 && Math.abs(durAudio - durVideo) <= 0.15,
    medido: { video: Number(durVideo.toFixed(3)), audio: Number(durAudio.toFixed(3)) }, objetivo: `${esp.total.toFixed(3)} s; audio a ≤ 0,15 s del video`,
  });
  reglas.push({
    id: "fotogramas", nombre: "Fotogramas (caídos o de más)", ok: Math.abs(fotogramas - esperados) <= 2,
    medido: fotogramas, objetivo: `${esperados} ± 2`,
  });
  const dups = await duplicados(archivo, esp.inicioTarjeta, fps);
  const ratio = dups.entrada ? 1 - dups.salida / dups.entrada : 0;
  const cong = (await congelados(archivo, esp.inicioTarjeta)).filter((c) => c.dur >= OBJETIVO.maxCongelado);
  reglas.push(...reglasDuplicados(ratio, cong, esp.duplicadosEsperados ?? 0, esp.duplicadosAviso === true));

  // Subtítulos.
  const sub = revisarSubtitulos(esp.formato, esp.grupos, esp.inicioTarjeta, esp.plataformas);
  const soloForma = esp.ritmoSubtitulosAviso === true;
  reglas.push({
    id: "subtitulos", nombre: soloForma ? "Subtítulos legibles (forma)" : "Subtítulos legibles",
    ok: (soloForma ? sub.malosForma : sub.malos).length === 0,
    medido: { peorCaracteresLinea: sub.peorLinea, peorLineas: sub.peorLineas, peorCps: sub.peorCps, grupos: sub.grupos, caracteresPorLinea: sub.cpl },
    objetivo: soloForma ? `≤ ${OBJETIVO.maxCaracteresLinea} car./línea, ≤ ${OBJETIVO.maxLineas} líneas` : `≤ ${OBJETIVO.maxCaracteresLinea} car./línea, ≤ ${OBJETIVO.maxLineas} líneas, ≤ ${OBJETIVO.maxCps} car./s`,
    detalle: (soloForma ? sub.malosForma : sub.malos).slice(0, 12).join("\n") || undefined,
  });
  if (soloForma) {
    const rapidos = sub.malos.filter((m) => !sub.malosForma.includes(m));
    reglas.push({
      id: "subtitulos-ritmo", nombre: "Ritmo de los subtítulos (voz del creador)", ok: rapidos.length === 0, aviso: true,
      medido: { peorCps: sub.peorCps }, objetivo: `≤ ${OBJETIVO.maxCps} car./s (aviso: la voz original no se puede frenar)`,
      detalle: rapidos.slice(0, 12).join("\n") || undefined,
    });
  }

  // Zonas seguras (cajas del compilador).
  const fuera = esp.cajas.filter((c) => !c.dentro);
  reglas.push({
    id: "zonas-seguras", nombre: "Texto y logo dentro de la banda segura", ok: fuera.length === 0,
    medido: esp.cajas.map((c) => ({ nombre: c.nombre, dentro: c.dentro, caja: c.caja })),
    objetivo: `dentro de x ${m.segura.x}–${m.segura.x + m.segura.w}, y ${m.segura.y}–${m.segura.y + m.segura.h} px`,
    detalle: fuera.map((c) => c.nombre).join(", ") || undefined,
  });

  if (esp.check) {
    reglas.push({
      id: "hyperframes-check", nombre: "hyperframes check", ok: esp.check.errores === 0,
      medido: { errores: esp.check.errores, avisos: esp.check.avisos }, objetivo: "0 errores", detalle: esp.check.resumen || undefined,
    });
  }

  reglas.push(reglaLicencias(esp.licencias, esp.comercial ?? false));
  const alineacion = reglaAlineacion(esp.confianza);
  if (alineacion) reglas.push(alineacion);
  const ritmo = reglaRitmo(esp.ritmo);
  if (ritmo) reglas.push(ritmo);
  const ampliacion = reglaAmpliacion(esp.ampliaciones);
  if (ampliacion) reglas.push(ampliacion);
  reglas.push(...(esp.extras ?? []));

  const hoja = await hojaDeContacto(archivo, esp.momentos, dirHoja, log);
  return {
    aprobado: reglas.every((r) => r.ok || r.aviso),
    archivo,
    medidoEn: new Date().toISOString(),
    reglas,
    hojaContacto: hoja.hoja,
    fotogramas: hoja.fotos,
  };
}
