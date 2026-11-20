/**
 * Esquema de geeper.json (schemaVersion 2): la fuente de verdad de cada proyecto.
 *
 * Toma los conceptos de OpenTimelineIO:
 *  - `pistas` (tracks) con `clips`, cada uno con su `rango` sobre el asset (source_range),
 *  - `marcadores` (markers) sobre la línea de tiempo.
 * Y agrega lo de Geeper: cada asset lleva su `source` (archivo | mpt | tts | wan), su licencia y lo
 * necesario para regenerarlo; cada escena guarda lo que se oye, los tiempos por palabra, las
 * correcciones de lo que se muestra y los recortes de la edición por texto.
 *
 * Pistas reservadas: `visual` y `voz` (un clip por escena, en el mismo orden: el de la línea de
 * tiempo) y `musica`. Cualquier otra pista es **libre** (superposiciones de video o efectos de
 * sonido): sus clips llevan `inicio` en la línea de tiempo final. Los textos superpuestos (títulos,
 * rótulos) van en `textos`. La tarjeta final va después de la última escena y dura lo que diga la
 * plantilla.
 *
 * v1 → v2 (`migrar`): sólo agrega campos con valor por defecto; un proyecto v1 se lee igual.
 */
import { z } from "zod";
import { Curva, Efecto, Fusion, OpcionesMascara, TIPOS_MASCARA } from "./efectos-esquema";

export const SCHEMA_VERSION = 2 as const;

export const Formato = z.enum(["9:16", "16:9", "1:1"]);
export type Formato = z.infer<typeof Formato>;

export const Source = z.enum(["archivo", "mpt", "tts", "wan"]);
export type Source = z.infer<typeof Source>;

/** Plataformas de destino: cada una tapa zonas distintas del cuadro (formatos.ts). */
export const Plataforma = z.enum(["youtube", "tiktok", "instagram", "facebook"]);
export type Plataforma = z.infer<typeof Plataforma>;

export const PISTAS_RESERVADAS = ["visual", "voz", "musica"] as const;

const Segundos = z.number().finite().min(0);

/** Rango sobre el asset (source_range de OTIO), en segundos. */
export const Rango = z.object({ inicio: Segundos, duracion: z.number().finite().positive() });
export type Rango = z.infer<typeof Rango>;

/** Dónde está la cara principal de un asset visual (src/lib/caras.ts). Fracciones del cuadro (0..1). */
export const Foco = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** Ancho de la cara en fracción del ancho del cuadro. */
  ancho: z.number().min(0).max(1),
  confianza: z.number().min(0).max(1),
  /** Fracción de las muestras con cara. */
  cobertura: z.number().min(0).max(1),
  /** Cuánto se mueve el centro (p90 de |x − mediana|, fracción del ancho). */
  dispersion: z.number().min(0).max(1),
  muestras: z.number().int().positive(),
  /** Detector que lo calculó (p. ej. yunet-2023mar). */
  modelo: z.string().min(1),
}).describe("Dónde está la cara principal de un asset visual, en fracciones del cuadro (0..1).");
export type Foco = z.infer<typeof Foco>;

export const Asset = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  tipo: z.enum(["video", "audio", "imagen"]),
  /** Relativa a la carpeta del proyecto (p. ej. assets/clip-01.mp4). */
  ruta: z.string().min(1).refine((r) => !r.startsWith("/") && !r.split("/").includes(".."), "ruta relativa sin '..'"),
  /** sha256 del archivo. */
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  source: Source,
  licencia: z.string().min(1),
  duracion: Segundos.optional(),
  ancho: z.number().int().positive().optional(),
  alto: z.number().int().positive().optional(),
  /** Lo necesario para regenerarlo: prompt, semilla, modelo, hash de los pesos, tarea de MPT, voz, texto... */
  regenerar: z.record(z.string(), z.unknown()).default({}),
  /** Sólo video o imagen: cara principal detectada; sin ancla fijada, el encuadre la sigue. */
  foco: Foco.optional(),
}).describe("Archivo del proyecto (video, audio o imagen) con su origen, licencia y lo necesario para regenerarlo.");
export type Asset = z.infer<typeof Asset>;

/** Encuadre de un clip visual: escala 1 = llena el cuadro; x/y desplazan (−1..1 = medio cuadro). */
export const Encuadre = z.object({
  escala: z.number().min(0.1).max(4).default(1),
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
}).describe("Encuadre de un clip visual: escala 1 = llena el cuadro; x/y desplazan (−1..1 = medio cuadro).");
export type Encuadre = z.infer<typeof Encuadre>;

