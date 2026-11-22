/**
 * «Nuevo → Desde una página web» (F4): de un link y lo que se quiere decir a un proyecto normal.
 *  0. que el link abra (hasta 10 s): un link mal escrito se descubre antes de esperar la voz,
 *  1. la voz primero (Kokoro de la plantilla), que da la duración exacta,
 *  2. la demo de la página con esa duración (demo-web-toma.ts: toma + tarjeta 3D o plana),
 *  3. geeper.json: escenas cortadas en pausas, la imagen de la demo en `sincro: "voz"` (recortar
 *     palabras corta también la imagen) y la licencia de la captura en «revisar» salvo que la persona
 *     diga que el sitio es suyo.
 * Después la cadena sigue con el render y el QC de siempre.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describirAsset, guardarProyecto, registrarAssetsEnDb, crearCarpetas } from "./almacen";
import { MAX_CARACTERES_DEMO, type EstiloDemo, type FormatoDemo, type Historia, type RegistroDemo } from "./demo-web";
import { probarLink, renderDemo, tomarDemo } from "./demo-web-toma";
import { SCHEMA_VERSION, validarProyecto, type Asset, type Escena, type Proyecto } from "./esquema";
import { huellaFfmpeg, probar } from "./media";
import { paso, type Contexto } from "./pasos";
import type { DatosPlantilla } from "./plantillas";
import { sintetizarAsset } from "./regenerar";
import { segmentar } from "./segmentar";

export interface DatosDemo {
  proyectoId: string;
  slug: string;
  nombre: string;
  tema: string;
  formato: FormatoDemo;
  plantilla: { slug: string; datos: DatosPlantilla };
  url: string;
  estilo: EstiloDemo;
  texto: string;
  historia?: Historia;
  /** La persona dice que el sitio es suyo (o tiene permiso): la captura queda con licencia propia. */
  propio?: boolean;
}

