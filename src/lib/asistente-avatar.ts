/**
 * Partes puras del asistente de avatares que usan la página y el servidor (sin `node:`): guardar en la URL
 * por dónde va (UX-13) y qué retoques mostrar en la biblioteca, incluidos los que fallaron.
 */

export interface EstadoAsistente {
  propuesta: string;
  trabajo: string;
  /** La toma elegida, si ya eligió una. */
  toma?: number;
}

const PROPUESTA = /^[a-z0-9]+$/;
const TRABAJO = /^[\w-]{1,64}$/;

/** Lee `?propuesta=…&trabajo=…&toma=…` (null si falta algo o no tiene la forma esperada). */
export function leerEstadoAsistente(busqueda: string): EstadoAsistente | null {
  const q = new URLSearchParams(busqueda);
  const propuesta = q.get("propuesta") ?? "";
  const trabajo = q.get("trabajo") ?? "";
  if (!PROPUESTA.test(propuesta) || !TRABAJO.test(trabajo)) return null;
  const toma = Number(q.get("toma"));
  return { propuesta, trabajo, ...(Number.isInteger(toma) && toma >= 1 && toma <= 40 ? { toma } : {}) };
}

/** La búsqueda con el estado puesto (o quitado con null); conserva lo demás que haya en la URL. */
export function escribirEstadoAsistente(busqueda: string, e: EstadoAsistente | null): string {
  const q = new URLSearchParams(busqueda);
  for (const k of ["propuesta", "trabajo", "toma"]) q.delete(k);
  if (e) {
    q.set("propuesta", e.propuesta);
    q.set("trabajo", e.trabajo);
    if (e.toma) q.set("toma", String(e.toma));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

interface TrabajoRetoque { id: string; estado: string; creado: Date | string; payload: unknown }

/**
 * El retoque que importa de cada avatar (función pura): el más nuevo, si sigue en marcha o si falló después
 * del último cambio del avatar (para decir «No se pudo retocar»). Los trabajos vienen del más nuevo al más viejo.
 */
export function retoquesVisibles<T extends TrabajoRetoque>(trabajos: T[], actualizado: Record<string, string>): T[] {
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const t of trabajos) {
    const avatar = (t.payload as { avatar?: unknown } | null)?.avatar;
    if (typeof avatar !== "string" || vistos.has(avatar) || !(avatar in actualizado)) continue;
    vistos.add(avatar);
    const creado = typeof t.creado === "string" ? t.creado : t.creado.toISOString();
    if (t.estado === "pendiente" || t.estado === "corriendo" || (t.estado === "fallido" && creado > actualizado[avatar]!)) out.push(t);
  }
  return out;
}

/**
 * Si «Cancelar» del asistente tiene que parar el trabajo (función pura): hay un pedido y su avance todavía
 * no llegó o sigue en marcha. Antes del primer avance el dibujo ya está en la fila (UX-13).
 */
export function cancelarAlSalir(pedido: { trabajo: string } | null, estado: string | null | undefined): boolean {
  return !!pedido && (estado == null || estado === "pendiente" || estado === "corriendo");
}

/** Lo escrito en cada modo del paso 1, por separado: la descripción no se cuela en «Desde una foto» (UX-23). */
export interface TextosAvatar {
  palabras: string;
  foto: string;
}

/** El pedido que se manda al crear (función pura): sólo con el texto del modo elegido. */
export function pedidoAvatar(o: { conFoto: boolean; textos: TextosAvatar; estilo: string; fondo: string; luz?: string; look?: string }) {
  return {
    descripcion: (o.conFoto ? o.textos.foto : o.textos.palabras).trim(),
    estilo: o.estilo,
    fondo: o.fondo,
    ...(o.luz ? { luz: o.luz } : {}),
    ...(o.look ? { look: o.look } : {}),
  };
}

/** Lo mínimo para «Describirlo con palabras»; con foto el texto es opcional. */
export const puedeCrearAvatar = (conFoto: boolean, textos: TextosAvatar, hayFoto: boolean, consiento: boolean) =>
  conFoto ? hayFoto && consiento : textos.palabras.trim().length >= 8;

/**
 * A dónde volver después de crear el avatar (`?volver=/proyectos/<id>`), sólo si es un proyecto de
 * Geeper: nunca otra página ni otro sitio (UX-32; función pura).
 */
export function volverSeguro(v: string | null | undefined): string | null {
  return v && /^\/proyectos\/[\w-]{1,80}$/.test(v) ? v : null;
}

/** El enlace a Avatares que trae de vuelta al video desde el que se fue. */
export const enlaceAvatares = (proyectoId: string) => `/avatares?volver=${encodeURIComponent(`/proyectos/${proyectoId}`)}`;