export const Transicion = z.object({
  /** barrido, radial, iris y persianas revelan el clip con una máscara (efectos.ts). */
  tipo: z.enum(["corte", "fundido", "deslizar", "zoom", ...TIPOS_MASCARA]),
  /** Segundos; el fundido se monta sobre el final del clip anterior. */
  duracion: z.number().min(0.1).max(2).default(0.4),
  ...OpcionesMascara,
}).describe("Transición de entrada sobre la escena anterior.");
export type Transicion = z.infer<typeof Transicion>;

export const Color = z.object({
  brillo: z.number().min(0).max(2).default(1),
  contraste: z.number().min(0).max(2).default(1),
  saturacion: z.number().min(0).max(3).default(1),
}).describe("Ajuste de color (1 = sin cambio).");
export type Color = z.infer<typeof Color>;

export const Clip = z.object({
  id: z.string().min(1),
  asset: z.string().min(1),
  rango: Rango,
  /** Escena a la que pertenece (pistas visual y voz). */
  escena: z.string().optional(),
  /** Pistas libres: dónde empieza en la línea de tiempo final (s). */
  inicio: Segundos.optional(),
  /** Sólo video: cómo llena el cuadro si la relación de aspecto no coincide. */
  ajuste: z.enum(["cubrir", "contener"]).optional(),
  /** Sólo video: qué parte se conserva al recortar (object-position). */
  ancla: z.enum(["centro", "arriba", "abajo"]).optional(),
  /** Sólo video: transición de entrada (en la pista visual, desde la escena anterior). */
  transicion: Transicion.optional(),
  /** Sólo video: movimiento de cámara de principio a fin del clip (Ken Burns, zoom). */
  movimiento: z.object({ desde: Encuadre, hasta: Encuadre, curva: Curva.optional() }).optional(),
  /** Sólo video: velocidad de reproducción (0,1–10; el audio propio conserva el tono). */
  velocidad: z.number().min(0.1).max(10).optional(),
  /** Sólo video: ajuste de color. */
  color: Color.optional(),
  /** Sólo video: efectos en orden (tinte, niveles, viñeta, desenfoque, grano), después del color. */
  efectos: z.array(Efecto).max(8).optional(),
  /**
   * Pista visual: «voz» = el video y la voz salen de la misma grabación (un clip de un directo o un
   * VOD). El video sigue los tramos que suenan de la voz con el mismo desplazamiento sobre el asset:
   * recortar palabras corta también la imagen y la boca no se desincroniza. Ignora `velocidad`.
   */
  sincro: z.literal("voz").optional(),
  /** Pistas libres de video: opacidad de la superposición. */
  opacidad: z.number().min(0).max(1).optional(),
  /** Pistas libres de video: modo de fusión con lo de abajo. */
  fusion: Fusion.optional(),
  /** Sólo audio: ganancia lineal. */
  volumen: z.number().min(0).max(4).optional(),
}).describe("Clip de una pista. En visual y voz hay uno por escena, en el mismo orden; en las pistas libres lleva `inicio`.");
export type Clip = z.infer<typeof Clip>;

export const Pista = z.object({
  /** visual | voz | musica, o el nombre de una pista libre (p. ej. «broll», «efectos»). */
  id: z.string().regex(/^[a-z0-9-]+$/),
  tipo: z.enum(["video", "audio"]),
  clips: z.array(Clip),
}).describe("Pista de la línea de tiempo: visual, voz, musica o una pista libre.");
export type Pista = z.infer<typeof Pista>;

/** Texto superpuesto (título, rótulo o cita), aparte de los subtítulos. */
export const Texto = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  texto: z.string().min(1).max(160),
  inicio: Segundos,
  duracion: z.number().min(0.3).max(60),
  estilo: z.enum(["titulo", "rotulo", "cita"]).default("rotulo"),
  posicion: z.enum(["arriba", "centro", "abajo"]).default("arriba"),
}).describe("Texto superpuesto (título, rótulo o cita), aparte de los subtítulos.");
export type Texto = z.infer<typeof Texto>;

