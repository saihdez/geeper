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
