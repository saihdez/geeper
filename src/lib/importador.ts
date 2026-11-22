/**
 * Importador MPT → geeper.json (la parte de «copiar y alinear» de mpt_acabado.py):
 *  1. copia la tarea de MPT con `docker cp` (storage/tasks es de root: nunca chmod/chown),
 *  2. copia los clips en el orden de `material_sources` y la voz, con su procedencia y licencia,
 *  3. transcribe la voz con whisper `medium` y alinea los tiempos con el texto del guion,
 *  4. corta en escenas (en los cortes de clip, ajustados a pausas), elige la música de la plantilla,
 *  5. guarda geeper.json como una Version nueva.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb, crearCarpetas } from "./almacen";
import { existe, escribirAtomico, sha256Archivo } from "./archivos";
import { SCHEMA_VERSION, validarProyecto, type Asset, type Escena, type Palabra, type Proyecto } from "./esquema";
import { licenciaImagenMpt, LICENCIAS } from "./licencias";
import { probar } from "./media";
import { paso, type Contexto } from "./pasos";
import type { DatosPlantilla } from "./plantillas";
import { correr } from "./proceso";
import { HYPERFRAMES_VERSION, MPT_CONTENEDOR, MPT_TAREAS } from "./rutas";
import { segmentar } from "./segmentar";
import { detectarSilencios, puntuarPalabras, resumirConfianza } from "./confianza";
import { aplicarEdicion } from "./ediciones";
import { conFocos, marcarAuto } from "./caras";
import { proponerMusica } from "./pulsos";
import { etiquetaPesos, huellaPesos } from "./modelos";
import { alinear, MODELO_WHISPER, motorTranscripcion, transcribir } from "./voz";

interface ScriptMpt {
  script: string;
  search_terms?: string[];
  params?: Record<string, unknown>;
  material_sources?: { provider?: string; local_file: string; duration?: number; search_term?: string }[];
}

/**
 * MPT termina con éxito aunque falle la mayoría de las imágenes (p. ej. si la GPU se cae a mitad: el
 * 2026-11-18 entregó 1 de 5 y repitió esa imagen 47 s). Si llegó menos del 60 % de lo pedido, no se
 * importa: el short saldría pobre sin que nadie lo note. Devuelve el motivo o null.
 */
export function imagenesFaltantes(pedidas: number, recibidas: number): string | null {
  if (pedidas < 2 || recibidas >= Math.ceil(pedidas * 0.6)) return null;
  return `MPT entregó ${recibidas} de ${pedidas} imágenes (las demás fallaron al generarse; suele ser la GPU o el servidor de imágenes). ` +
    "Revisa `docker logs mpt-image-server` y vuelve a generar el tema.";
}

export interface DatosImport {
  proyectoId: string;
  slug: string;
  nombre: string;
  tema: string;
  formato: Proyecto["formato"];
  plantilla: { slug: string; datos: DatosPlantilla };
  taskId: string;
  modeloImagen?: string;
}

