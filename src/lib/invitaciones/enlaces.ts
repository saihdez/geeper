/** Enlaces y archivos que arma la invitación: calendario, mapas, WhatsApp y reproductores de música. */
import type { Musica } from "./esquema";
import { utcCompacto } from "./calendario";

export interface Evento {
  titulo: string;
  descripcion: string;
  lugar: string;
  inicio: number;
  fin: number;
  uid: string;
}

export function urlGoogleCalendar(e: Evento): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.titulo, dates: `${utcCompacto(e.inicio)}/${utcCompacto(e.fin)}`, details: e.descripcion, location: e.lugar });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

const escIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Parte una línea de .ics en trozos de ≤ 75 octetos (RFC 5545 §3.1) sin cortar un carácter UTF-8. */
export function plegarIcs(linea: string): string {
  const out: string[] = [];
  let actual = "";
  let bytes = 0;
  for (const ch of linea) {
    const n = Buffer.byteLength(ch);
    const max = out.length ? 74 : 75;
    if (bytes + n > max) {
      out.push(actual);
      actual = "";
      bytes = 0;
    }
    actual += ch;
    bytes += n;
  }
  out.push(actual);
  return out.join("\r\n ");
}

export function ics(e: Evento, ahora = Date.now()): string {
  const lineas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Geeper//Invitaciones//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${utcCompacto(ahora)}`,
    `DTSTART:${utcCompacto(e.inicio)}`,
    `DTEND:${utcCompacto(e.fin)}`,
    `SUMMARY:${escIcs(e.titulo)}`,
    `DESCRIPTION:${escIcs(e.descripcion)}`,
    `LOCATION:${escIcs(e.lugar)}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${escIcs(e.titulo)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lineas.map(plegarIcs).join("\r\n") + "\r\n";
}

export function urlMaps(lugar: { nombre: string; direccion?: string; mapa?: string }): string {
  if (lugar.mapa) return lugar.mapa;
  const q = [lugar.nombre, lugar.direccion].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function urlWaze(lugar: { nombre: string; direccion?: string }): string {
  const q = [lugar.nombre, lugar.direccion].filter(Boolean).join(", ");
  return `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
}

export function urlWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}

/**
 * Mensaje de confirmación que el invitado manda por WhatsApp. Autocontenida: la página la copia con
 * `toString()` y la usa en el navegador.
 */
export function mensajeConfirmacion(d: { evento: string; nombre: string; asiste: boolean; personas: number; nota: string }): string {
  const nombre = d.nombre.trim() || "un invitado";
  const linea = d.asiste
    ? `Confirmo que SÍ asistiré${d.personas > 1 ? `, somos ${d.personas}` : ""}. ¡Gracias por la invitación!`
    : "Lamentablemente NO podré asistir. ¡Les deseo lo mejor!";
  const nota = d.nota.trim() ? `\n${d.nota.trim()}` : "";
  return `Hola, soy ${nombre}. ${d.evento}: ${linea}${nota}`;
}

/** Convierte el enlace pegado en la música de la invitación; `null` si no se reconoce. */
export function leerEnlaceMusica(enlace: string): Exclude<Musica, { tipo: "ninguna" } | { tipo: "archivo" }> | null {
  const s = enlace.trim();
  const sp = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]{22})(?:[/?#]|$)/i.exec(s);
  if (sp) return { tipo: "spotify", clase: sp[1]!.toLowerCase() as "track" | "album" | "playlist", id: sp[2]! };
  const yt = /^https:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&?#/]|$)/i.exec(s);
  if (yt) return { tipo: "youtube", id: yt[1]! };
  return null;
}

/** Enlaces cortos (spotify.link, open.spotify.com/xxx con redirección): se sigue la redirección una vez. */
export async function resolverEnlaceMusica(enlace: string, op: { signal?: AbortSignal } = {}) {
  const directo = leerEnlaceMusica(enlace);
  if (directo) return directo;
  let url: URL;
  try {
    url = new URL(enlace.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^(spotify\.link|spotify\.app\.link|youtu\.be|(www\.)?youtube\.com)$/i.test(url.hostname)) return null;
  try {
    const r = await fetch(url, { redirect: "follow", signal: op.signal ?? AbortSignal.timeout(8000) });
    return leerEnlaceMusica(r.url);
  } catch {
    return null;
  }
}

export function urlReproductor(m: Musica): string | null {
  if (m.tipo === "spotify") return `https://open.spotify.com/embed/${m.clase}/${m.id}?utm_source=generator&theme=0`;
  if (m.tipo === "youtube") return `https://www.youtube-nocookie.com/embed/${m.id}?rel=0`;
  return null;
}
