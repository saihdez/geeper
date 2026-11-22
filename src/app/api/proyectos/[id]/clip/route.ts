import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb } from "@/lib/almacen";
import { conFocos } from "@/lib/caras";
import { db } from "@/lib/db";
import { aplicarEdicion, registrarAsset, reemplazarVisual } from "@/lib/ediciones";
import { json, manejar } from "@/lib/http";
import { LICENCIAS } from "@/lib/licencias";
import { borrarRecibidos, recibirMultipart, type ArchivoRecibido } from "@/lib/multipart-flujo";
import { detectarMezcla } from "@/lib/mezcla-auto";
import { versionDeProyecto } from "@/lib/render";
import { dirProyecto, VECTORCRAFT_VERSION } from "@/lib/rutas";
import { MAX_SVG, revisarSvg } from "@/lib/svg";
import { aSvg, esVector } from "@/lib/vectorcraft";

const IMAGEN = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);
const VIDEO = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);
const MAX = 2 * 1024 ** 3;
/** Lo que el formulario agrega al archivo (separadores y los otros campos). */
const MARGEN = 1024 ** 2;

/**
 * Sube un archivo propio (video, imagen o audio) y:
 *  - con `escena`: reemplaza el clip visual de esa escena,
 *  - con `pista` e `inicio`: lo agrega a una pista libre (superposición de video o efecto de sonido)
 *    en ese segundo de la línea de tiempo, con la licencia que diga `licencia` (por defecto, propia).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const dir = dirProyecto(fila.slug);
    if (Number(req.headers.get("content-length") ?? 0) > MAX + MARGEN) throw new Error("El archivo pasa de 2 GB");
    // SRV-01: el archivo llega en flujo a un temporal dentro de assets/ (nunca entero en memoria) y el tope se
    // mira mientras llega. El formato se revisa con el nombre, antes de escribir nada.
    const { campos, archivos } = await recibirMultipart(req, {
      dir: path.join(dir, "assets"),
      archivo: (campo, nombre) => {
        if (campo !== "archivo") return null;
        const e = path.extname(nombre).toLowerCase();
        const vec = esVector(nombre);
        if (!vec && !IMAGEN.has(e) && !VIDEO.has(e) && !AUDIO.has(e)) throw new Error(`Formato no admitido: ${e || "sin extensión"}`);
        return e === ".svg" || vec ? { tope: MAX_SVG, mensaje: "El archivo pasa de 20 MB: expórtalo más liviano" } : { tope: MAX, mensaje: "El archivo pasa de 2 GB" };
      },
    });
    try {
      return await usarClip(req, id, fila.slug, dir, campos, archivos.find((a) => a.campo === "archivo"));
    } finally {
      await borrarRecibidos(archivos); // lo que no se usó (si se usó, ya se renombró y esto no hace nada)
    }
  });
}

async function usarClip(req: Request, id: string, slug: string, dir: string, form: Map<string, string>, archivo: ArchivoRecibido | undefined) {
  const escena = form.get("escena") ?? "";
  const pista = form.get("pista") ?? "";
  if (!archivo || !archivo.bytes) throw new Error("Falta el archivo");
  // Un logo de Illustrator, PDF, EPS o Affinity entra como SVG (lo convierte VectorCraft).
  const vector = esVector(archivo.nombre);
  let ext = path.extname(archivo.nombre).toLowerCase();
  const libre = Boolean(pista);
  if (!vector && !IMAGEN.has(ext) && !VIDEO.has(ext) && !(libre && AUDIO.has(ext))) throw new Error(`Formato no admitido: ${ext || "sin extensión"}`);
  if (!libre && !escena) throw new Error("Falta la escena o la pista");
  const licencia = (form.get("licencia") ?? "").trim() || LICENCIAS.archivo!;
  // SVG y logos vectoriales (hasta 20 MB) sí se leen: hay que revisarlos o convertirlos.
  let datos: Buffer | null = ext === ".svg" || vector ? await fs.readFile(archivo.ruta) : null;
  let avisosVector: string[] = [];
  if (vector && datos) {
    const r = await aSvg(datos, archivo.nombre);
    datos = r.svg;
    avisosVector = r.avisos;
    ext = ".svg";
  }
  // Antes de guardar nada: un SVG con scripts o referencias externas no entra al proyecto.
  if (ext === ".svg" && datos) revisarSvg(datos.toString("utf8"));
  const hash = datos ? createHash("sha256").update(datos).digest("hex") : archivo.sha256;
  const assetId = `subido-${hash.slice(0, 12)}`;
  const ruta = `assets/${assetId}${ext}`;
  if (datos) {
    const tmp = path.join(dir, `${ruta}.tmp`);
    await fs.writeFile(tmp, datos);
    await fs.rename(tmp, path.join(dir, ruta));
  } else {
    await fs.rename(archivo.ruta, path.join(dir, ruta));
  }
  const asset = await describirAsset(dir, ruta, {
    id: assetId,
    tipo: IMAGEN.has(ext) ? "imagen" : AUDIO.has(ext) ? "audio" : "video",
    source: "archivo",
    licencia,
    regenerar: { nombreOriginal: archivo.nombre, ...(vector ? { convertido: `VectorCraft ${VECTORCRAFT_VERSION} (texto en contornos)` } : {}) },
  });
  const { p } = await versionDeProyecto(id);
  let nuevo;
  let nota = "";
  if (libre) {
    const inicio = Number(form.get("inicio") ?? 0);
    const duracion = form.get("duracion") ? Number(form.get("duracion")) : undefined;
    // Superposición: mezcla elegida sola (fondo negro → Aclarar, blanco → Oscurecer); se cambia en la UI.
    const mezcla = asset.tipo !== "audio" ? await detectarMezcla(path.join(dir, ruta), asset.tipo === "video") : null;
    nuevo = aplicarEdicion(registrarAsset(p, asset), {
      tipo: "agregarClipLibre", pista, asset: assetId, inicio, duracion, desde: 0,
      volumen: asset.tipo === "audio" ? 1 : undefined,
      transicion: asset.tipo !== "audio" ? { tipo: "fundido", duracion: 0.3 } : undefined,
      fusion: mezcla?.fusion,
    });
    nota = `${asset.tipo === "audio" ? "Efecto de sonido" : "Superposición"} en ${pista} (${inicio.toFixed(1)} s): ${archivo.nombre}` +
      (mezcla && mezcla.mezcla !== "normal" ? ` · mezcla automática: ${mezcla.mezcla} (${mezcla.motivo})` : "");
  } else {
    nuevo = reemplazarVisual(p, escena, asset);
    nota = `Clip propio en ${escena}: ${archivo.nombre}`;
  }
  // Reencuadre: busca la cara del clip nuevo (unos segundos en CPU; si falla, queda sin foco).
  if (asset.tipo !== "audio") nuevo = (await conFocos({ dir, log: (l) => console.log(`[clip ${slug}] ${l}`) }, nuevo, { ids: [assetId], signal: req.signal })).p;
  if (vector) nota += " · convertido a SVG";
  const n = await guardarProyecto(id, nuevo, nota);
  await registrarAssetsEnDb(id, nuevo);
  return json({ version: n, asset: assetId, ...(avisosVector.length ? { avisos: avisosVector } : {}) }, 201);
}
