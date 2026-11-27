/**
 * GSAP sin internet (REN-10): el render, el `hyperframes check` y «En vivo» usan la copia de
 * node_modules/gsap (dependencia fijada en la misma versión que pedía el CDN) en vez de bajarla de
 * cdn.jsdelivr.net cada vez. Se copia dentro del proyecto Hyperframes en `assets/gsap/dist/`: si alguna
 * vez falta el archivo, Hyperframes reescribe esa ruta al CDN por su cuenta (rewriteUnresolvableGsapToCdn).
 *
 * Sólo para el servidor (lee el disco); demo-web.ts, que también usa el navegador, recibe la ruta hecha.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { RAIZ_REPO } from "./rutas";

export const VERSION_GSAP = "3.15.0";
/**
 * Si no está la copia local: el de siempre. La app de escritorio la lleva desde REN-10 (gsap va en las
 * dependencias de scripts/escritorio/empaquetar.ts y faltantesApp lo revisa); sólo las versiones
 * armadas antes vuelven al CDN.
 */
export const GSAP_CDN = `https://cdn.jsdelivr.net/npm/gsap@${VERSION_GSAP}/dist/gsap.min.js`;
/** Dónde queda dentro del proyecto Hyperframes (relativa al index.html). */
export const GSAP_EN_PROYECTO = "assets/gsap/dist/gsap.min.js";

const CANDIDATOS = (raiz: string) => [path.join(raiz, "node_modules", "gsap", "dist", "gsap.min.js")];

/** El gsap.min.js local, o undefined si no está. */
export function rutaGsap(raiz = RAIZ_REPO): string | undefined {
  return CANDIDATOS(raiz).find((x) => existsSync(x));
}

/**
 * Qué poner en `<script src>` y qué archivo copiar al proyecto: la copia local si está; si no, el CDN
 * (y no se copia nada).
 */
export function gsapParaProyecto(raiz = RAIZ_REPO): { src: string; archivo: string | null } {
  const local = rutaGsap(raiz);
  return local ? { src: GSAP_EN_PROYECTO, archivo: local } : { src: GSAP_CDN, archivo: null };
}
