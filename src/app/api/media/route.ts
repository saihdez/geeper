import { AVNAC, AVNAC_INSTALABLE, estadoAvnac, instalacionAvnac, paginaAvnac } from "@/lib/avnac";
import { ESCRITORIO_CRAFT, instalacionEscritorio, versionEscritorio } from "@/lib/craft-escritorio";
import { APPS_CRAFT, instalacionWeb, paginaRelease, versionesWeb, versionWeb } from "@/lib/craft-web";
import { json, manejar } from "@/lib/http";
import { leerCache } from "@/lib/novedades";

export const dynamic = "force-dynamic";

/** Las apps Craft de Media: qué son, si están instaladas, si hay una versión nueva y cómo va su instalación. */
export async function GET() {
  return manejar(async () => {
    const nov = new Map((await leerCache())?.novedades.map((n) => [n.id, n]) ?? []);
    const avnac = await estadoAvnac();
    const craft = await Promise.all(
        APPS_CRAFT.map(async (a) => ({
          ...a,
          release: paginaRelease(a),
          instalada: a.soloEscritorio ? await versionEscritorio(a.app) : await versionWeb(a.app),
          versiones: a.soloEscritorio ? [] : await versionesWeb(a.app),
          ultima: nov.get(a.app)?.nuevas[0] ?? null,
          instalacion: a.soloEscritorio ? instalacionEscritorio(a) : instalacionWeb(a),
          // Las que no tienen versión web se instalan como programa (Windows y Linux; macOS: descarga).
          escritorio: a.soloEscritorio ? ESCRITORIO_CRAFT : undefined,
        })),
      );
    // Avnac Studio: otra app de diseño (no es de storytold), con su programa oficial.
    const filaAvnac = {
      app: AVNAC.id,
      nombre: AVNAC.nombre,
      version: AVNAC.version,
      grupo: "Imagen y diseño" as const,
      que: "Diseño de portadas, pósters y piezas para redes: textos, formas, fotos, capas y varias páginas.",
      comoA: "Canva",
      paraGeeper: "Diseñar a mano la portada o un póster del video; exporta PNG para subirlo como imagen.",
      soloEscritorio: true,
      release: paginaAvnac,
      instalada: avnac.instalada,
      falta: avnac.falta,
      versiones: [],
      ultima: null,
      instalacion: instalacionAvnac(),
      escritorio: AVNAC_INSTALABLE,
    };
    return json([...craft.slice(0, 1), filaAvnac, ...craft.slice(1)]);
  });
}