/** Copia la tarea de MPT a <proyecto>/mpt/<task_id>/ (temporal + rename). Se salta si ya está. */
export async function copiarTareaMpt(ctx: Contexto, taskId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(taskId)) throw new Error(`task_id inválido: ${taskId}`);
  const destino = path.join(ctx.dir, "mpt", taskId);
  if ((await existe(path.join(destino, "script.json"))) && (await existe(path.join(destino, "final-1.mp4")))) {
    ctx.log(`· tarea MPT ${taskId} ya copiada, se salta`);
    return destino;
  }
  const tmp = `${destino}.tmp-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  await correr("docker", ["cp", `${MPT_CONTENEDOR}:${MPT_TAREAS}/${taskId}/.`, tmp], { log: ctx.log });
  await fs.rm(destino, { recursive: true, force: true });
  await fs.rename(tmp, destino);
  return destino;
}

async function copiarSiCambia(origen: string, destino: string): Promise<void> {
  if ((await existe(destino)) && (await sha256Archivo(destino)) === (await sha256Archivo(origen))) return;
  const tmp = `${destino}.tmp`;
  await fs.copyFile(origen, tmp);
  await fs.rename(tmp, destino);
}

/** Elige una pista de la carpeta de música de la plantilla, estable por proyecto. */
export async function elegirMusica(
  ctx: Contexto,
  proyectoId: string,
  musica: DatosPlantilla["musica"],
): Promise<Asset | null> {
  if (!musica.carpeta) return null;
  let archivos: string[];
  try {
    archivos = (await fs.readdir(musica.carpeta)).filter((f) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f)).sort();
  } catch {
    ctx.log(`Aviso: no pude leer la carpeta de música ${musica.carpeta}; sigo sin música`);
    return null;
  }
  if (!archivos.length) return null;
  const n = parseInt(createHash("sha256").update(proyectoId).digest("hex").slice(0, 8), 16) % archivos.length;
  const elegido = archivos[n]!;
  const ruta = `assets/musica${path.extname(elegido).toLowerCase()}`;
  await copiarSiCambia(path.join(musica.carpeta, elegido), path.join(ctx.dir, ruta));
  return describirAsset(ctx.dir, ruta, {
    id: "musica",
    tipo: "audio",
    source: "archivo",
    licencia: musica.licencia,
    regenerar: { archivoOriginal: path.join(musica.carpeta, elegido) },
  });
}

/**
 * Tiempos por palabra de un audio de voz, alineados al texto y con su confianza (paso con manifiesto).
 * La huella del paso incluye el sha256 de los pesos de whisper: otro modelo es otra alineación.
 */
export async function tiemposDeVoz(ctx: Contexto, rutaVoz: string, texto: string, idioma: string): Promise<Palabra[]> {
  const dur = (await probar(rutaVoz)).duracion;
  const salida = path.join(ctx.dir, "assets", `palabras-${path.parse(rutaVoz).name}.json`);
  const pesos = await etiquetaPesos(`whisper-${MODELO_WHISPER}`);
  await paso(
    ctx,
    "voz.alinear",
    { archivos: [rutaVoz], params: { texto, idioma, modelo: MODELO_WHISPER }, motor: `hyperframes@${HYPERFRAMES_VERSION}+alinear-v2+${await motorTranscripcion()}+${pesos}` },
    [salida],
    async ([tmp]) => {
      const w = await transcribir(rutaVoz, idioma, ctx.log);
      const alineadas = await alinear(texto, w, dur);
      const palabras = puntuarPalabras(alineadas, w, await detectarSilencios(rutaVoz));
      const r = resumirConfianza([{ id: "voz", palabras }]);
      if (r.dudosas) ctx.log(`Aviso: ${r.dudosas} de ${r.medidas} palabras con tiempos dudosos (${(r.proporcion * 100).toFixed(0)} %)`);
      await fs.writeFile(tmp!, JSON.stringify(palabras));
      return { palabras: palabras.length, whisper: w.length, dudosas: r.dudosas };
    },
  );
  return JSON.parse(await fs.readFile(salida, "utf8")) as Palabra[];
}

export async function importarMpt(ctx: Contexto, d: DatosImport): Promise<{ version: number; escenas: number }> {
  await crearCarpetas(d.slug);
  const crudo = await copiarTareaMpt(ctx, d.taskId);
  const script = JSON.parse(await fs.readFile(path.join(crudo, "script.json"), "utf8")) as ScriptMpt;
  const fuentes = script.material_sources ?? [];
  if (!fuentes.length || !(await existe(path.join(crudo, "audio.mp3")))) {
    throw new Error("La tarea de MPT no tiene material_sources o audio.mp3: genera el video completo en MPT primero.");
  }
  const faltan = imagenesFaltantes(script.search_terms?.length ?? 0, fuentes.length);
  if (faltan) throw new Error(faltan);
  const assets: Record<string, Asset> = {};

  // Clips en el orden de material_sources.
  const clips: Asset[] = [];
  for (const [i, f] of fuentes.entries()) {
    const id = `clip-${String(i + 1).padStart(2, "0")}`;
    const ruta = `assets/${id}.mp4`;
    await copiarSiCambia(path.join(crudo, f.local_file), path.join(ctx.dir, ruta));
    const a = await describirAsset(ctx.dir, ruta, {
      id,
      tipo: "video",
      source: "mpt",
      licencia: licenciaImagenMpt(d.modeloImagen),
      regenerar: {
        tareaMpt: d.taskId,
        archivoMpt: f.local_file,
        proveedor: f.provider ?? null,
        prompt: f.search_term ?? null,
        modelo: d.modeloImagen ?? null,
        movimiento: script.params?.image_motion ?? null,
      },
    });
    assets[id] = a;
    clips.push(a);
  }

  // Voz de MPT (Kokoro).
  const rutaVoz = "assets/voz-mpt.mp3";
  await copiarSiCambia(path.join(crudo, "audio.mp3"), path.join(ctx.dir, rutaVoz));
  const voz = await describirAsset(ctx.dir, rutaVoz, {
    id: "voz-mpt",
    tipo: "audio",
    source: "mpt",
    licencia: LICENCIAS.kokoro!,
    regenerar: {
      tareaMpt: d.taskId,
      motor: "mpt",
      voz: script.params?.voice_name ?? d.plantilla.datos.mpt.voice_name,
      velocidad: script.params?.voice_rate ?? 1,
      texto: script.script,
      modelo: "kokoro-82m",
      alineacion: { modelo: `whisper-${MODELO_WHISPER}`, pesos: await huellaPesos(`whisper-${MODELO_WHISPER}`) },
    },
  });
  assets[voz.id] = voz;
  const durVoz = voz.duracion ?? (await probar(path.join(ctx.dir, rutaVoz))).duracion;

  const palabras = await tiemposDeVoz(ctx, path.join(ctx.dir, rutaVoz), script.script, d.plantilla.datos.voz.idioma);
  const cada = Number(script.params?.video_clip_duration ?? d.plantilla.datos.mpt.video_clip_duration) || 6;
  const tramos = segmentar(palabras, durVoz, cada);

  const escenas: Record<string, Escena> = {};
  const clipsVoz = [];
  const clipsVisual = [];
  for (const [i, t] of tramos.entries()) {
    const id = `e${String(i + 1).padStart(2, "0")}`;
    escenas[id] = { id, texto: t.palabras.map((w) => w.texto).join(" "), palabras: t.palabras, correcciones: [], recortes: [] };
    clipsVoz.push({ id: `voz-${id}`, asset: voz.id, escena: id, rango: { inicio: t.inicio, duracion: t.fin - t.inicio } });
    const c = clips[i % clips.length]!;
    clipsVisual.push({
      id: `vis-${id}`,
      asset: c.id,
      escena: id,
      rango: { inicio: 0, duracion: t.fin - t.inicio },
    });
  }

  const musica = await elegirMusica(ctx, d.proyectoId, d.plantilla.datos.musica);
  const pistas: Proyecto["pistas"] = [
    { id: "visual", tipo: "video", clips: clipsVisual },
    { id: "voz", tipo: "audio", clips: clipsVoz },
  ];
  if (musica) {
    assets[musica.id] = musica;
    pistas.push({
      id: "musica",
      tipo: "audio",
      clips: [{ id: "musica-1", asset: musica.id, rango: { inicio: 0, duracion: musica.duracion ?? 60 }, volumen: d.plantilla.datos.musica.volumen }],
    });
  }

  const proyecto = validarProyecto({
    schemaVersion: SCHEMA_VERSION,
    id: d.proyectoId,
    nombre: d.nombre,
    tema: d.tema,
    formato: d.formato,
    plantilla: d.plantilla.slug,
    fps: 30,
    voz: { ...d.plantilla.datos.voz },
    guion: { texto: script.script },
    mostrar: d.plantilla.datos.mostrar,
    assets,
    pistas,
    escenas,
    // Proyectos nuevos: movimiento de cámara con Easy Ease (los viejos siguen como estaban).
    estilo: { curva: "suave" },
    marcadores: tramos.slice(1).map((t, i) => ({ id: `m${i + 1}`, tiempo: t.inicio, nombre: `Corte ${i + 1}`, tipo: "corte" as const })),
    origen: { mpt: { taskId: d.taskId, searchTerms: script.search_terms ?? [], params: script.params ?? {} } },
  });
  await escribirAtomico(path.join(ctx.dir, "mpt", `${d.taskId}.palabras.json`), JSON.stringify(palabras));
  // Reencuadre: dónde está la cara de cada clip (YuNet, CPU). Si falla, sigue sin foco.
  let final = (await conFocos(ctx, proyecto)).p;
  await marcarAuto(ctx.dir); // nace analizado: abrirlo no vuelve a cambiar el encuadre
  // Música al ritmo: si la pista tiene pulso estable, empieza donde más cortes caen en pulso.
  if (musica) {
    try {
      const prop = await proponerMusica(final, ctx.dir);
      if (prop?.despues) {
        final = aplicarEdicion(final, prop.edicion);
        ctx.log(`Música: ${prop.bpm ?? "?"} BPM, empieza en ${prop.edicion.inicio.toFixed(2)} s; cortes en pulso ${prop.despues.enPulso}/${prop.despues.cortes}`);
      } else ctx.log("Música sin pulso estable: no se alinean los cortes");
    } catch (e) {
      ctx.log(`Aviso: no pude detectar los pulsos de la música (${(e as Error).message}); sigo sin alinear`);
    }
  }
  const version = await guardarProyecto(d.proyectoId, final, `Importado de MPT (${d.taskId.slice(0, 8)})`);
  await registrarAssetsEnDb(d.proyectoId, final);
  ctx.log(`Importado: ${tramos.length} escenas, ${palabras.length} palabras, voz ${durVoz.toFixed(1)} s, versión ${version}`);
  return { version, escenas: tramos.length };
}
