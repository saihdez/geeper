/**
 * UX-16: «¿Está listo para publicar?» muestra la revisión del último video. Si después la persona cambió algo,
 * esa revisión es de antes de sus cambios: lo decimos arriba del panel y ofrecemos crear el video otra vez.
 */

/** La revisión es vieja cuando la versión actual del proyecto es más nueva que la del video revisado. */
export function revisionVieja(versionRevisada: number, versionActual: number): boolean {
  return versionActual > versionRevisada;
}

/** Nota para cuando un texto largo quedó repartido en dos subtítulos al guardarlo. */
export const NOTA_SUBTITULO_REPARTIDO = "Lo acomodamos en dos subtítulos para que se lea mejor.";

/**
 * Subtítulos donde empieza un texto corregido que quedó repartido en dos o más: los que caen dentro de la
 * misma corrección. Devuelve sus posiciones en `grupos` (sólo el primero de cada reparto lleva la nota).
 */
export function gruposRepartidos(grupos: { desde: number; hasta: number }[], correcciones: { desde: number; hasta: number }[]): Set<number> {
  const primeros = new Set<number>();
  for (const c of correcciones) {
    const dentro = grupos.flatMap((g, i) => (g.desde >= c.desde && g.hasta <= c.hasta ? [i] : []));
    if (dentro.length >= 2) primeros.add(dentro[0]!);
  }
  return primeros;
}

export function AvisoRevisionVieja({ versionRevisada, versionActual, ocupado, alCrear }: {
  versionRevisada: number;
  versionActual: number;
  ocupado?: boolean;
  alCrear: () => void;
}) {
  if (!revisionVieja(versionRevisada, versionActual)) return null;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
      <span className="flex-1">Esta revisión es de antes de tus cambios. Para saber si tu arreglo sirvió, crea el video otra vez.</span>
      <button type="button" className="boton" disabled={ocupado} onClick={alCrear}>Crear el video otra vez para revisarlo</button>
    </div>
  );
}