/** Tiempo por palabra, en el tiempo del asset de voz de la escena. */
export const Palabra = z.object({
  texto: z.string().min(1),
  inicio: Segundos,
  fin: Segundos,
  /** 0..1: qué tan creíble es el tiempo (ver confianza.ts). Ausente = sin medir. */
  confianza: z.number().min(0).max(1).optional(),
}).describe("Tiempo de una palabra, en el tiempo del asset de voz de la escena.");
export type Palabra = z.infer<typeof Palabra>;

/**
 * Corrección de lo que se muestra sobre las palabras oídas [desde, hasta) de la escena.
 * No cambia lo que se oye: redistribuye los tiempos de esas palabras entre el texto nuevo.
 */
export const Correccion = z.object({
  desde: z.number().int().min(0),
  hasta: z.number().int().positive(),
  texto: z.string(),
}).describe("Cambia lo que se muestra sobre las palabras oídas [desde, hasta) sin cambiar lo que se oye.");
export type Correccion = z.infer<typeof Correccion>;

/** Tramo que se quita de la voz de la escena (edición por texto), en tiempo del asset de voz. */
export const Recorte = z.object({
  inicio: Segundos,
  fin: Segundos,
  motivo: z.enum(["palabras", "silencio", "muletilla"]),
}).describe("Tramo que se quita de la voz de la escena (edición por texto).");
export type Recorte = z.infer<typeof Recorte>;

export const Escena = z.object({
  id: z.string().min(1),
  /** Lo que se oye en esta escena (fragmento del guion). */
  texto: z.string(),
  palabras: z.array(Palabra),
  correcciones: z.array(Correccion).default([]),
  recortes: z.array(Recorte).default([]),
}).describe("Escena: lo que se oye, sus palabras con tiempos, correcciones y recortes.");
export type Escena = z.infer<typeof Escena>;

/** «GTA seis=GTA VI»: cambia lo que se lee sin cambiar lo que se oye (--mostrar de mpt-acabado). */
export const Mostrar = z
  .object({ de: z.string().min(1), a: z.string().min(1) })
  .describe("Cambia lo que se lee sin cambiar lo que se oye (p. ej. «GTA seis» → «GTA VI»).");
export type Mostrar = z.infer<typeof Mostrar>;

export const Marcador = z.object({
  id: z.string(),
  tiempo: Segundos,
  nombre: z.string(),
  tipo: z.enum(["corte", "nota", "pulso"]),
}).describe("Marca en la línea de tiempo: corte, nota o pulso de la música.");

export const Voz = z.object({
  motor: z.enum(["kokoro", "mpt"]),
  voz: z.string().min(1),
  velocidad: z.number().min(0.5).max(2).default(1),
  idioma: z.string().default("es"),
}).describe("Cómo se genera la próxima voz.");
export type Voz = z.infer<typeof Voz>;

/**
 * Estilo del video: aspecto (efectos), transición entre escenas y ritmo del movimiento de cámara.
 * Una escena que tiene su propio valor lo usa (excepción); si no, hereda éste. Sin estilo, cada
 * escena se ve como antes (golpe de zoom de la plantilla, sin efectos, movimiento constante).
 */
export const EstiloVideo = z.object({
  efectos: z.array(Efecto).max(8).optional(),
  transicion: Transicion.optional(),
  curva: Curva.optional(),
}).describe("Estilo del video: lo heredan las escenas que no fijan el suyo.");
export type EstiloVideo = z.infer<typeof EstiloVideo>;

export const Fps = z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]);

