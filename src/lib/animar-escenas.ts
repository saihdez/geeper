/**
 * Paso «escenas.animar» de un video nuevo con estilo «Equilibrado» o «Máxima calidad»
 * (estilos-generacion.ts): después de importar lo de MPT (y de que el avatar entre en sus escenas), cada
 * escena que sigue siendo la imagen de MPT pasa a un plano de video con plano.ts, con el prompt del estilo.
 * Las que ya rehízo el avatar no se tocan. Una escena que falla queda como estaba (se reintenta desde el
 * editor) y no tumba el video.
 *
 * El estilo elegido en «Nuevo» se guarda en la carpeta del proyecto (`generacion.json`), porque la cadena
 * de trabajos sólo lleva los pasos que faltan.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { guardarProyecto } from "./almacen";
import { EstiloGeneracion, ESTILOS_GENERACION, promptEstilo } from "./estilos-generacion";
import type { Proyecto } from "./esquema";
import { escenasEnLinea } from "./linea";
import { generarPlanoEscena, planearPlano, type ContextoPlano } from "./plano";
import { versionDeProyecto } from "./render";
import { dirProyecto } from "./rutas";

const Generacion = z.object({ estilo: EstiloGeneracion });
const rutaGeneracion = (slug: string) => path.join(dirProyecto(slug), "generacion.json");

export async function guardarEstiloGeneracion(slug: string, estilo: EstiloGeneracion) {
  await fs.mkdir(dirProyecto(slug), { recursive: true });
  await fs.writeFile(rutaGeneracion(slug), JSON.stringify(Generacion.parse({ estilo }), null, 2));
}

export async function leerEstiloGeneracion(slug: string): Promise<EstiloGeneracion | null> {
  return fs.readFile(rutaGeneracion(slug), "utf8").then((t) => Generacion.parse(JSON.parse(t)).estilo, () => null);
}

/** Escenas que siguen con la imagen de MPT (las que el avatar ya rehízo, no). Función pura. */
export function escenasParaAnimar(p: Proyecto): { escena: string; numero: number }[] {
  return escenasEnLinea(p)
    .filter((e) => p.assets[e.visual.asset]?.source === "mpt")
    .map((e) => ({ escena: e.escena.id, numero: e.indice + 1 }));
}

/** El proyecto con el estilo del video (grano) del estilo de generación, si tiene. Función pura. */
export function conEstiloVideo(p: Proyecto, estilo: EstiloGeneracion): Proyecto | null {
  const e = ESTILOS_GENERACION[estilo].estilo;
  if (!e?.efectos?.length) return null;
  const previos = (p.estilo?.efectos ?? []).filter((x) => !e.efectos!.some((y) => y.tipo === x.tipo));
  return { ...p, estilo: { ...p.estilo, efectos: [...previos, ...e.efectos] } };
}

export interface AvanceEscenas {
  numero: number;
  indice: number;
  total: number;
}

/** Anima las escenas del video con el estilo guardado. Devuelve las que quedaron animadas. */
export async function animarEscenasDelVideo(ctx: ContextoPlano, proyectoId: string, slug: string, alEmpezar: (a: AvanceEscenas) => void | Promise<void>): Promise<{ estilo: EstiloGeneracion | null; hechas: number[] }> {
  const estilo = await leerEstiloGeneracion(slug);
  const def = estilo ? ESTILOS_GENERACION[estilo] : null;
  if (!estilo || !def?.animar) return { estilo, hechas: [] };
  let { p } = await versionDeProyecto(proyectoId);
  const conGrano = conEstiloVideo(p, estilo);
  if (conGrano) {
    await guardarProyecto(proyectoId, conGrano, `Estilo «${def.nombre}»: grano de cámara`);
    ({ p } = await versionDeProyecto(proyectoId));
  }
  const lista = escenasParaAnimar(p);
  const hechas: number[] = [];
  for (const [i, x] of lista.entries()) {
    await alEmpezar({ numero: x.numero, indice: i, total: lista.length });
    try {
      const base = planearPlano(p, x.escena, { modelo: def.animar.modelo }).promptBase;
      const { prompt, negativo } = promptEstilo(estilo, base);
      await generarPlanoEscena(ctx, proyectoId, p, x.escena, {
        modelo: def.animar.modelo, prompt, negativo, camara: def.animar.camara, extra: def.animar.extra, nota: `Escena ${x.numero} animada («${def.nombre}»)`,
      });
      hechas.push(x.numero);
      ({ p } = await versionDeProyecto(proyectoId));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      ctx.log(`Escena ${x.numero}: no se pudo animar (${e instanceof Error ? e.message.split("\n")[0] : e}); queda como estaba.`);
    }
  }
  return { estilo, hechas };
}
