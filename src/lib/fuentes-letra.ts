/**
 * Letras sin internet (REN-10, parte 2): las familias que ofrece el editor de plantillas vienen dentro de
 * Geeper, en public/fuentes (woff2 de Google Fonts, subconjuntos latin y latin-ext, todas con licencia
 * OFL: ver MODELOS.md y el OFL.txt de cada carpeta). El compilador escribe sus @font-face con rutas
 * relativas y copia los archivos al proyecto Hyperframes; como el HTML ya declara la familia,
 * Hyperframes no la baja de Google al renderizar (injectDeterministicFontFaces salta las familias que
 * ya tienen @font-face). Una familia que no esté aquí sigue como antes: Hyperframes la busca en Google.
 *
 * Sólo para el servidor (lee el disco).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import manifiesto from "../../public/fuentes/fuentes.json";
import { RAIZ_REPO } from "./rutas";

interface Cara {
  estilo: string;
  peso: number;
  /** Fuente variable: el mismo archivo cubre de `peso` a `pesoHasta`. */
  pesoHasta?: number;
  /** Relativo a public/fuentes. */
  archivo: string;
  rango: string;
}

const FUENTES: Record<string, { carpeta: string; caras: Cara[] }> = manifiesto;

/** Dónde quedan dentro del proyecto Hyperframes (relativa al index.html). */
export const FUENTES_EN_PROYECTO = "assets/fuentes";

/** En desarrollo, public/fuentes; en la app de escritorio el empaquetado deja public dentro de standalone. */
export const dirFuentes = (raiz = RAIZ_REPO) =>
  [path.join(raiz, "public", "fuentes"), path.join(raiz, "standalone", "public", "fuentes")].find((d) => existsSync(path.join(d, "fuentes.json"))) ??
  path.join(raiz, "public", "fuentes");

/** Las familias que trae Geeper, con el nombre tal como lo escribe Google Fonts. */
export const FAMILIAS_LOCALES = Object.keys(FUENTES);

const clave = (f: string) => f.trim().toLowerCase();
const porClave = new Map(Object.entries(FUENTES).map(([nombre, v]) => [clave(nombre), { nombre, ...v }]));

/** La familia viene dentro de Geeper y sus archivos están en el disco. */
export function esFamiliaLocal(familia: string, raiz = RAIZ_REPO): boolean {
  const f = porClave.get(clave(familia));
  return !!f && f.caras.every((c) => existsSync(path.join(dirFuentes(raiz), c.archivo)));
}

/**
 * Los @font-face de las familias pedidas que trae Geeper, y qué archivo copiar a cada ruta del proyecto.
 * Las que no trae (o cuyos archivos faltan) no se nombran: Hyperframes las resuelve como siempre.
 */
export function fuentesParaProyecto(familias: string[], raiz = RAIZ_REPO): { css: string; archivos: Record<string, string>; locales: string[] } {
  const archivos: Record<string, string> = {};
  const reglas: string[] = [];
  const locales: string[] = [];
  for (const k of new Set(familias.map(clave))) {
    const f = porClave.get(k);
    if (!f || !esFamiliaLocal(f.nombre, raiz)) continue;
    locales.push(f.nombre);
    for (const c of f.caras) {
      const destino = `${FUENTES_EN_PROYECTO}/${c.archivo}`;
      archivos[destino] = path.join(dirFuentes(raiz), c.archivo);
      const peso = c.pesoHasta && c.pesoHasta !== c.peso ? `${c.peso} ${c.pesoHasta}` : String(c.peso);
      reglas.push(
        `      @font-face { font-family: "${f.nombre}"; font-style: ${c.estilo}; font-weight: ${peso}; font-display: block; ` +
          `src: url("${destino}") format("woff2"); unicode-range: ${c.rango}; }`,
      );
    }
  }
  return { css: reglas.join("\n"), archivos, locales };
}
