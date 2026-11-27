/**
 * Paso «escenas.animar» de un video nuevo con estilo «Equilibrado» o «Máxima calidad»
 * (estilos-generacion.ts): después de importar lo de MPT (y de que el avatar entre en sus escenas), cada
 * escena que sigue siendo la imagen de MPT pasa a un plano de video con plano.ts, con el prompt del estilo.
 * Las que ya rehízo el avatar no se tocan. Con un estilo que no anima («Rápido»), cada foto pasa por la
 * cámara 3D (camara3d.ts) en vez del zoom plano; y si Wan falla en una escena, esa escena usa la cámara 3D
 * (decisión del dueño, 2026-11-25). Una escena que falla igual queda como estaba (se reintenta desde el
 * editor) y no tumba el video.
 *
 * El estilo elegido en «Nuevo» se guarda en la carpeta del proyecto (`generacion.json`), porque la cadena
 * de trabajos sólo lleva los pasos que faltan.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { guardarProyecto } from "./almacen";
import { EstiloGeneracion, ESTILOS_GENERACION } from "./estilos-generacion";
import type { Proyecto } from "./esquema";
import { escenasEnLinea } from "./linea";
import { faltaCamara3d, generarCamara3dEscena } from "./camara3d";
import { dirigir3d } from "./director3d";
import { generarPlanoEscena, planearPlano, type ContextoPlano } from "./plano";
import { versionDeProyecto } from "./render";
import { dirProyecto } from "./rutas";
import { animarDe, estiloVideoDe, promptSetup, SetupVideo } from "./setup-video";

/** Lo que se eligió en «Nuevo»: el preset y, si se personalizó, su setup. */
const Generacion = z.object({ estilo: EstiloGeneracion, setup: SetupVideo.optional() });
export type Generacion = z.infer<typeof Generacion>;
const rutaGeneracion = (slug: string) => path.join(dirProyecto(slug), "generacion.json");

export async function guardarEstiloGeneracion(slug: string, estilo: EstiloGeneracion, setup?: SetupVideo) {
  await fs.mkdir(dirProyecto(slug), { recursive: true });
  await fs.writeFile(rutaGeneracion(slug), JSON.stringify(Generacion.parse({ estilo, setup }), null, 2));
}

/** El setup guardado; los proyectos de antes (sólo el preset) usan el setup de su preset. */
export async function leerEstiloGeneracion(slug: string): Promise<{ estilo: EstiloGeneracion; setup: SetupVideo; personalizado: boolean } | null> {
  const g = await fs.readFile(rutaGeneracion(slug), "utf8").then((t) => Generacion.parse(JSON.parse(t)), () => null);
  if (!g) return null;
  return { estilo: g.estilo, setup: g.setup ?? ESTILOS_GENERACION[g.estilo].setup, personalizado: !!g.setup };
}

/** Escenas que siguen con la imagen de MPT (las que el avatar ya rehízo, no). Función pura. */
export function escenasParaAnimar(p: Proyecto): { escena: string; numero: number }[] {
  return escenasEnLinea(p)
    .filter((e) => p.assets[e.visual.asset]?.source === "mpt")
    .map((e) => ({ escena: e.escena.id, numero: e.indice + 1 }));
}

/** El proyecto con el acabado (grano, viñeta) del setup, sin duplicar ni borrar otros efectos. Función pura. */
export function conEstiloVideo(p: Proyecto, estilo: EstiloGeneracion | SetupVideo): Proyecto | null {
  const e = estiloVideoDe(typeof estilo === "string" ? ESTILOS_GENERACION[estilo].setup : estilo);
  if (!e?.efectos?.length) return null;
  const previos = (p.estilo?.efectos ?? []).filter((x) => !e.efectos!.some((y) => y.tipo === x.tipo));
  return { ...p, estilo: { ...p.estilo, efectos: [...previos, ...e.efectos] } };
}

export interface AvanceEscenas {
  numero: number;
  indice: number;
  total: number;
}

/** Anima las escenas del video con el setup guardado y le suma su acabado. Devuelve las que quedaron animadas. */
export async function animarEscenasDelVideo(ctx: ContextoPlano, proyectoId: string, slug: string, alEmpezar: (a: AvanceEscenas) => void | Promise<void>): Promise<{ estilo: EstiloGeneracion | null; hechas: number[] }> {
  const g = await leerEstiloGeneracion(slug);
  if (!g) return { estilo: null, hechas: [] };
  // «Todo en 3D»: el director arma cada escena en Blender (director3d.ts).
  if (g.estilo === "3d") {
    if (await faltaCamara3d()) {
      ctx.log("Sin Blender no se puede hacer «Todo en 3D»: las escenas quedan con sus imágenes (instálalo en Sistema).");
      return { estilo: g.estilo, hechas: [] };
    }
    return { estilo: g.estilo, hechas: await dirigir3d(ctx, proyectoId, slug, alEmpezar) };
  }
  const nombre = g.personalizado ? `${ESTILOS_GENERACION[g.estilo].nombre}, personalizado` : ESTILOS_GENERACION[g.estilo].nombre;
  let { p } = await versionDeProyecto(proyectoId);
  const conAcabado = conEstiloVideo(p, g.setup);
  if (conAcabado) {
    await guardarProyecto(proyectoId, conAcabado, `Setup «${nombre}»: acabado del video`);
    ({ p } = await versionDeProyecto(proyectoId));
  }
  const animar = animarDe(g.setup);
  const lista = escenasParaAnimar(p);
  const hechas: number[] = [];
  // Sin Blender no hay cámara 3D: las escenas quedan con el zoom de siempre (y Wan, si el estilo anima).
  const conCamara3d = !(await faltaCamara3d());
  const camara3d = async (x: { escena: string; numero: number }, motivo: string) => {
    if (!conCamara3d) return false;
    try {
      await generarCamara3dEscena({ ...ctx, avanzar: undefined }, proyectoId, p, x.escena, { nota: `Escena ${x.numero} con cámara 3D (${motivo})` });
      ({ p } = await versionDeProyecto(proyectoId));
      return true;
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      ctx.log(`Escena ${x.numero}: tampoco salió la cámara 3D (${e instanceof Error ? e.message.split("\n")[0] : e}).`);
      return false;
    }
  };
  if (!animar) {
    if (!conCamara3d) ctx.log("Sin Blender: las escenas quedan con el zoom de siempre (instálalo en Sistema para la cámara 3D).");
    for (const [i, x] of lista.entries()) {
      await alEmpezar({ numero: x.numero, indice: i, total: lista.length });
      if (await camara3d(x, `«${nombre}»`)) hechas.push(x.numero);
    }
    return { estilo: g.estilo, hechas };
  }
  for (const [i, x] of lista.entries()) {
    await alEmpezar({ numero: x.numero, indice: i, total: lista.length });
    try {
      const base = planearPlano(p, x.escena, { modelo: animar.modelo }).promptBase;
      const { prompt, negativo } = promptSetup(g.setup, base);
      await generarPlanoEscena(ctx, proyectoId, p, x.escena, {
        modelo: animar.modelo, prompt, negativo, camara: animar.camara, extra: animar.extra, nota: `Escena ${x.numero} animada («${nombre}»)`,
      });
      hechas.push(x.numero);
      ({ p } = await versionDeProyecto(proyectoId));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      ctx.log(`Escena ${x.numero}: no se pudo animar (${e instanceof Error ? e.message.split("\n")[0] : e}); pruebo con la cámara 3D.`);
      if (await camara3d(x, "plan B: Wan no pudo")) hechas.push(x.numero);
    }
  }
  return { estilo: g.estilo, hechas };
}
