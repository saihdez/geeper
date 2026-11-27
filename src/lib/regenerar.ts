/**
 * Regenerar la voz de una escena o del guion completo con Kokoro (CPU) y realinear los subtítulos con
 * whisper. Sólo se rehace lo que cambió: la síntesis y la alineación son pasos con manifiesto.
 */
import path from "node:path";
import { describirAsset, guardarEncima, leerGuardado, registrarAssetsEnDb } from "./almacen";
import { sha256Texto } from "./archivos";
import { pista, validarProyecto, type Asset, type Escena, type Palabra, type Proyecto } from "./esquema";
import { limpiarAssets } from "./ediciones";
import { LICENCIAS } from "./licencias";
import { escenasEnLinea } from "./linea";
import { paso, type Contexto } from "./pasos";
import { crearAudio, esperarAudio } from "./mpt";
import { correr } from "./proceso";
import { HYPERFRAMES_VERSION, MPT_CONTENEDOR, MPT_TAREAS } from "./rutas";
import { huellaPesos } from "./modelos";
import { LICENCIA_VOXCPM, sintetizarVoxcpm } from "./voces";
import { alinearVozNueva, MODELO_WHISPER, noSeAcomoda, sintetizar, type ProblemaVoz } from "./voz";

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

/** Voz de Kokoro para `texto` con la voz del proyecto (`p.voz`), como asset con sus palabras alineadas. */
export async function sintetizarAsset(
  ctx: Contexto & { signal?: AbortSignal },
  p: Pick<Proyecto, "voz">,
  texto: string,
  o: { revisar?: (palabras: Palabra[], dur: number) => ProblemaVoz | null; escena?: number } = {},
) {
  const { motor, voz, velocidad, idioma } = p.voz;
  const clave = sha256Texto(JSON.stringify({ texto, motor, voz, velocidad })).slice(0, 12);
  const id = `voz-tts-${clave}`;
  const ruta = `assets/${id}${motor === "mpt" ? ".mp3" : ".wav"}`;
  const r = await paso(
    ctx,
    "voz.sintetizar",
    { archivos: [], params: { texto, motor, voz, velocidad }, motor: motor === "mpt" ? "mpt-api-audio+kokoro-82m" : motor === "voxcpm" ? "voxcpm2+atempo" : `hyperframes@${HYPERFRAMES_VERSION}+kokoro-82m` },
    [path.join(ctx.dir, ruta)],
    async ([tmp]) => {
      if (motor === "mpt") {
        // Kokoro de MPT (CPU): misma voz y mismo ritmo que el short original.
        const taskId = await crearAudio(texto, voz, velocidad, idioma === "es" ? "es-ES" : idioma);
        ctx.log(`MPT /audio: tarea ${taskId}`);
        await esperarAudio(taskId, ctx.signal);
        await correr("docker", ["cp", `${MPT_CONTENEDOR}:${MPT_TAREAS}/${taskId}/audio.mp3`, tmp!], { log: ctx.log });
        return { id, tareaMpt: taskId };
      }
      if (motor === "voxcpm") {
        // Voz diseñada de la biblioteca (GPU, espera su turno en el gpu-lock).
        await sintetizarVoxcpm(ctx, texto, voz, velocidad, tmp!);
        return { id, tareaMpt: null };
      }
      await sintetizar(texto, voz, velocidad, tmp!, ctx.log);
      return { id, tareaMpt: null };
    },
  );
  const asset = await describirAsset(ctx.dir, ruta, {
    id,
    tipo: "audio",
    source: "tts",
    licencia: motor === "voxcpm" ? LICENCIA_VOXCPM : LICENCIAS.kokoro!,
    regenerar: {
      motor, voz, velocidad, texto, modelo: motor === "voxcpm" ? "voxcpm2" : "kokoro-82m", tareaMpt: r.resultado.tareaMpt,
      // El Kokoro de MPT vive en su contenedor: sólo se conoce la huella de los pesos locales.
      pesos: motor === "kokoro" ? await huellaPesos("kokoro-82m-onnx") : null,
      alineacion: { modelo: `whisper-${MODELO_WHISPER}`, pesos: await huellaPesos(`whisper-${MODELO_WHISPER}`) },
    },
  });
  const palabras = await alinearVozNueva(ctx, path.join(ctx.dir, ruta), texto, p.voz.idioma, o);
  return { asset, palabras };
}

/**
 * Lo que la voz nueva tiene que decir: las palabras de la escena menos las recortadas por la edición
 * por texto (palabras o muletillas; los silencios no cambian el texto).
 */
