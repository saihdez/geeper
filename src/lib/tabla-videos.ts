/**
 * Varios videos desde una tabla (idea de «bulk fill» de Doory; código propio): una fila por video, con
 * el tema y, si se quiere, el título, el guion exacto y la frase del final. Lee lo que sale de Excel o
 * Google Sheets: un .csv (con «,» o «;») o filas copiadas y pegadas (separadas por tabulador). Función
 * pura: la usan el formulario (vista previa) y el servidor (otra vez, por si llega a mano).
 */

export interface FilaVideo {
  tema: string;
  titulo?: string;
  guion?: string;
  cta?: string;
}

export const MAX_FILAS = 50;
export const MAX_CTA = 60;

/** Nombres de columna aceptados (sin acentos, minúsculas), en español y en inglés. */
const COLUMNAS: Record<keyof FilaVideo, string[]> = {
  tema: ["tema", "temas", "topic", "tema del video", "idea"],
  titulo: ["titulo", "title", "nombre", "name"],
  guion: ["guion", "script", "texto", "lo que se dice", "locucion"],
  cta: ["cta", "final", "frase final", "llamada a la accion", "cierre", "call to action"],
};

const normal = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Separa un texto CSV/TSV en celdas, con comillas al estilo de Excel ("" dentro de comillas = "). */
export function celdas(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let comillas = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"' && celda === "") comillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  if (celda !== "" || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim()));
}

/** El separador más probable: tabulador (pegado de Excel), «;» (Excel en español) o «,». */
export function separador(texto: string): string {
  const primera = texto.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  for (const s of ["\t", ";", ","]) if (primera.includes(s)) return s;
  return "\t";
}

/** ¿Parece texto de tabla (y no un tema por línea)? Sólo con tabuladores o con una fila de títulos reconocible. */
export function pareceTabla(texto: string): boolean {
  if (texto.includes("\t")) return true;
  const sep = separador(texto);
  if (sep === "\t") return false;
  const cab = celdas(texto, sep)[0] ?? [];
  return cab.some((c) => Object.values(COLUMNAS).some((ns) => ns.includes(normal(c))));
}

export interface Lectura {
  filas: FilaVideo[];
  /** Qué columna se usó para cada dato, para mostrarlo en la vista previa. */
  columnas: Partial<Record<keyof FilaVideo, number>>;
  avisos: string[];
}

/**
 * Lee la tabla. Si la primera fila tiene títulos conocidos (Tema, Título, Guion, Final…), se usan; si no,
 * la columna 1 es el tema, la 2 el título, la 3 el guion y la 4 la frase final.
 */
export function leerTabla(texto: string): Lectura {
  const todas = celdas(texto, separador(texto));
  const avisos: string[] = [];
  if (!todas.length) return { filas: [], columnas: {}, avisos: ["La tabla está vacía."] };
  const cab = todas[0]!.map(normal);
  const columnas: Lectura["columnas"] = {};
  for (const [clave, nombres] of Object.entries(COLUMNAS) as [keyof FilaVideo, string[]][]) {
    const i = cab.findIndex((c) => nombres.includes(c));
    if (i >= 0) columnas[clave] = i;
  }
  const conCabecera = columnas.tema !== undefined;
  if (!conCabecera) {
    if (Object.keys(columnas).length) avisos.push("No encontré la columna «Tema»: uso la primera columna como tema.");
    Object.assign(columnas, { tema: 0, titulo: 1, guion: 2, cta: 3 });
  }
  const datos = conCabecera ? todas.slice(1) : todas;
  const filas: FilaVideo[] = [];
  for (const [n, f] of datos.entries()) {
    const de = (k: keyof FilaVideo) => (columnas[k] !== undefined ? (f[columnas[k]!] ?? "").trim() : "");
    const tema = de("tema");
    if (!tema) {
      if (f.some((x) => x.trim())) avisos.push(`La fila ${n + (conCabecera ? 2 : 1)} no tiene tema: no la uso.`);
      continue;
    }
    const fila: FilaVideo = { tema: tema.replace(/\s+/g, " ") };
    const titulo = de("titulo");
    const guion = de("guion");
    let cta = de("cta");
    if (titulo) fila.titulo = titulo.slice(0, 120);
    if (guion) fila.guion = guion;
    if (cta.length > MAX_CTA) {
      avisos.push(`La frase final de «${tema.slice(0, 40)}» es muy larga: la corté a ${MAX_CTA} letras.`);
      cta = cta.slice(0, MAX_CTA).trim();
    }
    if (cta) fila.cta = cta;
    filas.push(fila);
  }
  if (filas.length > MAX_FILAS) {
    avisos.push(`Son ${filas.length} videos: hago los primeros ${MAX_FILAS}. El resto, en otra tanda.`);
    filas.length = MAX_FILAS;
  }
  return { filas, columnas, avisos };
}

/** Ejemplo para descargar y llenar (CSV con «;», que Excel en español abre en columnas). */
export const EJEMPLO_CSV = [
  "Tema;Título;Guion;Final",
  "Por qué los faros siguen siendo importantes;Los faros no murieron;;Síguenos para más",
  "Faros que se convirtieron en hoteles;Dormir en un faro;;¿Dormirías aquí?",
].join("\r\n");