export const Proyecto = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION).describe("Versión del esquema (2). Un v1 se migra solo al leerlo."),
    id: z.string().min(1),
    nombre: z.string().min(1),
    tema: z.string().describe("De qué trata el video."),
    formato: Formato.describe("Relación de aspecto del video."),
    plantilla: z.string().min(1).describe("Slug de la plantilla del canal."),
    fps: Fps.default(30).describe("Cuadros por segundo: 24, 25, 30 o 60."),
    voz: Voz,
    guion: z.object({ texto: z.string() }).describe("El guion que se oye."),
    mostrar: z.array(Mostrar).default([]).describe("Reemplazos de lo que se lee."),
    assets: z.record(z.string(), Asset).describe("Assets por id."),
    pistas: z.array(Pista).describe("Pistas: visual y voz (un clip por escena, mismo orden), musica opcional y pistas libres."),
    textos: z.array(Texto).default([]).describe("Textos superpuestos."),
    escenas: z.record(z.string(), Escena).describe("Escenas por id."),
    marcadores: z.array(Marcador).default([]).describe("Cortes, notas y pulsos de la música."),
    /** Si el video se va a monetizar o usar con fines comerciales: el QC bloquea licencias dudosas. */
    comercial: z.boolean().default(false).describe("Si se monetiza o usa con fines comerciales: el QC bloquea licencias no comerciales o dudosas."),
    /** Dónde se va a publicar: ajusta la banda segura a lo que tapa cada interfaz. */
    plataformas: z.array(Plataforma).default([]).describe("Dónde se publica: en 9:16 estrecha la banda segura."),
    entrega: z.object({ master: z.boolean().default(false) }).default({ master: false }).describe("entrega.master: también un máster .mov de archivo."),
    /** Estilo del video: lo heredan las escenas que no fijan el suyo (ver `aplicarEstilo`). */
    estilo: EstiloVideo.optional(),
    /** Botón de la tarjeta final sólo para este video (variantes de anuncios). Sin él, el de la plantilla. */
    cta: z.string().trim().min(1).max(60).optional().describe("Botón de la tarjeta final sólo para este video."),
    /** La etiqueta de marca arriba durante el video (la tarjeta final la lleva siempre). En clips react
     *  tapa la cara del streamer: ahí se oculta. */
    marca: z.boolean().default(true).describe("Etiqueta de marca arriba durante el video."),
    origen: z.record(z.string(), z.unknown()).default({}).describe("Datos de origen (tarea de MPT, fuente del clip…)."),
  })
  .superRefine((p, ctx) => {
    for (const e of erroresDeConsistencia(p)) ctx.addIssue({ code: "custom", message: e });
  })
  .describe("Proyecto de Geeper (geeper.json).");
export type Proyecto = z.infer<typeof Proyecto>;

/** Convierte un geeper.json de una versión anterior a la actual (sin tocar lo que ya tenía). */
export function migrar(datos: unknown): unknown {
  if (!datos || typeof datos !== "object") return datos;
  const d = datos as Record<string, unknown>;
  if (d.schemaVersion === 1) return { ...d, schemaVersion: 2 };
  return d;
}

export function pista(p: Pick<Proyecto, "pistas">, id: string): Pista {
  const encontrada = p.pistas.find((x) => x.id === id);
  if (!encontrada) throw new Error(`Falta la pista ${id}`);
  return encontrada;
}

/**
 * Proyecto con el estilo del video aplicado a los clips visuales que no tienen el suyo: es lo que
 * compilan Hyperframes y OTIO. Una lista de efectos vacía en la escena es una excepción («sin
 * efectos»), no una herencia.
 */
export function aplicarEstilo(p: Proyecto): Proyecto {
  const e = p.estilo;
  if (!e || (!e.efectos?.length && !e.transicion && !e.curva)) return p;
  const visual = p.pistas.find((x) => x.id === "visual");
  if (!visual) return p;
  const clips = visual.clips.map((c, i) => ({
    ...c,
    transicion: c.transicion ?? (i > 0 ? e.transicion : undefined),
    efectos: c.efectos ?? (e.efectos?.length ? e.efectos : undefined),
    movimiento: c.movimiento && !c.movimiento.curva && e.curva ? { ...c.movimiento, curva: e.curva } : c.movimiento,
  }));
  return { ...p, pistas: p.pistas.map((x) => (x === visual ? { ...x, clips } : x)) };
}

/** Pistas libres (superposiciones y efectos): todo lo que no es visual, voz ni música. */
export function pistasLibres(p: Pick<Proyecto, "pistas">): Pista[] {
  return p.pistas.filter((x) => !(PISTAS_RESERVADAS as readonly string[]).includes(x.id));
}

/** Tramos [inicio, fin) ya recortados y fusionados, dentro de [desde, hasta). */
export function fusionarRecortes(recortes: { inicio: number; fin: number }[], desde: number, hasta: number): { inicio: number; fin: number }[] {
  const orden = recortes
    .map((r) => ({ inicio: Math.max(desde, r.inicio), fin: Math.min(hasta, r.fin) }))
    .filter((r) => r.fin - r.inicio > 1e-6)
    .sort((a, b) => a.inicio - b.inicio);
  const out: { inicio: number; fin: number }[] = [];
  for (const r of orden) {
    const u = out[out.length - 1];
    if (u && r.inicio <= u.fin + 1e-6) u.fin = Math.max(u.fin, r.fin);
    else out.push({ ...r });
  }
  return out;
}