export function textoADecir(e: Escena): string {
  const quitados = e.recortes.filter((r) => r.motivo !== "silencio");
  if (!quitados.length) return e.texto;
  return e.palabras
    .filter((w) => {
      const medio = (w.inicio + w.fin) / 2;
      return !quitados.some((r) => medio >= r.inicio && medio <= r.fin);
    })
    .map((w) => w.texto)
    .join(" ");
}

/** Conserva las correcciones si la escena sigue teniendo exactamente las mismas palabras. */
function conservarCorrecciones(e: Escena, nuevas: Palabra[]): Escena["correcciones"] {
  const igual = e.palabras.length === nuevas.length && e.palabras.every((w, i) => w.texto === nuevas[i]!.texto);
  return igual ? e.correcciones : [];
}

/** Lo que dijo la voz nueva de cada escena (para comprobar al guardar que no cambió mientras tanto). */
export interface Dicho {
  escena: string;
  palabras: string[];
}

const cambio = (que: string) =>
  new Error(`Mientras se hacía la voz nueva ${que}: no la puse para no borrar tu cambio. Vuelve a pedir la voz.`);

/** Pone la voz nueva de UNA escena sobre `base` (la versión de ahora). Lanza si la escena cambió. */
export function ponerVozEscena(base: Proyecto, dicho: Dicho, asset: Asset, palabras: Palabra[]): Proyecto {
  const p = structuredClone(base);
  const e = p.escenas[dicho.escena];
  const voz = pista(p, "voz").clips;
  const visual = pista(p, "visual").clips;
  const i = voz.findIndex((c) => c.escena === dicho.escena);
  if (!e || i < 0) throw cambio("se quitó la escena");
  if (tokens(textoADecir(e)).join(" ") !== dicho.palabras.join(" ")) throw cambio(`cambió lo que dice la escena ${i + 1}`);
  const j = visual.findIndex((c) => c.escena === dicho.escena);
  const k = j >= 0 ? j : i;
  p.assets[asset.id] = asset;
  const dur = asset.duracion!;
  voz[i] = { ...voz[i]!, asset: asset.id, rango: { inicio: 0, duracion: dur } };
  visual[k] = { ...visual[k]!, rango: { inicio: visual[k]!.rango.inicio, duracion: dur } };
  e.correcciones = conservarCorrecciones(e, palabras);
  e.palabras = palabras;
  e.texto = palabras.map((w) => w.texto).join(" ");
  // Los recortes eran tiempos de la voz anterior: la nueva ya no dice lo recortado.
  e.recortes = [];
  return validarProyecto(limpiarAssets(p));
}

/**
 * Dónde termina cada escena en la voz del guion completo: a mitad de la pausa entre la última palabra de
 * una y la primera de la siguiente. `cuentas`: cuántas palabras dice cada escena.
 */
export function repartirGuion(palabras: Palabra[], cuentas: number[], dur: number): { limites: number[]; tramos: Palabra[][] } {
  let k = 0;
  const limites: number[] = [0];
  const tramos: Palabra[][] = [];
  for (const [j, n] of cuentas.entries()) {
    tramos.push(palabras.slice(k, k + n));
    k += n;
    if (j < cuentas.length - 1) {
      const ultima = palabras[k - 1];
      const siguiente = palabras[k];
      const corte = ultima && siguiente ? (ultima.fin + Math.max(ultima.fin, siguiente.inicio)) / 2 : limites[limites.length - 1]!;
      limites.push(Math.max(limites[limites.length - 1]! + 0.05, corte));
    }
  }
  limites.push(dur);
  return { limites, tramos };
}

/** Lo menos que puede durar una escena con la voz nueva (REN-05: quedó una de 0,05 s sin subtítulos). */
export const MIN_ESCENA = 0.2;

/** Escena (1, 2…) que con estos límites duraría menos de MIN_ESCENA, o null. */
export function escenaMuyCorta(limites: number[]): number | null {
  for (let j = 0; j + 1 < limites.length; j++) if (limites[j + 1]! - limites[j]! < MIN_ESCENA) return j + 1;
  return null;
}

