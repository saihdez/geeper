/**
 * Tamaño de muestra de una prueba A/B sobre una proporción (CTR, tasa de conversión...).
 *
 * Aproximación normal para dos proporciones, bilateral (Fleiss, sin corrección de continuidad):
 *   n = ( z₁₋α/₂ · √(2·p̄·(1−p̄)) + z₁₋β · √(p₁(1−p₁) + p₂(1−p₂)) )² / (p₂ − p₁)²,  p̄ = (p₁+p₂)/2
 * Con k tratamientos contra un control se corrige α con Bonferroni (α/k). Es aproximada: con tasas muy
 * bajas o muestras chicas conviene un cálculo exacto. Nunca se inventa un dato: si falta uno, no hay n.
 */

/** Inversa de la normal estándar (Acklam, error relativo < 1,2e-9). */
export function zInversa(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error("p fuera de (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const bajo = 0.02425;
  if (p < bajo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - bajo) return -zInversa(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export interface EntradaMuestra {
  /** Tasa del control, en % (0–100). */
  tasaBase: number | null;
  /** Efecto mínimo relativo, en % (20 = +20 %). */
  efectoMinimo: number | null;
  alfa: number;
  potencia: number;
  /** Número de tratamientos contra el control (≥ 1). */
  tratamientos: number;
  /** Unidades por día y por variante. */
  volumenDiario: number | null;
}

export type ResultadoMuestra =
  | { ok: true; porVariante: number; total: number; dias: number | null; p1: number; p2: number; alfaCorregido: number; avisos: string[] }
  | { ok: false; falta: string[] };

export function tamanoMuestra(e: EntradaMuestra): ResultadoMuestra {
  const falta: string[] = [];
  if (e.tasaBase == null || !(e.tasaBase > 0 && e.tasaBase < 100)) falta.push("la tasa base del control (entre 0 y 100 %)");
  if (e.efectoMinimo == null || !(e.efectoMinimo > 0)) falta.push("el efecto mínimo que vale la pena detectar");
  if (falta.length) return { ok: false, falta };
  const p1 = e.tasaBase! / 100;
  const p2 = p1 * (1 + e.efectoMinimo! / 100);
  if (p2 >= 1) return { ok: false, falta: ["un efecto mínimo que deje la tasa del tratamiento por debajo de 100 %"] };
  const k = Math.max(1, Math.floor(e.tratamientos));
  const alfaCorregido = e.alfa / k;
  const za = zInversa(1 - alfaCorregido / 2);
  const zb = zInversa(e.potencia);
  const pm = (p1 + p2) / 2;
  const num = za * Math.sqrt(2 * pm * (1 - pm)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const porVariante = Math.ceil((num * num) / ((p2 - p1) * (p2 - p1)));
  const total = porVariante * (k + 1);
  const dias = e.volumenDiario && e.volumenDiario > 0 ? Math.ceil(porVariante / e.volumenDiario) : null;
  const avisos: string[] = [];
  if (p1 < 0.01) avisos.push("Con una tasa base menor a 1 % la aproximación normal se queda corta: toma el número como mínimo.");
  if (k > 1) avisos.push(`Con ${k} tratamientos se usa α = ${(alfaCorregido * 100).toFixed(2)} % por comparación (Bonferroni).`);
  if (dias != null && dias < 7) avisos.push("Menos de una semana: deja correr al menos 7 días para cubrir el ciclo semanal.");
  if (dias != null && dias > 56) avisos.push("Más de 8 semanas: busca un efecto mayor, más volumen o menos variantes.");
  return { ok: true, porVariante, total, dias, p1, p2, alfaCorregido, avisos };
}
