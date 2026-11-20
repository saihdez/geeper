/**
 * Reglas deterministas para evaluar las salidas del modelo local (C3 de docs/STACK-AGENTICO.md).
 * Las usa Promptfoo (`evals/aserciones.ts`) y se prueban con vitest. Primero lo que se puede medir sin
 * otro modelo: forma (esquema), largos, idioma y nombres o cifras que no estaban en la entrada (contra
 * inventos como el «faro de la isla de Somme» del 2026-11-18).
 */
import { RespuestaLlm as RespuestaIdeas } from "./anuncios/ideas";
import { terminosProhibidos } from "./clips";
import { validarDirector } from "./director";
import { RespuestaGanchos } from "./ganchos";
import { RespuestaTitulos } from "./titulos";

export interface Veredicto {
  pass: boolean;
  score: number;
  reason: string;
}

const ok = (reason = "cumple"): Veredicto => ({ pass: true, score: 1, reason });
const mal = (fallos: string[], total: number): Veredicto => ({ pass: false, score: Math.max(0, 1 - fallos.length / Math.max(total, 1)), reason: fallos.join("; ") });

const sinTildes = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const palabras = (s: string) => s.split(/\s+/).filter(Boolean);
const EMOJI = /\p{Extended_Pictographic}/gu;

/** Palabras que pueden aparecer con mayúscula sin estar en la entrada. */
const PERMITIDAS = new Set(["gta", "ia", "youtube", "tiktok", "instagram", "shorts", "reels", "facebook", "cta", "ok"]);

/**
 * Nombres propios (palabras con mayúscula que no abren frase) y cifras de la salida que no están en la
 * entrada (función pura).
 */
