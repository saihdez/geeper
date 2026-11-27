/**
 * Importador «clip de material largo» → geeper.json (BRECHAS.md G5 + E4):
 *  1. corta el tramo de la fuente con 1 s de margen a cada lado (video con un keyframe por segundo
 *     para la vista en vivo, y el audio aparte como «voz»),
 *  2. en 9:16, reencuadra: react (cara arriba, juego abajo) o cara (sigue la cara); si no hay cara
 *     estable, cae a «contener» (fondo desenfocado) y lo dice,
 *  3. transcribe el tramo con whisper `medium` y puntúa la confianza de cada palabra,
 *  4. parte en escenas en pausas, con el visual en `sincro: "voz"` (recortar palabras corta la imagen),
 *  5. guarda geeper.json con la procedencia y el crédito en `origen.clip`.
 *
 * El audio es el del creador: la voz no se regenera (regenerar.ts lo impide) y no hay música.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb, crearCarpetas } from "./almacen";
import { escribirAtomico } from "./archivos";
import { mascaraInsultos, type Campania, type OrigenClip } from "./clips";
import { detectarSilencios, puntuarPalabras, resumirConfianza } from "./confianza";
import { SCHEMA_VERSION, validarProyecto, type Asset, type Escena, type Palabra, type Proyecto, type Texto } from "./esquema";
import { credito, leerFuente } from "./fuentes";
import { ffmpeg, huellaFfmpeg, probar } from "./media";
import { etiquetaPesos, huellaPesos } from "./modelos";
import { paso, type Contexto } from "./pasos";
import type { DatosPlantilla } from "./plantillas";
import { detectar, hornear } from "./reencuadre";
import { segmentar } from "./segmentar";
import { MODELO_WHISPER, motorTranscripcion, transcribir } from "./voz";
import { FILTRO_VOZ, limpiarVoz, VERSION_FILTRO_VOZ } from "./voz-limpia";

export const ENCUADRES = ["cubrir", "contener", "react", "cara"] as const;
export type EncuadreClip = (typeof ENCUADRES)[number];

/** Margen del tramo a cada lado: deja aire para correr los bordes y para la entrada en silencio. */
export const MARGEN = 1;
/** Duración objetivo de cada escena (s): permite quitar o mover partes del clip. */
export const ESCENA_CLIP = 8;

export interface DatosClip {
  proyectoId: string;
  slug: string;
  nombre: string;
  tema: string;
  formato: Proyecto["formato"];
  plantilla: { slug: string; datos: DatosPlantilla };
  fuenteId: string;
  inicio: number;
  fin: number;
  encuadre: EncuadreClip;
  idioma: string;
  /** Título fijo todo el clip (estilo reacción: «Kai PIERDE la cabeza con la policía»). */
  titulo?: string;
  /** Gancho de los primeros 2,6 s. */
  gancho?: string;
  /** Si hay permiso o campaña: texto que lo dice. Sin esto, la licencia queda «revisar». */
  permiso?: string;
  /** Nombres propios para guiar a whisper (whisper.ts): «GTA VI, Lucia, Vice City». */
  glosario?: string;
  campania?: Campania;
  /** «Mejorar la voz» (voz-limpia.ts): quita ruido de fondo y empareja el volumen. Por defecto, sí. */
  mejorarVoz?: boolean;
}

/** Palabras del tramo (tiempo del asset de voz) con su confianza; paso con manifiesto. */
async function palabrasDelTramo(ctx: Contexto, voz: string, idioma: string, glosario?: string): Promise<Palabra[]> {
  const salida = path.join(ctx.dir, "assets", "palabras-voz-tramo.json");
  const pesos = await etiquetaPesos(`whisper-${MODELO_WHISPER}`);
  const motor = `transcribir-v2+${await motorTranscripcion()}+${pesos}`;
  await paso(ctx, "clip.palabras", { archivos: [voz], params: { idioma, modelo: MODELO_WHISPER, glosario: glosario ?? null }, motor }, [salida], async ([tmp]) => {
    const w = await transcribir(voz, idioma, ctx.log, { glosario });
    const crudas: Palabra[] = w.map((x) => ({ texto: x.text.trim(), inicio: x.start, fin: Math.max(x.end, x.start + 0.02) })).filter((x) => x.texto);
    const palabras = puntuarPalabras(crudas, w, await detectarSilencios(voz), { probabilidad: true });
    const r = resumirConfianza([{ id: "voz", palabras }]);
    if (r.dudosas) ctx.log(`Aviso: ${r.dudosas} de ${r.medidas} palabras con tiempos dudosos (música o voces encimadas)`);
    await fs.writeFile(tmp!, JSON.stringify(palabras));
    return { palabras: palabras.length };
  });
  return JSON.parse(await fs.readFile(salida, "utf8")) as Palabra[];
}

