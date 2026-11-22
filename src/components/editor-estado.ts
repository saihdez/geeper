/**
 * Lo que la página del proyecto decide a partir de la vista, sin React (puro, para poder probarlo):
 * qué mostrar, qué avisar y qué ofrecer como paso siguiente.
 */

/** UX-02: un subtítulo vacío deja una palabra que se oye y no se ve, sin un campo para recuperarla. */
export function errorSubtitulo(texto: string): string | null {
  return texto.trim() ? null : "Un subtítulo no puede quedar vacío. Para quitar la palabra, recórtala arriba.";
}

/** UX-02: correcciones vacías que dejaron versiones anteriores: se oyen sin subtítulo y no tienen campo. */
export function correccionesVacias(
  palabras: { texto: string }[],
  correcciones: { desde: number; hasta: number; texto: string }[],
): { desde: number; oido: string }[] {
  return correcciones
    .filter((c) => !c.texto.trim())
    .map((c) => ({ desde: c.desde, oido: palabras.slice(c.desde, c.hasta).map((w) => w.texto).join(" ") }));
}

/**
 * UX-21: dos versiones con el mismo contenido (mismo hash) dan el mismo video. Ir y volver en el
 * historial o guardar sin cambios no deja «cambios sin renderizar».
 */
export function mismoContenido(versiones: { numero: number; hash?: string | null }[], a: number, b: number): boolean {
  if (a === b) return true;
  const ha = versiones.find((x) => x.numero === a)?.hash;
  const hb = versiones.find((x) => x.numero === b)?.hash;
  return !!ha && ha === hb;
}

export interface TrabajoV {
  id: string;
  tipo: string;
  estado: string;
  etapa?: string | null;
  progreso?: number | null;
  error?: string | null;
  creado?: string;
  iniciado?: string | null;
  terminado?: string | null;
}

export const estaActivo = (t: { estado: string }) => t.estado === "pendiente" || t.estado === "corriendo";

/** UX-10: el render en curso de este proyecto (la vista trae los trabajos más nuevos primero). */
export function renderEnCurso(trabajos: TrabajoV[]): TrabajoV | null {
  return trabajos.find((t) => t.tipo === "render.entregar" && estaActivo(t)) ?? null;
}

/** UX-10: el paso del render en palabras de quien no sabe de video. */
export function pasoRender(t: Pick<TrabajoV, "estado" | "etapa">): string {
  if (t.estado === "pendiente") return "esperando su turno";
  const e = (t.etapa ?? "").toLowerCase();
  if (e.startsWith("esperando la gpu")) return "esperando su turno";
  if (e.includes("mezclando")) return "juntando la voz y la música";
  if (e.includes("compilando") || e.includes("color del canal")) return "preparando las escenas";
  if (e.includes("hyperframes check")) return "revisando las escenas";
  if (e.includes("renderizando")) return "armando el video cuadro por cuadro (es lo que más tarda)";
  if (e.includes("sonoridad")) return "ajustando el volumen";
  if (e.includes("máster")) return "guardando una copia de máxima calidad";
  if (e.includes("control de calidad")) return "revisando que esté listo para publicar";
  return t.etapa || "empezando";
}

/**
 * UX-29: qué decir mientras el proyecto todavía no tiene geeper.json. Si el último trabajo falló o se
 * cortó, no se dice que «se está generando».
 */
export function estadoCreacion(trabajos: TrabajoV[]): { fase: "en-curso" | "fallo" | "esperando"; trabajo: TrabajoV | null } {
  const activo = trabajos.find(estaActivo);
  if (activo) return { fase: "en-curso", trabajo: activo };
  const ultimo = trabajos[0] ?? null;
  if (ultimo && ["fallido", "interrumpido", "cancelado"].includes(ultimo.estado)) return { fase: "fallo", trabajo: ultimo };
  return { fase: "esperando", trabajo: ultimo };
}

/**
 * WEB-10: la lista de trabajos pide /api/trabajos cada 2 s mientras está montada. Se monta sólo si la
 * persona la abrió o si hay algo en marcha (o el proyecto aún se está creando); en reposo, cero.
 */
export function verTrabajos(abiertaPorPersona: boolean | null, hayActivos: boolean, creando: boolean): boolean {
  return abiertaPorPersona ?? (hayActivos || creando);
}
