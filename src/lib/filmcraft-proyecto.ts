/**
 * Segundo paso de «Abrir en FilmCraft»: pasar los gráficos a gráficos nativos de FilmCraft.
 *
 * FilmCraft 0.20.1 sólo dibuja capas de texto y de forma en un ítem «Graphic» (`ItemKind::Graphic`,
 * `crates/render/src/lib.rs`), y su .otio no puede crear uno (`common.rs`, `uncarried_clip`). Por eso la
 * página primero importa el .otio con cada gráfico como «Transparent Video» con sus capas
 * (filmcraft-capas.ts), le pide a FilmCraft que guarde el proyecto (.fcproj, el mismo JSON que escribe
 * File › Save) y acá cada uno de esos ítems pasa a ser «Graphic» del tamaño del cuadro. Al volver a abrir
 * ese .fcproj, los textos se ven y se editan en Essential Graphics. Los medios siguen enlazados porque
 * quedan en `/files/` de FilmCraft.
 *
 * De paso arregla los medios que el .otio enlazó antes de que FilmCraft terminara de leer el archivo: quedan
 * con el tamaño por defecto (1920×1080) y un clip con posición o máscara se ve corrido. Cada archivo
 * mandado tiene además su propio ítem ya leído (con `identity`): se copia de ahí.
 *
 * Función pura (corre en el navegador).
 */

type J = Record<string, unknown>;

const CAPAS = new Set(["graphic_text", "graphic_shape"]);

export interface Conversion {
  proyecto: string;
  graficos: number;
  /** Medios que FilmCraft todavía no terminó de leer: conviene pedir el guardado otra vez en un rato. */
  sinLeer: number;
}

interface Medio { media?: { File?: { path?: string }; Generator?: unknown }; info?: { video?: { width: number; height: number; frame_rate: unknown } | null }; identity?: unknown }

/** El .fcproj con los gráficos como «Graphic» y el nombre del proyecto de Geeper. */
export function graficosNativos(fcproj: string, nombre: string): Conversion {
  const d = JSON.parse(fcproj) as { format?: string; project?: { name?: string; items?: Record<string, J> } };
  if (d.format !== "filmcraft.project" || !d.project?.items) throw new Error("FilmCraft no devolvió un proyecto que se pueda leer");
  const items = d.project.items;
  const conCapas = new Set<string>();
  for (const it of Object.values(items)) {
    const seq = ((it.kind as J | undefined)?.Sequence ?? null) as { video_tracks?: { items?: { item?: number; effects?: { effect?: string }[] }[] }[] } | null;
    for (const t of seq?.video_tracks ?? []) {
      for (const ti of t.items ?? []) {
        if (ti.item !== undefined && ti.effects?.some((e) => CAPAS.has(e.effect ?? ""))) conCapas.add(String(ti.item));
      }
    }
  }
  // Medios ya leídos por FilmCraft, por ruta.
  const medios = Object.values(items).map((it) => (it.kind as J | undefined)?.Media as Medio | undefined).filter((m): m is Medio => !!m?.media?.File?.path);
  const leidos = new Map(medios.filter((m) => m.identity).map((m) => [m.media!.File!.path!, m]));
  let sinLeer = 0;
  for (const m of medios) {
    if (m.identity) continue;
    const bueno = leidos.get(m.media!.File!.path!);
    if (bueno) {
      m.info = structuredClone(bueno.info);
      m.identity = structuredClone(bueno.identity);
    } else if (m.info?.video?.width === 1920 && m.info.video.height === 1080) sinLeer++;
  }
  let graficos = 0;
  for (const id of conCapas) {
    const it = items[id];
    const media = (it?.kind as J | undefined)?.Media as { media?: { Generator?: unknown }; info?: { video?: { width: number; height: number; frame_rate: unknown } } } | undefined;
    const v = media?.info?.video;
    if (!it || media?.media?.Generator !== "TransparentVideo" || !v) continue;
    it.kind = { Graphic: { width: v.width, height: v.height, rate: v.frame_rate } };
    it.label = "Rose";
    graficos++;
  }
  d.project.name = nombre;
  return { proyecto: JSON.stringify(d), graficos, sinLeer };
}
