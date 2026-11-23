/**
 * @font-face de las letras que trae Geeper (public/fuentes), para la pantalla: el editor de plantillas
 * las carga de /fuentes/… y sólo pide a Google Fonts las que no vienen dentro (REN-10). Sin disco: sirve
 * en el navegador.
 */
import manifiesto from "../../public/fuentes/fuentes.json";

interface Cara { estilo: string; peso: number; pesoHasta?: number; archivo: string; rango: string }
const FUENTES = manifiesto as Record<string, { carpeta: string; caras: Cara[] }>;
const clave = (f: string) => f.trim().toLowerCase();
const porClave = new Map(Object.entries(FUENTES).map(([nombre, f]) => [clave(nombre), { nombre, ...f }]));

/** Separa las familias en las que vienen dentro (con su CSS) y las que hay que pedir a Google. */
export function cssFuentesPantalla(familias: string[], base = "/fuentes"): { css: string; deGoogle: string[] } {
  const reglas: string[] = [];
  const deGoogle: string[] = [];
  for (const f of new Set(familias.filter(Boolean))) {
    const local = porClave.get(clave(f));
    if (!local) {
      deGoogle.push(f);
      continue;
    }
    for (const c of local.caras) {
      const peso = c.pesoHasta && c.pesoHasta !== c.peso ? `${c.peso} ${c.pesoHasta}` : String(c.peso);
      reglas.push(`@font-face { font-family: "${local.nombre}"; font-style: ${c.estilo}; font-weight: ${peso}; font-display: swap; src: url("${base}/${c.archivo}") format("woff2"); unicode-range: ${c.rango}; }`);
    }
  }
  return { css: reglas.join("\n"), deGoogle };
}
