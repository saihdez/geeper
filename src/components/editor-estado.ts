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

/**
 * UX-19: el aviso tras guardar. Ofrece «Crear el video» sólo si no hay uno creándose (si no, pediría
 * otro igual encima); en ese caso dice que el que se está creando no tiene el cambio.
 */
export function avisoGuardado(trabajos: TrabajoV[]): { texto: string; ofrecerCrear: boolean } {
  return renderEnCurso(trabajos)
    ? { texto: "Guardado. Ya se ve en «En vivo». El video que se está creando no lo tiene: créalo otra vez cuando termine.", ofrecerCrear: false }
    : { texto: "Guardado. Ya se ve en «En vivo». Para descargarlo, crea el video otra vez.", ofrecerCrear: true };
}

/** UX-19: el ritmo de la voz no cambia el video hasta que se vuelva a decir el guion. */
export const TEXTO_RITMO_GUARDADO = "Listo: el ritmo cuenta la próxima vez que se diga el guion.";

/**
 * UX-10: el último render que falló o se cortó, si es más nuevo que el último video guardado (si falla
 * antes de guardar, no queda fila Render y arriba no se decía nada). Uno cancelado por la persona no cuenta.
 */
export function renderFallido(trabajos: TrabajoV[], ultimoRender?: { creado: string } | null): TrabajoV | null {
  const t = trabajos.find((x) => x.tipo === "render.entregar");
  if (!t || (t.estado !== "fallido" && t.estado !== "interrumpido")) return null;
  if (ultimoRender && t.creado && new Date(t.creado).getTime() <= new Date(ultimoRender.creado).getTime()) return null;
  return t;
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

/** UX-29: qué decir cuando no se pudo hacer el video. Si lo canceló la persona, no se dice que «no se pudo». */
export function textoFalloCreacion(t: Pick<TrabajoV, "estado"> | null): string {
  return t?.estado === "cancelado"
    ? "Cancelaste la creación del video. Puedes volver a pedirlo cuando quieras."
    : "No se pudo hacer el video. Puedes volver a intentarlo; si vuelve a fallar, abajo en «Trabajos de este proyecto» ves qué pasó.";
}

/**
 * WEB-10: la lista de trabajos pide /api/trabajos cada 2 s mientras está montada. Se monta sólo si la
 * persona la abrió, si hay algo en marcha, si el proyecto aún se está creando o si el último trabajo
 * acaba de fallar (para que su registro se vea sin buscarlo); en reposo, cero.
 */
export function verTrabajos(abiertaPorPersona: boolean | null, hayActivos: boolean, creando: boolean, falloReciente = false): boolean {
  return abiertaPorPersona ?? (hayActivos || creando || falloReciente);
}

/** Cuánto sigue abierta sola la lista tras un fallo: después vuelve a no pedir nada en reposo. */
export const MINUTOS_FALLO_VISIBLE = 10;

/** WEB-10: el último trabajo del proyecto falló o se cortó hace menos de MINUTOS_FALLO_VISIBLE. */
export function falloReciente(trabajos: TrabajoV[], ahora: number = Date.now()): boolean {
  const c = estadoCreacion(trabajos);
  if (c.fase !== "fallo" || c.trabajo?.estado === "cancelado") return false;
  const cuando = c.trabajo?.terminado ?? c.trabajo?.creado;
  return !!cuando && ahora - new Date(cuando).getTime() < MINUTOS_FALLO_VISIBLE * 60_000;
}

/** «2», «2 y 5», «2, 4 y 5». */
export function enLista(n: number[]): string {
  return n.length <= 1 ? String(n[0] ?? "") : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

interface EscenaVoz { id: string; indice: number; voz: { voz?: string | null } }
export interface VocesV { elegida: string | null; nombres: Record<string, string> }

/** UX-12: escenas (n.º desde 1) que hoy suenan con otra voz que la elegida. Sin voz conocida, no cuentan. */
export function escenasConOtraVoz(escenas: EscenaVoz[], elegida: string | null): number[] {
  if (!elegida) return [];
  return escenas.filter((e) => e.voz.voz && e.voz.voz !== elegida).map((e) => e.indice + 1);
}

/**
 * GPU-07: los ids de las escenas que suenan con otra voz que la elegida, para rehacerlas en UN solo
 * trabajo (con una voz diseñada, el modelo se carga una vez y el video se crea una vez al final).
 */
export function idsConOtraVoz(escenas: EscenaVoz[], elegida: string | null): string[] {
  if (!elegida) return [];
  return escenas.filter((e) => e.voz.voz && e.voz.voz !== elegida).map((e) => e.id);
}

/**
 * UX-12: antes de regenerar una sola escena con la voz elegida, si el resto del video suena con otra:
 * «Esta escena quedará con la voz Álex y las otras 7 escenas seguirán con Dora.» Si no hay mezcla, null.
 */
export function preguntaVozEscena(escenaId: string, escenas: EscenaVoz[], voces: VocesV | null): string | null {
  const elegida = voces?.elegida;
  if (!elegida) return null;
  const otras = escenas.filter((e) => e.id !== escenaId && e.voz.voz && e.voz.voz !== elegida);
  if (!otras.length) return null;
  const cuenta = new Map<string, number>();
  for (const e of otras) cuenta.set(e.voz.voz!, (cuenta.get(e.voz.voz!) ?? 0) + 1);
  const comun = [...cuenta].sort((a, b) => b[1] - a[1])[0]![0];
  const nombre = (x: string) => voces.nombres[x] ?? x;
  const resto = otras.length === 1 ? "la otra escena seguirá" : `las otras ${otras.length} escenas seguirán`;
  return `Esta escena quedará con la voz ${nombre(elegida)} y ${resto} con ${cuenta.size === 1 ? nombre(comun) : "otras voces"}.`;
}

/** UX-27: el ritmo de la voz en palabras (los números quedan sólo por dentro). */
export const RITMOS: { valor: number; nombre: string }[] = [
  { valor: 0.85, nombre: "Pausado (recomendado)" },
  { valor: 0.9, nombre: "Un poco más rápido" },
  { valor: 0.95, nombre: "Algo más rápido" },
  { valor: 1, nombre: "Rápido" },
  { valor: 1.05, nombre: "Muy rápido" },
];

/** Las opciones del selector; si el proyecto tiene otro valor, se agrega para no perderlo. */
export function opcionesRitmo(actual: number): { valor: number; nombre: string }[] {
  return RITMOS.some((r) => r.valor === actual) ? RITMOS : [...RITMOS, { valor: actual, nombre: `Otro (${String(actual).replace(".", ",")})` }].sort((a, b) => a.valor - b.valor);
}

/** Desde 0,9 los subtítulos pueden pasar de 17 letras por segundo y el QC rechaza el video. */
export function avisoRitmo(velocidad: number): string | null {
  return velocidad >= 0.9 ? "Con este ritmo los subtítulos pueden pasar muy rápido y, si pasa, el video no se podrá descargar." : null;
}

/**
 * UX-18: si la ruta de editar responde que nada cambió (`sinCambios`), no se dice «Guardado» ni se pide
 * crear el video otra vez. Hasta que la ruta lo responda, devuelve null y vale el mensaje de siempre.
 */
export function mensajeSinCambios(ediciones: { tipo?: unknown }[], r: unknown): string | null {
  if (!r || typeof r !== "object" || (r as { sinCambios?: unknown }).sinCambios !== true) return null;
  const tipos = ediciones.map((e) => e.tipo);
  if (tipos.length === 1 && tipos[0] === "quitarMuletillas") return "No encontré muletillas en este video.";
  if (tipos.length === 1 && tipos[0] === "quitarSilencios") return "No hay pausas largas que acortar.";
  return "No había nada que cambiar: el video sigue igual.";
}

interface VersionV { numero: number; nota: string; hash?: string | null }

const RE_VUELTA = /^Vuelta a la versión (\d+)$/;

/**
 * UX-38: a qué versión lleva «Deshacer». «Volver a la anterior» dos veces seguidas rehacía (la anterior
 * de una vuelta atrás es la versión que se acaba de deshacer): se sigue la cadena de vueltas hasta el
 * cambio real y se salta lo que tenga el mismo contenido que hoy.
 */
export function versionParaDeshacer(versiones: VersionV[], actual: number): VersionV | null {
  const por = new Map(versiones.map((x) => [x.numero, x]));
  const hoy = por.get(actual);
  let cur = actual;
  const vistos = new Set<number>();
  for (;;) {
    const m = RE_VUELTA.exec(por.get(cur)?.nota ?? "");
    if (!m || vistos.has(cur)) break;
    vistos.add(cur);
    cur = Number(m[1]);
  }
  const antes = versiones.filter((x) => x.numero < cur).sort((a, b) => b.numero - a.numero);
  return antes.find((x) => !hoy?.hash || !x.hash || x.hash !== hoy.hash) ?? null;
}

/**
 * UX-37: la escena que cambia una edición, para que la vista en vivo salte a ella al guardar. Quitar una
 * escena no salta (ya no está) y lo que es de todo el video tampoco.
 */
export function escenaDeEdicion(ed: object): string | null {
  const e = ed as { tipo?: unknown; escena?: unknown };
  return typeof e.escena === "string" && e.escena && e.tipo !== "quitarEscena" ? e.escena : null;
}

/** UX-08: los 4 pasos del editor, en el orden en que se usan. El índice fijo de arriba salta a cada uno. */
export const PASOS_EDITOR = [
  { id: "paso-1", titulo: "Mira tu video" },
  { id: "paso-2", titulo: "Corrige lo que se dice y se ve" },
  { id: "paso-3", titulo: "Voz y estilo" },
  { id: "paso-4", titulo: "Crea, descarga y publica" },
] as const;

/**
 * UX-08: la línea fija «Siguiente paso: …» del editor. `ir` es el ancla a la que lleva.
 * - creando: hay un video creándose; fallo: el último intento falló (el aviso con «Volver a intentar» está arriba).
 * - alDia: el último video tiene los últimos cambios; qc: el resultado de su revisión.
 */
export function siguientePaso(a: { creando: boolean; fallo: boolean; hayVideo: boolean; alDia: boolean; qc: "listo" | "con-avisos" | "falta" | null; aprobado: boolean }): { texto: string; ir: string } {
  if (a.creando) return { texto: "Se está creando tu video. Mientras tanto puedes seguir corrigiendo.", ir: "#paso-2" };
  if (a.fallo) return { texto: "No se pudo crear el video. Arriba puedes volver a intentarlo.", ir: "#arriba" };
  if (!a.hayVideo) return { texto: "Corrige lo que haga falta y después crea el video con el botón de arriba.", ir: "#paso-2" };
  if (!a.alDia) return { texto: "Tus cambios todavía no están en el video: créalo otra vez con el botón de arriba.", ir: "#arriba" };
  if (a.qc && (a.qc === "falta" || !a.aprobado)) return { texto: "Arregla lo que marca «¿Está listo para publicar?».", ir: "#listo" };
  if (!a.aprobado) return { texto: "El video no pasó la revisión: créalo otra vez con el botón de arriba.", ir: "#arriba" };
  return { texto: "Tu video está listo: descárgalo o publícalo.", ir: "#paso-4" };
}
