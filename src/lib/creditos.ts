/**
 * Créditos al publicar: revisa la licencia de lo que suena y se ve en el video y dice, en palabras
 * simples, si hace falta dar crédito y qué texto pegar en la descripción. Lee `Asset.licencia` (texto
 * libre); lo que no reconoce lo marca para revisar, nunca lo da por libre. Idea tomada de Doory (que arma
 * las líneas de crédito de los sonidos CC BY de Freesound); el código es propio.
 */
import { usoComercial } from "./licencias";
import { NOMBRES_EFECTO } from "./audio-libre";
import type { Asset, Proyecto } from "./esquema";

export interface Creditos {
  /** Hay que poner `lineas` en la descripción. */
  hacenFalta: boolean;
  lineas: string[];
  /** Cosas para revisar antes de publicar (licencia desconocida, no comercial…). */
  avisos: string[];
  /** Línea opcional de agradecimiento (CC0 no la pide). */
  cortesia: string | null;
}

const CC_BY = /\bcc[- ]?by\b(?![- ]?nc)|creative commons attribution|atribuci[oó]n/i;
const LIBRE_DOORY = /biblioteca de audio de doory/i;
const YOUTUBE = /biblioteca de audio de youtube|youtube audio library/i;

/** «la música», «el sonido «Whoosh suave»», «la imagen de la escena 2»… para los textos. */
export function queEs(a: Asset): string {
  if (a.id === "musica") return "la música";
  if (a.id === "voz" || a.id.startsWith("voz-")) return "la voz";
  if (a.id.startsWith("libre-")) {
    const n = NOMBRES_EFECTO[a.id.slice("libre-".length)]?.[0];
    return n ? `el sonido «${n}»` : "un efecto de sonido";
  }
  if (a.id.startsWith("sfx-")) return "un efecto de sonido";
  return a.tipo === "audio" ? "un audio" : a.tipo === "imagen" ? "una imagen" : "un video";
}

/** Los assets que usa algún clip del proyecto (el índice puede guardar otros que ya no suenan). */
function enUso(p: Proyecto): Asset[] {
  const ids = new Set(p.pistas.flatMap((x) => x.clips.map((c) => c.asset)));
  return Object.values(p.assets).filter((a) => ids.has(a.id));
}

export function creditosDe(p: Proyecto): Creditos {
  const lineas = new Set<string>();
  const avisos = new Set<string>();
  let doory = false;
  for (const a of enUso(p)) {
    const lic = a.licencia;
    if (LIBRE_DOORY.test(lic)) doory = true;
    const uso = usoComercial(lic);
    if (uso === "desconocido") {
      avisos.add(`No se sabe si ${queEs(a)} se puede usar libremente (${lic}). Si vas a monetizar el video, cámbialo por algo libre.`);
      continue;
    }
    if (uso === "no") {
      avisos.add(`${mayuscula(queEs(a))} no se puede usar con fines comerciales (${lic}).`);
      continue;
    }
    if (YOUTUBE.test(lic)) avisos.add(`Algunas canciones de la Biblioteca de audio de YouTube piden crédito: míralo en la ficha de ${queEs(a)}.`);
    if (CC_BY.test(lic) && !/cc0/i.test(lic)) lineas.add(`${mayuscula(queEs(a))}: ${lic}`);
  }
  return {
    hacenFalta: lineas.size > 0,
    lineas: [...lineas],
    avisos: [...avisos],
    cortesia: doory ? "Música y sonidos: biblioteca libre de Doory (CC0), github.com/shaongitbd/doory" : null,
  };
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
