/**
 * A11-11: una sola forma de escribir números, duraciones y fechas en la pantalla. Todo pasa por
 * `Intl` con un único idioma (`IDIOMA_FORMATO`): si algún día se prefiere la coma decimal, se cambia
 * aquí y en ningún otro sitio. Sin dependencias de React ni del servidor: sirve en ambos lados.
 */

/** México: punto decimal y coma de miles («1,234.5»), como ya salían las fechas de Cuentas. */
export const IDIOMA_FORMATO = "es-MX";

const enteros = new Intl.NumberFormat(IDIOMA_FORMATO, { maximumFractionDigits: 0 });

/** Un número para leer: «1,234», «12.5». `decimales` es el máximo (no rellena con ceros). */
export function numero(n: number, decimales = 0): string {
  if (!Number.isFinite(n)) return "—";
  if (decimales === 0) return enteros.format(n);
  return new Intl.NumberFormat(IDIOMA_FORMATO, { maximumFractionDigits: decimales }).format(n);
}

/**
 * Una duración en palabras: «12.3 s», «45 s», «2 min 30 s», «1 h 20 min». Con menos de 10 s lleva
 * un decimal; desde ahí, segundos enteros. Sin dato: «—».
 */
export function segundos(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const t = Math.max(0, s);
  if (t < 10) return `${numero(Math.round(t * 10) / 10, 1)} s`;
  const r = Math.round(t);
  if (r < 60) return `${r} s`;
  if (r < 3600) {
    const m = Math.floor(r / 60);
    const ss = r % 60;
    return ss ? `${m} min ${ss} s` : `${m} min`;
  }
  const h = Math.floor(r / 3600);
  const m = Math.round((r % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Fecha y hora: «21 nov 2026, 3:28 p.m.». */
export function fecha(d: Date | string | number): string {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleString(IDIOMA_FORMATO, { dateStyle: "medium", timeStyle: "short" });
}

/** Sólo la hora: «3:28 p.m.». */
export function hora(d: Date | string | number): string {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleTimeString(IDIOMA_FORMATO, { hour: "numeric", minute: "2-digit" });
}

/** Cuánto hace: «hace un momento», «hace 5 min», «hace 2 h», «ayer» o la fecha si pasó más. */
export function haceCuanto(d: Date | string | number, ahora: number = Date.now()): string {
  const x = new Date(d).getTime();
  if (Number.isNaN(x)) return "—";
  const s = Math.max(0, (ahora - x) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 2 * 86_400) return `ayer, ${hora(x)}`;
  return fecha(x);
}