export async function importarClip(ctx: Contexto, d: DatosClip): Promise<{ version: number; escenas: number; encuadre: string }> {
  if (!(d.fin > d.inicio)) throw new Error("El tramo está vacío: fin debe ser mayor que inicio");
  await crearCarpetas(d.slug);
  const fuente = await leerFuente(d.fuenteId);
  const st = await fs.stat(fuente.video);
  const durFuente = fuente.info.duracion || (await probar(fuente.video)).duracion;
  const a0 = Math.max(0, d.inicio - MARGEN);
  const a1 = Math.min(durFuente, d.fin + MARGEN);
  if (a1 - a0 < 1) throw new Error(`El tramo ${d.inicio}–${d.fin} s cae fuera de la fuente (${durFuente.toFixed(0)} s)`);
  const ff = await huellaFfmpeg();

  // 1. Tramo: video (sin audio) y voz. El VOD puede pesar GB: su huella es tamaño + fecha, no sha256.
  const rutaTramo = path.join(ctx.dir, "assets", "tramo.mp4");
  const rutaVoz = path.join(ctx.dir, "assets", "voz-tramo.wav");
  await paso(
    ctx,
    "clip.tramo",
    { archivos: [], params: { fuente: fuente.id, tamano: st.size, mtime: st.mtimeMs, a0, a1 }, motor: `clip-tramo-v1+${ff}` },
    [rutaTramo, rutaVoz],
    async ([tv, ta]) => {
      await ffmpeg(
        ["-ss", a0.toFixed(3), "-t", (a1 - a0).toFixed(3), "-i", fuente.video,
          "-map", "0:v:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", "30", "-keyint_min", "30", "-pix_fmt", "yuv420p", "-an", tv!,
          "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", ta!],
        ctx.log,
      );
      return { a0, a1 };
    },
  );

  // 2. Reencuadre (sólo 9:16; en 16:9 o 1:1 se usa el tramo tal cual).
  let visual = rutaTramo;
  let encuadre: string = d.encuadre;
  let paramsReencuadre: Record<string, unknown> | null = null;
  let resumen: string | undefined;
  if ((d.encuadre === "react" || d.encuadre === "cara") && d.formato === "9:16") {
    const r = await detectar(rutaTramo, d.encuadre);
    if (r.ok && r.filtro) {
      const salida = path.join(ctx.dir, "assets", `tramo-${d.encuadre}.mp4`);
      await hornear(ctx, rutaTramo, r.filtro, salida);
      visual = salida;
      paramsReencuadre = r.params ?? null;
      resumen = r.resumen;
      ctx.log(`Reencuadre ${d.encuadre}: ${r.resumen}`);
    } else {
      encuadre = "contener";
      resumen = `${d.encuadre} no aplicó: ${r.motivo}; se usa fondo desenfocado`;
      ctx.log(`Aviso: ${resumen}`);
    }
  } else if (d.encuadre === "react" || d.encuadre === "cara") {
    encuadre = "cubrir";
    resumen = `${d.encuadre} es sólo para 9:16`;
  }

  // 3. Palabras del tramo (whisper oye el audio original: la limpieza no cambia los subtítulos).
  const palabras = await palabrasDelTramo(ctx, rutaVoz, d.idioma, d.glosario);

  // 3 bis. Voz mejorada: es la que suena en el video.
  let vozFinal = rutaVoz;
  if (d.mejorarVoz !== false) {
    vozFinal = path.join(ctx.dir, "assets", "voz-tramo-limpia.wav");
    await paso(ctx, "clip.voz-limpia", { archivos: [rutaVoz], params: { filtro: FILTRO_VOZ }, motor: `${VERSION_FILTRO_VOZ}+${ff}` }, [vozFinal], async ([tmp]) => {
      await limpiarVoz(rutaVoz, tmp!, ctx.log);
      return { filtro: FILTRO_VOZ };
    });
  }

  // 4. Assets con su procedencia.
  const licencia = d.permiso
    ? `permiso del creador: ${d.permiso}`
    : `revisar: material de ${fuente.info.canal ?? "un tercero"} (${fuente.info.url}); publica sólo con su permiso o dentro de su campaña`;
  const procedencia = {
    origen: "clip",
    fuente: fuente.id,
    url: fuente.info.url,
    canal: fuente.info.canal,
    inicioFuente: a0,
    finFuente: a1,
  };
  const assets: Record<string, Asset> = {};
  const aVisual = await describirAsset(ctx.dir, path.relative(ctx.dir, visual), {
    id: "tramo",
    tipo: "video",
    source: "archivo",
    licencia,
    regenerar: { ...procedencia, encuadre, reencuadre: paramsReencuadre },
  });
  const aVoz = await describirAsset(ctx.dir, path.relative(ctx.dir, vozFinal), {
    id: "voz-tramo",
    tipo: "audio",
    source: "archivo",
    licencia,
    regenerar: {
      ...procedencia,
      alineacion: { modelo: `whisper-${MODELO_WHISPER}`, pesos: await huellaPesos(`whisper-${MODELO_WHISPER}`) },
      mejora: vozFinal === rutaVoz ? null : { filtro: FILTRO_VOZ, version: VERSION_FILTRO_VOZ, original: path.relative(ctx.dir, rutaVoz) },
    },
  });
  assets[aVisual.id] = aVisual;
  assets[aVoz.id] = aVoz;

  // 5. Escenas: sólo [inicio, fin] del tramo (el margen queda fuera), cortadas en pausas.
  const off = d.inicio - a0;
  const largo = Math.min(d.fin, a1) - d.inicio;
  const enVentana = palabras
    .filter((w) => (w.inicio + w.fin) / 2 >= off && (w.inicio + w.fin) / 2 <= off + largo)
    .map((w) => ({ ...w, inicio: Math.max(0, w.inicio - off), fin: Math.min(largo, w.fin - off) }));
  const tramos = segmentar(enVentana, largo, ESCENA_CLIP);
  const escenas: Record<string, Escena> = {};
  const clipsVoz = [];
  const clipsVisual = [];
  for (const [i, t] of tramos.entries()) {
    const id = `e${String(i + 1).padStart(2, "0")}`;
    const ps = t.palabras.map((w) => ({ ...w, inicio: w.inicio + off, fin: w.fin + off }));
    escenas[id] = { id, texto: ps.map((w) => w.texto).join(" "), palabras: ps, correcciones: [], recortes: [] };
    const rango = { inicio: t.inicio + off, duracion: t.fin - t.inicio };
    clipsVoz.push({ id: `voz-${id}`, asset: aVoz.id, escena: id, rango });
    clipsVisual.push({
      id: `vis-${id}`,
      asset: aVisual.id,
      escena: id,
      rango: { ...rango },
      sincro: "voz" as const,
      ...(encuadre === "contener" ? { ajuste: "contener" as const } : {}),
    });
  }

  const total = largo;
  const textos: Texto[] = [];
  if (d.titulo) textos.push({ id: "titulo", texto: d.titulo, inicio: 0, duracion: Math.min(60, total), estilo: "titulo", posicion: encuadre === "react" ? "centro" : "arriba" });
  // En react la mitad de arriba es la cara: el gancho va abajo, sobre el juego.
  if (d.gancho) textos.push({ id: "gancho", texto: d.gancho, inicio: 0, duracion: Math.min(2.6, total), estilo: "titulo", posicion: encuadre === "react" ? "abajo" : "arriba" });

  const origen: OrigenClip = {
    fuente: fuente.id,
    url: fuente.info.url,
    titulo: fuente.info.titulo,
    canal: fuente.info.canal,
    plataforma: fuente.info.plataforma,
    inicio: d.inicio,
    fin: d.fin,
    encuadre,
    reencuadre: resumen,
    credito: credito(fuente.info),
    campania: d.campania,
  };
  const proyecto = validarProyecto({
    schemaVersion: SCHEMA_VERSION,
    id: d.proyectoId,
    nombre: d.nombre,
    tema: d.tema,
    formato: d.formato,
    plantilla: d.plantilla.slug,
    fps: 30,
    voz: { ...d.plantilla.datos.voz, idioma: d.idioma },
    guion: { texto: Object.values(escenas).map((e) => e.texto).join(" ") },
    mostrar: [...d.plantilla.datos.mostrar, ...mascaraInsultos()],
    assets,
    pistas: [
      { id: "visual", tipo: "video", clips: clipsVisual },
      { id: "voz", tipo: "audio", clips: clipsVoz },
    ],
    textos,
    escenas,
    marcadores: tramos.slice(1).map((t, i) => ({ id: `m${i + 1}`, tiempo: t.inicio, nombre: `Corte ${i + 1}`, tipo: "corte" as const })),
    origen: { clip: origen },
    // En react la etiqueta de arriba taparía la cara: la marca queda en la tarjeta final.
    marca: encuadre !== "react",
  });
  await escribirAtomico(path.join(ctx.dir, "assets", "origen-clip.json"), JSON.stringify(origen, null, 1));
  const version = await guardarProyecto(d.proyectoId, proyecto, `Clip de ${fuente.info.canal ?? fuente.info.titulo} (${d.inicio.toFixed(0)}–${d.fin.toFixed(0)} s)`);
  await registrarAssetsEnDb(d.proyectoId, proyecto);
  ctx.log(`Importado: ${tramos.length} escenas, ${enVentana.length} palabras, ${total.toFixed(1)} s, encuadre ${encuadre}, versión ${version}`);
  return { version, escenas: tramos.length, encuadre };
}