/** Reglas que Zod no expresa por campo: referencias, orden de escenas, rangos y recortes. */
export function erroresDeConsistencia(p: Omit<Proyecto, never>): string[] {
  const errores: string[] = [];
  const ids = p.pistas.map((x) => x.id);
  for (const requerida of ["visual", "voz"] as const) {
    if (!ids.includes(requerida)) errores.push(`Falta la pista «${requerida}»`);
  }
  if (new Set(ids).size !== ids.length) errores.push("Hay pistas repetidas");
  const tipos: Record<string, Pista["tipo"]> = { visual: "video", voz: "audio", musica: "audio" };
  for (const pi of p.pistas) {
    const esperado = tipos[pi.id];
    if (esperado && pi.tipo !== esperado) errores.push(`La pista «${pi.id}» debe ser de ${esperado}`);
  }
  const visual = p.pistas.find((x) => x.id === "visual");
  const voz = p.pistas.find((x) => x.id === "voz");
  const clipIds = new Set<string>();
  for (const pi of p.pistas) {
    const libre = !(PISTAS_RESERVADAS as readonly string[]).includes(pi.id);
    for (const c of pi.clips) {
      if (clipIds.has(c.id)) errores.push(`Clip repetido: ${c.id}`);
      clipIds.add(c.id);
      if (libre && c.inicio === undefined) errores.push(`El clip ${c.id} está en la pista libre «${pi.id}» y no dice dónde empieza (inicio)`);
      const a = p.assets[c.asset];
      if (!a) {
        errores.push(`El clip ${c.id} apunta a un asset que no existe: ${c.asset}`);
        continue;
      }
      if (pi.tipo === "video" && a.tipo === "audio") errores.push(`El clip ${c.id} es de video pero su asset es audio`);
      if (pi.tipo === "audio" && a.tipo !== "audio") errores.push(`El clip ${c.id} es de audio pero su asset no`);
      if ((pi.id === "voz" || (libre && pi.tipo === "audio")) && a.duracion !== undefined && c.rango.inicio + c.rango.duracion > a.duracion + 0.05) {
        errores.push(`El clip ${c.id} se sale del asset (${(c.rango.inicio + c.rango.duracion).toFixed(2)} s > ${a.duracion.toFixed(2)} s)`);
      }
    }
  }
  const textoIds = new Set<string>();
  for (const t of p.textos) {
    if (textoIds.has(t.id)) errores.push(`Texto repetido: ${t.id}`);
    textoIds.add(t.id);
  }
  if (visual && voz) {
    const ev = visual.clips.map((c) => c.escena);
    const ea = voz.clips.map((c) => c.escena);
    if (JSON.stringify(ev) !== JSON.stringify(ea)) {
      errores.push("Las pistas visual y voz deben tener un clip por escena, en el mismo orden");
    }
    const vistas = new Set<string>();
    for (const e of ea) {
      if (!e || !p.escenas[e]) errores.push(`Clip de voz sin escena válida: ${String(e)}`);
      else if (vistas.has(e)) errores.push(`Escena usada dos veces: ${e}`);
      else vistas.add(e);
    }
    for (const id of Object.keys(p.escenas)) {
      if (!vistas.has(id)) errores.push(`La escena ${id} no está en la línea de tiempo`);
    }
    for (const c of voz.clips) {
      const e = c.escena ? p.escenas[c.escena] : undefined;
      if (!e || !e.recortes.length) continue;
      const desde = c.rango.inicio;
      const hasta = desde + c.rango.duracion;
      for (const r of e.recortes) {
        if (r.fin <= r.inicio) errores.push(`Recorte vacío en ${e.id}: ${r.inicio}–${r.fin}`);
      }
      const quitado = fusionarRecortes(e.recortes, desde, hasta).reduce((s, r) => s + (r.fin - r.inicio), 0);
      if (c.rango.duracion - quitado < 0.1) errores.push(`Los recortes de ${e.id} dejan la escena vacía: quita la escena en vez de recortarla entera`);
    }
  }
  for (const e of Object.values(p.escenas)) {
    for (const c of e.correcciones) {
      if (c.hasta <= c.desde || c.hasta > e.palabras.length) {
        errores.push(`Corrección fuera de rango en ${e.id}: [${c.desde}, ${c.hasta})`);
      }
    }
  }
  return errores;
}

/** Valida un geeper.json (de cualquier versión: las anteriores se migran antes). */
export function validarProyecto(datos: unknown): Proyecto {
  return Proyecto.parse(migrar(datos));
}
