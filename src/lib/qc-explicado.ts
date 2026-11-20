/**
 * El control de calidad en palabras simples, para quien no sabe qué es un LUFS: qué se revisa y, si
 * falla, qué hacer. Pura (sin disco), la usa la página del proyecto.
 */
export interface Explicacion {
  /** Qué se revisa, en una frase. */
  que: string;
  /** Qué hacer si falla (o si avisa). */
  hacer: string;
  /** Lo arregla Geeper solo al volver a renderizar (no es algo que haga la persona). */
  tecnico?: boolean;
}

const MAPA: Record<string, Explicacion> = {
  sonoridad: { que: "Que el volumen sea el que piden las redes.", hacer: "Vuelve a renderizar; si sigue, avisa: es un problema de Geeper.", tecnico: true },
  pico: { que: "Que el sonido no se sature en los golpes fuertes.", hacer: "Vuelve a renderizar; si sigue, avisa: es un problema de Geeper.", tecnico: true },
  color: { que: "Que los colores se vean igual en cualquier teléfono.", hacer: "Vuelve a renderizar; si sigue, avisa.", tecnico: true },
  resolucion: { que: "Que el tamaño del video sea el correcto.", hacer: "Vuelve a renderizar; si sigue, avisa.", tecnico: true },
  fps: { que: "Que el video tenga la fluidez correcta.", hacer: "Vuelve a renderizar; si sigue, avisa.", tecnico: true },
  duracion: { que: "Que imagen y sonido duren lo mismo.", hacer: "Vuelve a renderizar; si sigue, avisa.", tecnico: true },
  fotogramas: { que: "Que no falten ni sobren cuadros.", hacer: "Vuelve a renderizar; si sigue, avisa.", tecnico: true },
  ampliacion: { que: "Que ninguna imagen se vea borrosa por estar estirada.", hacer: "Cámbiala por una más grande o por un SVG; si es un logo, abre el detalle y usa «Vectorizar»." },
  duplicados: { que: "Que la imagen no se quede congelada.", hacer: "Mira la escena donde se congela: cambia su clip o quítala." },
  subtitulos: { que: "Que los subtítulos se puedan leer: líneas cortas y no más de dos.", hacer: "Abre las escenas marcadas y acorta el texto que se muestra (no cambia lo que se oye)." },
  "visual-ia": { que: "Que no haya manos, caras o letras deformes ni logos ajenos en las imágenes.", hacer: "Es un aviso de la IA y puede equivocarse: mira la hoja de contacto y, si ves el defecto, cambia la imagen de esa escena." },
  "subtitulos-ritmo": { que: "Que los subtítulos no pasen demasiado rápido.", hacer: "Es un aviso: la persona habla rápido. Si quieres, recorta palabras de relleno." },
  "notas-en-subtitulos": { que: "Que no se vean notas de trabajo en los subtítulos: «(corregido)», TODO, marcas como [pulso] o {{variables}}.", hacer: "Abre la escena marcada y quita la nota del texto en pantalla." },
  "zonas-seguras": { que: "Que ningún texto quede tapado por los botones de la red social.", hacer: "Acorta el texto en pantalla o cambia su posición." },
  "hyperframes-check": { que: "Que la composición no tenga errores (textos ilegibles, piezas rotas).", hacer: "Mira el detalle: si dice «contrast», cambia el texto o su posición; si no, avisa." },
  licencias: { que: "Que tengas derecho a usar todo lo que aparece.", hacer: "Si es un clip de otra persona, publica sólo con su permiso o dentro de su campaña. La música sin licencia clara: cámbiala." },
  alineacion: { que: "Que los subtítulos vayan al tiempo con la voz.", hacer: "Escucha las palabras marcadas como dudosas y corrige o recorta." },
  ritmo: { que: "Que los cortes caigan al ritmo de la música.", hacer: "Es un aviso: usa «Alinear cortes al ritmo» o cambia la música." },
  clip: { que: "Que el clip respete las reglas: crédito al creador, sin leaks, piratería ni «oficial», y la duración de la campaña.", hacer: "Cambia el título o el gancho, o ajusta la duración. El crédito se pone solo en la descripción." },
};

export function explicar(id: string): Explicacion {
  return MAPA[id] ?? { que: "Revisión técnica.", hacer: "Mira el detalle técnico; si no lo entiendes, avisa.", tecnico: true };
}

export interface Resumen {
  estado: "listo" | "con-avisos" | "falta";
  titulo: string;
  bloquean: { id: string; nombre: string; detalle?: string }[];
  avisos: { id: string; nombre: string; detalle?: string }[];
}

/** Resumen para la persona: ¿se puede publicar?, y qué falta o conviene mirar. */
export function resumirQc(reglas: { id: string; nombre: string; ok: boolean; aviso?: boolean; detalle?: string }[]): Resumen {
  const bloquean = reglas.filter((r) => !r.ok && !r.aviso).map(({ id, nombre, detalle }) => ({ id, nombre, detalle }));
  const avisos = reglas.filter((r) => !r.ok && r.aviso).map(({ id, nombre, detalle }) => ({ id, nombre, detalle }));
  if (bloquean.length) return { estado: "falta", titulo: `Falta arreglar ${bloquean.length === 1 ? "1 cosa" : `${bloquean.length} cosas`} antes de publicar`, bloquean, avisos };
  if (avisos.length) return { estado: "con-avisos", titulo: "Listo para publicar, con cosas para mirar", bloquean, avisos };
  return { estado: "listo", titulo: "Listo para publicar", bloquean, avisos };
}