export function inventos(salida: string, entrada: string): string[] {
  const fuente = sinTildes(entrada);
  const hallados = new Set<string>();
  // Las marcas de ritmo («[pulso]», «[pausa]») no son palabras: sin quitarlas, la frase que sigue
  // empieza en la marca y su primera palabra parece un nombre.
  salida = salida.replace(/\[[^\]]*\]/g, " ");
  const frases = salida.split(/(?<=[.!?¿¡:;\n"«“])\s*|^/u);
  for (const f of frases) {
    const ps = palabras(f.replace(/^[¿¡"«“'(\s-]+/u, ""));
    ps.slice(1).forEach((p) => {
      const limpia = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!/^\p{Lu}\p{Ll}/u.test(limpia)) return; // sólo «Nombre» (las MAYÚSCULAS de énfasis no cuentan)
      const k = sinTildes(limpia);
      if (!PERMITIDAS.has(k) && !fuente.includes(k)) hallados.add(limpia);
    });
  }
  for (const n of salida.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!entrada.includes(n) && !["1", "2", "3"].includes(n)) hallados.add(n);
  return [...hallados];
}

/** ¿Está en español? Proporción de palabras funcionales comunes (función pura, aproximada). */
export function pareceEspanol(texto: string): boolean {
  const ps = palabras(sinTildes(texto).replace(/[^\p{L}\s]/gu, " "));
  if (ps.length < 4) return true;
  const comunes = new Set(["el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "por", "con", "no", "es", "se", "lo", "su", "para", "como", "al", "mas", "cuando", "si", "pero", "este", "esta", "sin", "nadie", "hay"]);
  const ingles = new Set(["the", "and", "of", "to", "is", "in", "that", "with", "you", "this", "for", "when"]);
  const es = ps.filter((p) => comunes.has(p)).length;
  const en = ps.filter((p) => ingles.has(p)).length;
  return es >= en && es / ps.length >= 0.08;
}

function json(salida: string): unknown {
  return JSON.parse(salida);
}

export function revisarGanchos(salida: string, texto: string): Veredicto {
  const r = RespuestaGanchos.safeParse(json(salida));
  if (!r.success) return mal(["no cumple el esquema"], 1);
  const fallos: string[] = [];
  const g = r.data.ganchos;
  if (g.length !== 3) fallos.push(`${g.length} ganchos (se piden 3)`);
  for (const x of g) {
    const n = palabras(x).length;
    if (n < 3 || n > 9) fallos.push(`«${x}»: ${n} palabras (3 a 9)`);
    if (x.length > 70) fallos.push(`«${x}»: más de 70 caracteres`);
    if (/["“”«»]/.test(x)) fallos.push(`«${x}»: comillas (pone palabras en boca del creador)`);
    const p = terminosProhibidos(x);
    if (p.length) fallos.push(`«${x}»: términos prohibidos (${p.join(", ")})`);
  }
  const todo = [...g, r.data.titulo ?? ""].join(". "); // cada uno abre su propia frase
  if ((todo.match(EMOJI) ?? []).length > 1) fallos.push("más de un emoji");
  const inv = inventos(todo, texto);
  if (inv.length) fallos.push(`nombres o cifras que no están en el momento: ${inv.join(", ")}`);
  if (!pareceEspanol(g.join(". "))) fallos.push("no parece español");
  return fallos.length ? mal(fallos, g.length + 3) : ok();
}

export function revisarTitulos(salida: string, entrada: string): Veredicto {
  const r = RespuestaTitulos.safeParse(json(salida));
  if (!r.success) return mal(["no cumple el esquema"], 1);
  const fallos: string[] = [];
  const t = r.data.titulos;
  if (t.length !== 3) fallos.push(`${t.length} títulos (se piden 3)`);
  if (new Set(t.map(sinTildes)).size !== t.length) fallos.push("títulos repetidos");
  for (const x of t) {
    if (x.length > 55) fallos.push(`«${x}»: ${x.length} caracteres (máx. 55)`);
    if (/#|["“”«»]/.test(x)) fallos.push(`«${x}»: hashtag o comillas`);
    if (EMOJI.test(x)) fallos.push(`«${x}»: emoji`);
    EMOJI.lastIndex = 0;
  }
  const inv = inventos(t.join(". "), entrada);
  if (inv.length) fallos.push(`nombres o cifras que no están en el guion: ${inv.join(", ")}`);
  if (!pareceEspanol(t.join(". "))) fallos.push("no parece español");
  return fallos.length ? mal(fallos, t.length + 3) : ok();
}

export function revisarIdeas(salida: string, brief: string): Veredicto {
  const r = RespuestaIdeas.safeParse(json(salida));
  if (!r.success) return mal(["no cumple el esquema"], 1);
  const fallos: string[] = [];
  const c = r.data.conceptos;
  if (c.length !== 3) fallos.push(`${c.length} conceptos (se piden 3)`);
  if (new Set(c.map((x) => sinTildes(x.gancho))).size !== c.length) fallos.push("ganchos repetidos");
  for (const x of c) {
    const n = palabras(x.guion).length;
    if (n < 45 || n > 90) fallos.push(`«${x.nombre}»: guion de ${n} palabras (45 a 90)`);
    // Cifras nuevas sólo valen si las anota como afirmación nueva (para que una persona las verifique).
    const cifras = (x.guion.match(/\d+(?:[.,]\d+)?\s*%?/g) ?? []).filter((d) => !brief.includes(d.trim()) && !(x.afirmaciones_nuevas ?? []).some((a) => a.includes(d.trim())));
    if (cifras.length) fallos.push(`«${x.nombre}»: cifras sin respaldo (${cifras.join(", ")})`);
    if (!pareceEspanol(x.guion)) fallos.push(`«${x.nombre}»: no parece español`);
  }
  return fallos.length ? mal(fallos, c.length * 3 + 2) : ok();
}

export function revisarDirector(salida: string, tema: string, duracionObjetivo: number): Veredicto {
  let d;
  try {
    d = validarDirector(json(salida));
  } catch (e) {
    return mal([`no pasa el contrato del director: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`], 1);
  }
  const fallos: string[] = [];
  const total = d.escenas.reduce((s, e) => s + e.duracionEstimada, 0);
  if (Math.abs(total - duracionObjetivo) / duracionObjetivo > 0.25) fallos.push(`dura ${total.toFixed(0)} s y se pidieron ${duracionObjetivo} s (±25 %)`);
  const narracion = d.escenas.map((e) => e.narracion).join(" ");
  // ~2,5 palabras por segundo es el ritmo de la voz a 0,85 (DECISIONES §3).
  const segundosDeVoz = palabras(narracion).length / 2.5;
  if (segundosDeVoz > total * 1.3) fallos.push(`narración de ~${segundosDeVoz.toFixed(0)} s para ${total.toFixed(0)} s de escenas`);
  const inv = inventos(narracion, tema);
  if (inv.length) fallos.push(`nombres o cifras que no están en el tema: ${inv.join(", ")}`);
  if (!pareceEspanol(narracion)) fallos.push("no parece español");
  return fallos.length ? mal(fallos, 4) : ok();
}
