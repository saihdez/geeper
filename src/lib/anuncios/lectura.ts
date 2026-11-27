/**
 * Lectura de una prueba A/B terminada (claude-ads, ads-test): antes de estimar el efecto se revisa que
 * los datos estén completos y que se llegó a la muestra decidida; si no, no se declara ganador.
 *
 * Por cada tratamiento contra el control:
 *   diferencia = p_t − p_c, intervalo con error estándar sin agrupar,
 *   prueba z bilateral con proporción agrupada, α corregido por Bonferroni (α/k).
 */
import type { ResultadoChequeo } from "./esquema";
import { zInversa } from "./muestra";

/** Φ(x), normal estándar acumulada (Abramowitz y Stegun 7.1.26, error < 1,5e-7). */
export function normalAcumulada(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export interface Conteo {
  unidades: number | null;
  conversiones: number | null;
}

export type Veredicto = "falta" | "temprano" | "gana" | "pierde" | "sin-diferencia" | "invalido";

export interface Comparacion {
  tratamiento: string;
  tasaControl: number;
  tasaTratamiento: number;
  diferencia: number;
  /** Diferencia relativa al control (0,2 = +20 %). */
  relativa: number | null;
  intervalo: [number, number];
  z: number;
  p: number;
  veredicto: Veredicto;
  texto: string;
}

export interface Lectura {
  ok: boolean;
  alfaCorregido: number;
  avisos: string[];
  comparaciones: Comparacion[];
  /** Una línea con la decisión de toda la prueba. */
  decision: string;
}

const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)} %`;

function valido(c: Conteo | undefined): c is { unidades: number; conversiones: number } {
  return Boolean(c && c.unidades != null && c.conversiones != null && c.unidades > 0 && c.conversiones >= 0);
}

export function leerPrueba(e: {
  control: string | null;
  tratamientos: string[];
  resultados: Record<string, Conteo>;
  alfa: number;
  /** Muestra por variante decidida antes de lanzar (null si no se calculó). */
  planeada: number | null;
  guardarrailes: ResultadoChequeo;
  nombres: Record<string, string>;
}): Lectura {
  const avisos: string[] = [];
  const k = Math.max(1, e.tratamientos.length);
  const alfaCorregido = e.alfa / k;
  const nombre = (id: string) => e.nombres[id] ?? id;
  if (!e.control || !e.tratamientos.length) {
    return { ok: false, alfaCorregido, avisos, comparaciones: [], decision: "Elige la idea base y al menos una que compita." };
  }
  const c = e.resultados[e.control];
  if (!valido(c)) return { ok: false, alfaCorregido, avisos, comparaciones: [], decision: `Faltan los números de la idea base («${nombre(e.control)}»).` };
  if (c.conversiones > c.unidades) return { ok: false, alfaCorregido, avisos, comparaciones: [], decision: "La idea base tiene más resultados que personas que la vieron: revisa los números." };
  if (e.planeada == null) avisos.push("No calculaste cuánta gente hacía falta (paso 3): toma el resultado sólo como orientación.");
  const z = zInversa(1 - alfaCorregido / 2);
  const pc = c.conversiones / c.unidades;

  const comparaciones = e.tratamientos.map((id): Comparacion => {
    const t = e.resultados[id];
    const base = { tratamiento: id, tasaControl: pc, tasaTratamiento: 0, diferencia: 0, relativa: null, intervalo: [0, 0] as [number, number], z: 0, p: 1 };
    if (!valido(t)) return { ...base, veredicto: "falta", texto: `Faltan los números de «${nombre(id)}».` };
    if (t.conversiones > t.unidades) return { ...base, veredicto: "invalido", texto: `«${nombre(id)}» tiene más resultados que personas que la vieron.` };
    const pt = t.conversiones / t.unidades;
    const dif = pt - pc;
    const se = Math.sqrt((pc * (1 - pc)) / c.unidades + (pt * (1 - pt)) / t.unidades);
    const pa = (c.conversiones + t.conversiones) / (c.unidades + t.unidades);
    const se0 = Math.sqrt(pa * (1 - pa) * (1 / c.unidades + 1 / t.unidades));
    const zz = se0 > 0 ? dif / se0 : 0;
    const p = se0 > 0 ? 2 * (1 - normalAcumulada(Math.abs(zz))) : 1;
    const r = { ...base, tasaTratamiento: pt, diferencia: dif, relativa: pc > 0 ? dif / pc : null, intervalo: [dif - z * se, dif + z * se] as [number, number], z: zz, p };
    const rel = r.relativa != null ? ` (${r.relativa >= 0 ? "+" : ""}${pct(r.relativa, 1)})` : "";
    const resumen = `${pct(pt)} contra ${pct(pc)} de la base${rel}; la diferencia real está probablemente entre ${pct(r.intervalo[0])} y ${pct(r.intervalo[1])} (p ${p < 0.001 ? "< 0.001" : `= ${p.toFixed(3)}`})`;
    if (e.planeada != null && (c.unidades < e.planeada || t.unidades < e.planeada)) {
      const falta = Math.max(0, e.planeada - Math.min(c.unidades, t.unidades));
      return { ...r, veredicto: "temprano", texto: `Todavía no se puede saber: faltan ~${falta.toLocaleString("es")} personas por anuncio. Por ahora: ${resumen}.` };
    }
    if (p < alfaCorregido && dif > 0) return { ...r, veredicto: "gana", texto: `«${nombre(id)}» funcionó mejor, y no parece suerte: ${resumen}.` };
    if (p < alfaCorregido && dif < 0) return { ...r, veredicto: "pierde", texto: `«${nombre(id)}» funcionó peor que la base: ${resumen}.` };
    return { ...r, veredicto: "sin-diferencia", texto: `No hay diferencia clara: puede ser suerte. ${resumen}.` };
  });

  let decision: string;
  const ganan = comparaciones.filter((x) => x.veredicto === "gana").sort((a, b) => b.diferencia - a.diferencia);
  if (comparaciones.some((x) => x.veredicto === "falta" || x.veredicto === "invalido")) decision = "Completa o corrige los números antes de decidir.";
  else if (comparaciones.some((x) => x.veredicto === "temprano")) decision = "Déjala seguir: todavía no la vio suficiente gente. No la cortes por lo que se ve hoy.";
  else if (ganan.length) {
    const g = nombre(ganan[0]!.tratamiento);
    decision =
      e.guardarrailes === "fail" ? `«${g}» consiguió más resultados, pero empeoró lo que no podía empeorar: no le pongas más dinero hasta entender por qué.`
      : e.guardarrailes === "pass" ? `Ganó «${g}»: ponle más presupuesto. Consiguió más resultados y no empeoró lo que cuidabas.`
      : `«${g}» consiguió más resultados. Antes de ponerle más dinero, confirma abajo que no empeoró lo que cuidabas.`;
  } else if (comparaciones.every((x) => x.veredicto === "pierde")) decision = "Quédate con la idea base: ninguna la superó.";
  else decision = "No hubo un ganador claro: sigue con la idea base (o la más barata) y prueba otra idea más distinta.";
  return { ok: true, alfaCorregido, avisos, comparaciones, decision };
}
