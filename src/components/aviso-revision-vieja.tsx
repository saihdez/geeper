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
 * Para cada subtítulo que es parte de un texto corregido repartido en dos o más: el texto completo de esa
 * corrección y si es el primero. La casilla del primero edita el texto completo (guardar el de una sola
 * casilla reemplazaba toda la corrección y se perdía el resto); las demás lo muestran como continuación.
 */
export function repartoDeGrupos(
  grupos: { desde: number; hasta: number }[],
  correcciones: { desde: number; hasta: number; texto: string }[],
): Map<number, { completo: string; primero: boolean }> {
  const out = new Map<number, { completo: string; primero: boolean }>();
  for (const c of correcciones) {
    const dentro = grupos.flatMap((g, i) => (g.desde >= c.desde && g.hasta <= c.hasta ? [i] : []));
    if (dentro.length < 2) continue;
    dentro.forEach((i, n) => out.set(i, { completo: c.texto, primero: n === 0 }));
  }
  return out;
}

/** Bajo la casilla del primer subtítulo repartido: se corrige ahí el texto entero. */
export const NOTA_EDITA_COMPLETO = "Aquí corriges el texto completo, también lo que va en el subtítulo siguiente.";
/** En lugar de la casilla, en los que siguen. */
export const NOTA_CONTINUACION = "Sigue del subtítulo de arriba: se corrige ahí.";

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
