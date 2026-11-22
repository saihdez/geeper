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
