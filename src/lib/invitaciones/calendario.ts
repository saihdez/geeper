/** Fechas de la invitación: instante UTC desde fecha + hora + zona IANA, textos y la cuadrícula del mes. */

/** Diferencia (ms) entre la hora de pared en `zona` y UTC en el instante `t`. */
function desfase(zona: string, t: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!) - t;
}

/** Instante (ms UTC) en que en `zona` son `fecha` (AAAA-MM-DD) a las `hora` (HH:MM). */
export function instanteUTC(fecha: string, hora: string, zona: string): number {
  const [y, m, d] = fecha.split("-").map(Number) as [number, number, number];
  const [h, mi] = hora.split(":").map(Number) as [number, number];
  const pared = Date.UTC(y, m - 1, d, h, mi);
  let t = pared - desfase(zona, pared);
  // Segunda pasada: corrige cuando el desfase cambia entre la estimación y la hora buscada (horario de verano).
  t = pared - desfase(zona, t);
  return t;
}

/** «20261215T193000Z» (formato de .ics y de Google Calendar). */
export function utcCompacto(t: number): string {
  return new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** «sábado, 15 de diciembre de 2026» y «3:30 p. m.» en la zona del evento. */
export function textosFecha(t: number, zona: string): { fecha: string; hora: string; mes: string; anio: number; dia: number } {
  const fecha = new Intl.DateTimeFormat("es-MX", { timeZone: zona, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(t);
  const hora = new Intl.DateTimeFormat("es-MX", { timeZone: zona, hour: "numeric", minute: "2-digit" }).format(t);
  const mes = new Intl.DateTimeFormat("es-MX", { timeZone: zona, month: "long" }).format(t);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zona, year: "numeric", day: "numeric" }).formatToParts(t).map((x) => [x.type, x.value]));
  return { fecha, hora, mes: mes.charAt(0).toUpperCase() + mes.slice(1), anio: +p.year!, dia: +p.day! };
}

/** Semanas del mes (domingo primero); `null` en las casillas vacías. */
export function semanasDelMes(anio: number, mes1a12: number): (number | null)[][] {
  const primero = new Date(Date.UTC(anio, mes1a12 - 1, 1)).getUTCDay();
  const dias = new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
  const casillas: (number | null)[] = [...Array<null>(primero).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
  while (casillas.length % 7) casillas.push(null);
  const semanas: (number | null)[][] = [];
  for (let i = 0; i < casillas.length; i += 7) semanas.push(casillas.slice(i, i + 7));
  return semanas;
}

/**
 * Lo que falta para el evento. Autocontenida (sin referencias externas): la página la copia con
 * `toString()` y la usa en el navegador.
 */
export function partesCuentaAtras(objetivo: number, ahora: number): { dias: number; horas: number; minutos: number; segundos: number; listo: boolean } {
  const resto = Math.max(0, objetivo - ahora);
  const s = Math.floor(resto / 1000);
  return { dias: Math.floor(s / 86400), horas: Math.floor((s % 86400) / 3600), minutos: Math.floor((s % 3600) / 60), segundos: s % 60, listo: resto === 0 };
}