/** Pone la voz nueva del guion completo sobre `base` (la versión de ahora). Lanza si el guion cambió. */
export function ponerVozGuion(base: Proyecto, dichos: Dicho[], asset: Asset, palabras: Palabra[]): Proyecto {
  const p = structuredClone(base);
  const orden = escenasEnLinea(p);
  const distinta = orden.findIndex((x, j) => x.escena.id !== dichos[j]?.escena || tokens(textoADecir(x.escena)).join(" ") !== dichos[j]!.palabras.join(" "));
  if (orden.length !== dichos.length || distinta >= 0) throw cambio(distinta >= 0 ? `cambió la escena ${distinta + 1}` : "cambiaron las escenas");
  const cuentas = dichos.map((d) => d.palabras.length);
  const total = cuentas.reduce((a, b) => a + b, 0);
  if (palabras.length !== total) throw new Error(`La alineación devolvió ${palabras.length} palabras y el guion tiene ${total}`);
  p.assets[asset.id] = asset;
  const voz = pista(p, "voz").clips;
  const visual = pista(p, "visual").clips;
  const { limites, tramos } = repartirGuion(palabras, cuentas, asset.duracion!);
  const corta = escenaMuyCorta(limites);
  if (corta !== null) throw new Error(noSeAcomoda(corta));
  orden.forEach((x, j) => {
    const ini = limites[j]!;
    const fin = Math.max(ini + 0.05, limites[j + 1]!);
    voz[j] = { ...voz[j]!, asset: asset.id, rango: { inicio: ini, duracion: fin - ini } };
    visual[j] = { ...visual[j]!, rango: { inicio: visual[j]!.rango.inicio, duracion: fin - ini } };
    const e = p.escenas[x.escena.id]!;
    e.correcciones = conservarCorrecciones(e, tramos[j]!);
    e.palabras = tramos[j]!;
    e.texto = tramos[j]!.map((w) => w.texto).join(" ");
    e.recortes = [];
  });
  p.guion.texto = dichos.map((d) => d.palabras.join(" ")).join(" ");
  return validarProyecto(limpiarAssets(p));
}

/**
 * Voz nueva de una escena (`escenaId`) o del guion completo (null). Se genera con lo que dice `original`
 * y, al terminar, se pone sobre la versión de AHORA (SEG-05): lo que la persona editó mientras tanto
 * (30–50 s) se conserva. Si cambió justo lo que dice la voz, no se guarda y se avisa.
 */
export async function regenerarVoz(
  ctx: Contexto & { signal?: AbortSignal },
  proyectoId: string,
  original: Proyecto,
  escenaId: string | null,
): Promise<{ version: number; asset: string }> {
  const p = structuredClone(original);
  const voz = pista(p, "voz").clips;
  if (voz.some((c) => p.assets[c.asset]?.regenerar.origen === "clip")) {
    throw new Error("Este proyecto es un clip: la voz es la del creador y no se regenera. Corrige subtítulos o recorta palabras.");
  }
  // Lo guardado al empezar: si nadie guarda nada mientras tanto, se pone sobre `original` (traducir pasa
  // una copia con cambios suyos todavía sin guardar).
  const guardada = await leerGuardado(proyectoId);
  let aplicar: (base: Proyecto) => Proyecto;
  if (escenaId) {
    const e = p.escenas[escenaId];
    if (!e) throw new Error(`No existe la escena ${escenaId}`);
    const dicho = { escena: escenaId, palabras: tokens(textoADecir(e)) };
    if (!dicho.palabras.length) throw new Error("La escena no tiene texto para decir");
    const numero = escenasEnLinea(p).findIndex((x) => x.escena.id === escenaId) + 1;
    const { asset, palabras } = await sintetizarAsset(ctx, p, dicho.palabras.join(" "), { escena: numero || undefined });
    aplicar = (base) => ponerVozEscena(base, dicho, asset, palabras);
  } else {
    // Guion completo: el texto de las escenas actuales (sin lo recortado), en orden. Cada escena
    // conserva su tramo de palabras.
    const dichos = escenasEnLinea(p).map((x) => ({ escena: x.escena.id, palabras: tokens(textoADecir(x.escena)) }));
    const cuentas = dichos.map((d) => d.palabras.length);
    const revisar = (palabras: Palabra[], dur: number) => {
      const n = palabras.length === cuentas.reduce((a, b) => a + b, 0) ? escenaMuyCorta(repartirGuion(palabras, cuentas, dur).limites) : null;
      return n === null ? null : { problema: `la escena ${n} quedaría de menos de ${MIN_ESCENA} s`, escena: n };
    };
    const { asset, palabras } = await sintetizarAsset(ctx, p, dichos.map((d) => d.palabras.join(" ")).join(" "), { revisar });
    aplicar = (base) => ponerVozGuion(base, dichos, asset, palabras);
  }
  // Antes de guardar, sobre la copia del trabajo: un error propio (p. ej. la alineación) sale tal cual.
  const nuevo = aplicar(p);
  let final = nuevo;
  const version = await guardarEncima(
    proyectoId,
    escenaId ? `Voz regenerada: escena ${escenaId}` : "Voz regenerada: guion completo",
    (base) => (final = aplicar(base)),
    { guardada, copia: p },
  );
  await registrarAssetsEnDb(proyectoId, final);
  const id = Object.values(nuevo.assets).find((a) => a.source === "tts" && pista(nuevo, "voz").clips.some((c) => c.asset === a.id))?.id;
  return { version, asset: id ?? "" };
}