export async function importarDemo(ctx: Contexto & { signal?: AbortSignal; etapa?: (e: string, p: number) => Promise<void> }, d: DatosDemo) {
  const texto = d.texto.replace(/\s+/g, " ").trim();
  if (!texto) throw new Error("Escribe qué quieres que diga el video.");
  if (texto.length > MAX_CARACTERES_DEMO) throw new Error(`El texto es muy largo (${texto.length} caracteres; hasta ${MAX_CARACTERES_DEMO}, unos 45 s).`);
  if (!/^https?:\/\//i.test(d.url)) throw new Error("El link tiene que empezar con https://");
  // 0. Que el link abra (hasta 10 s), antes de esperar la voz (UX-17).
  await ctx.etapa?.("Probando que la página abre", 0.05);
  await probarLink(d.url, { log: ctx.log, signal: ctx.signal });
  await crearCarpetas(d.slug);

  // 1. Voz.
  await ctx.etapa?.("Generando la voz (Kokoro, CPU)", 0.1);
  const voz = { ...d.plantilla.datos.voz };
  const { asset: aVoz, palabras } = await sintetizarAsset(ctx, { voz }, texto);
  const durVoz = aVoz.duracion ?? (await probar(path.join(ctx.dir, aVoz.ruta))).duracion;
  ctx.log(`Voz: ${durVoz.toFixed(1)} s, ${palabras.length} palabras`);

  // 2. Demo de la página: un poco más larga que la voz (la tarjeta final y el aire del final).
  await ctx.etapa?.("Grabando la página y armando la demo (CPU, 2–4 min)", 0.3);
  const objetivo = Math.max(6, durVoz + 1.2);
  const dirDemo = path.join(ctx.dir, "assets", "demo");
  await fs.mkdir(dirDemo, { recursive: true });
  const rutaDemo = path.join(ctx.dir, "assets", "demo-web.mp4");
  await paso(
    ctx,
    "demo.web",
    { archivos: [], params: { url: d.url, formato: d.formato, estilo: d.estilo, historia: d.historia ?? null, objetivo: +objetivo.toFixed(2) }, motor: `demo-web-v1+${await huellaFfmpeg()}` },
    [rutaDemo],
    async ([tmp]) => {
      const r: RegistroDemo = await tomarDemo(d.url, dirDemo, { formato: d.formato, historia: d.historia, duracionMin: objetivo + 3.5, log: ctx.log, signal: ctx.signal });
      await ctx.etapa?.("Componiendo la demo (Hyperframes, CPU)", 0.6);
      const { montaje } = await renderDemo(dirDemo, r, { estilo: d.estilo, maximo: objetivo, salida: tmp!, log: ctx.log, signal: ctx.signal });
      return { historia: r.historia, cta: r.cta, total: montaje.total, titulo: r.titulo };
    },
  );
  const durDemo = (await probar(rutaDemo)).duracion;
  if (durDemo + 0.05 < durVoz) {
    throw new Error(`La página dio ${durDemo.toFixed(1)} s de imagen y la voz dura ${durVoz.toFixed(1)} s: acorta el texto o prueba con una página más larga.`);
  }

  // 3. Proyecto.
  const licencia = d.propio
    ? `propia: captura de ${d.url} (sitio propio o con permiso, según quien creó el proyecto)`
    : `revisar: captura de ${d.url}; publícala sólo si el sitio es tuyo o tienes permiso`;
  const aDemo = await describirAsset(ctx.dir, path.relative(ctx.dir, rutaDemo), {
    id: "demo-web",
    tipo: "video",
    source: "archivo",
    licencia,
    regenerar: { origen: "demo-web", url: d.url, formato: d.formato, estilo: d.estilo, historia: d.historia ?? null },
  });
  const assets: Record<string, Asset> = { [aVoz.id]: aVoz, [aDemo.id]: aDemo };
  const tramos = segmentar(palabras, durVoz, 8);
  const escenas: Record<string, Escena> = {};
  const clipsVoz = [];
  const clipsVisual = [];
  for (const [i, t] of tramos.entries()) {
    const id = `e${String(i + 1).padStart(2, "0")}`;
    escenas[id] = { id, texto: t.palabras.map((w) => w.texto).join(" "), palabras: t.palabras, correcciones: [], recortes: [] };
    const rango = { inicio: t.inicio, duracion: t.fin - t.inicio };
    clipsVoz.push({ id: `voz-${id}`, asset: aVoz.id, escena: id, rango });
    clipsVisual.push({ id: `vis-${id}`, asset: aDemo.id, escena: id, rango: { ...rango }, sincro: "voz" as const });
  }
  const proyecto: Proyecto = validarProyecto({
    schemaVersion: SCHEMA_VERSION,
    id: d.proyectoId,
    nombre: d.nombre,
    tema: d.tema,
    formato: d.formato,
    plantilla: d.plantilla.slug,
    fps: 30,
    voz,
    guion: { texto },
    mostrar: d.plantilla.datos.mostrar,
    assets,
    pistas: [
      { id: "visual", tipo: "video", clips: clipsVisual },
      { id: "voz", tipo: "audio", clips: clipsVoz },
    ],
    textos: [],
    escenas,
    marcadores: tramos.slice(1).map((t, i) => ({ id: `m${i + 1}`, tiempo: t.inicio, nombre: `Corte ${i + 1}`, tipo: "corte" as const })),
  });
  const version = await guardarProyecto(d.proyectoId, proyecto, `Demo de ${new URL(d.url).host}`);
  await registrarAssetsEnDb(d.proyectoId, proyecto);
  ctx.log(`Proyecto: ${tramos.length} escenas, voz ${durVoz.toFixed(1)} s, demo ${durDemo.toFixed(1)} s, versión ${version}`);
  return { version, escenas: tramos.length, voz: durVoz, demo: durDemo };
}
