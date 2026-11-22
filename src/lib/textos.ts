/**
 * Lo que la pantalla dice de los trabajos, en palabras simples (UX-14, UX-15). Se traduce al
 * mostrar: los registros, la base y las pruebas siguen con los nombres internos.
 * Sin dependencias de React ni del servidor (sólo tipos): sirve en ambos lados.
 */
import type { TipoTrabajo } from "./cola";

/** Qué hace cada tipo de trabajo, dicho para quien no sabe de video. */
export const TIPOS_TRABAJO: Record<TipoTrabajo, string> = {
  "mpt.generar": "Haciendo el video nuevo",
  "proyecto.importar": "Preparando el video y sus subtítulos",
  "clip.momentos": "Buscando los mejores momentos",
  "clip.importar": "Preparando el clip",
  "visual.reencuadrar": "Acomodando la imagen al formato",
  "plano.generar": "Animando una escena",
  "avatar.proponer": "Creando tu avatar",
  "avatar.retocar": "Retocando tu avatar",
  "presentador.generar": "Tu avatar hablando",
  "avatar.actuar": "Tu avatar en una escena",
  "avatar.streamer": "Tu avatar como streamer",
  "avatar.escenas": "Tu avatar en el video nuevo",
  "escenas.animar": "Animando las escenas",
  "escena.rehacer": "Rehaciendo una toma",
  "workflow.correr": "Usando una receta de imagen",
  "demo.crear": "Grabando la demo de una página web",
  "voz.regenerar": "Grabando la voz otra vez",
  "proyecto.traducir": "Traduciendo el video",
  "voz.disenar": "Creando una voz nueva",
  "efecto.generar": "Creando un efecto de sonido",
  "render.entregar": "Armando el video final y revisándolo",
  "publicar.subir": "Subiendo el video a tus redes",
};

export function nombreTipo(tipo: string): string {
  return (TIPOS_TRABAJO as Record<string, string>)[tipo] ?? "Trabajo de Geeper";
}

/**
 * Estados de trabajos, proyectos, videos, publicaciones, cuentas y campañas, con mayúscula y sin
 * jerga («QC», «render», «ensamblado»). Lo que no está aquí se muestra con mayúscula inicial.
 */
export const ESTADOS: Record<string, string> = {
  // Trabajos
  pendiente: "En cola",
  corriendo: "En curso",
  hecho: "Listo",
  fallido: "No se pudo",
  interrumpido: "Se cortó",
  cancelado: "Cancelado",
  // Proyectos
  borrador: "Borrador",
  generando: "Haciendo el video",
  ensamblado: "Listo para revisar",
  qc: "Falta arreglar algo",
  entregado: "Video listo",
  // Videos terminados
  renderizado: "Por revisar",
  aprobado: "Aprobado",
  rechazado: "Falta arreglar algo",
  // Publicaciones
  subiendo: "Subiendo",
  procesando: "La red lo está procesando",
  publicada: "Publicada",
  fallida: "No se pudo",
  cancelada: "Cancelada",
  // Cuentas
  conectada: "Conectada",
  reconectar: "Hay que volver a conectarla",
  desconectada: "Desconectada",
  // Campañas
  "en-revision": "En revisión",
  lista: "Lista para lanzar",
  activa: "Activa",
  archivada: "Archivada",
};

export function nombreEstado(estado: string): string {
  return ESTADOS[estado] ?? (estado ? estado[0]!.toLocaleUpperCase("es") + estado.slice(1) : "—");
}

/** Etapas con nombres de programas o de piezas del equipo y cómo decirlas. Gana la primera que coincide. */
const ETAPAS: [RegExp, string | ((m: RegExpExecArray) => string)][] = [
  [/^Esperando la GPU/i, "Esperando turno: la tarjeta de video está ocupada."],
  [/^MPT generando(?:\D*(\d+) %)?/i, (m) => `Haciendo el video nuevo${m[1] ? ` (${m[1]} %)` : ""}…`],
  [/Copiando la tarea de MPT/i, "Preparando el video y sus subtítulos…"],
  [/^Cortando el tramo/i, "Cortando el momento y escribiendo los subtítulos…"],
  [/^Trayendo la fuente/i, "Midiendo dónde hay más reacción…"],
  [/^Buscando la cara/i, "Buscando la cara en el video…"],
  [/^Verificando render/i, "Revisando el video y la cuenta…"],
  [/^Mezclando audio/i, "Mezclando el sonido…"],
  [/^Compilando a Hyperframes|^hyperframes check|^Renderizando/i, "Armando el video final…"],
  [/^Aplicando el color/i, "Dándole el color del canal…"],
  [/^Normalizando sonoridad/i, "Emparejando el volumen…"],
  [/^Máster de archivo/i, "Guardando una copia en máxima calidad…"],
  [/^Control de calidad|\bQC\b/i, "Revisando que el video quede bien…"],
];

/**
 * La etapa que avisa el worker, sin nombres de programas ni piezas del equipo. Las que ya están en
 * palabras simples pasan tal cual, sin los paréntesis con jerga («(Kokoro, CPU)»).
 */
export function etapaSimple(etapa: string, estado = "corriendo"): string {
  if (estado === "pendiente") return "Esperando su turno: empieza en cuanto se libere el motor.";
  const e = etapa.trim();
  if (!e || /^En cola$/i.test(e)) return "Empezando…";
  for (const [re, texto] of ETAPAS) {
    const m = re.exec(e);
    if (m) return typeof texto === "string" ? texto : texto(m);
  }
  return e
    .replace(/\s*\((?:[^)]*\b(?:CPU|GPU|IA local|VoxCPM2?|Kokoro|whisper|MPT|ffmpeg|Wan2GP|ComfyUI)\b[^)]*)\)/gi, "")
    .replace(/ con (?:Gemma|Qwen|Kokoro|VoxCPM2?)\b/gi, "")
    .trim() || "Trabajando…";
}
