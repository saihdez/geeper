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
  "subtitulos-ritmo": { que: "Que los subtítulos no pasen demasiado rápido.", hacer: "Es un aviso: la persona habla rápido. Si quieres, recorta palabras de relleno." },
  "zonas-seguras": { que: "Que ningún texto quede tapado por los botones de la red social.", hacer: "Acorta el texto en pantalla o cambia su posición." },
  "hyperframes-check": { que: "Que la composición no tenga errores (textos ilegibles, piezas rotas).", hacer: "Mira el detalle: si dice «contrast», cambia el texto o su posición; si no, avisa." },
  licencias: { que: "Que tengas derecho a usar todo lo que aparece.", hacer: "Si es un clip de otra persona, publica sólo con su permiso o dentro de su campaña. La música sin licencia clara: cámbiala." },
  alineacion: { que: "Que los subtítulos digan lo que se oye y vayan al tiempo con la voz.", hacer: "En cada escena, «Revisarlas una por una»: escucha las palabras marcadas y confírmalas, corrígelas o recórtalas." },
  ritmo: { que: "Que los cortes caigan al ritmo de la música.", hacer: "Es un aviso: usa «Alinear cortes al ritmo» o cambia la música." },
  clip: { que: "Que el clip respete las reglas: crédito al creador, sin leaks, piratería ni «oficial», y la duración de la campaña.", hacer: "Cambia el título o el gancho, o ajusta la duración. El crédito se pone solo en la descripción." },
};

export function explicar(id: string): Explicacion {
  return MAPA[id] ?? { que: "Revisión técnica.", hacer: "Mira el detalle técnico; si no lo entiendes, avisa.", tecnico: true };
}

/** Los límites de la regla «subtitulos» (los mismos que `OBJETIVO` de qc.ts; una prueba lo vigila). */
export const LIMITES_SUBTITULOS = { maxCps: 17, maxCaracteresLinea: 42, maxLineas: 2 } as const;

/** Una frase que el QC marcó, sacada de su `detalle`. */
export interface FraseQc {
  texto: string;
  lineas: number;
  caracteresLinea: number;
  cps: number;
  /** Segundo del video donde aparece. */
  t: number;
  /** Pasa demasiado rápido para leerla. */
  rapida: boolean;
  /** No cabe en dos líneas cortas. */
  larga: boolean;
}

const RE_FRASE = /^«(.*)» \((\d+) líneas, (\d+) car\.\/línea, ([\d.]+) car\.\/s, ([\d.]+) s\)$/;

/** Las frases que listó la regla de subtítulos del QC (una por línea de `detalle`). */
export function frasesQc(detalle?: string): FraseQc[] {
  return (detalle ?? "").split("\n").flatMap((l) => {
    const m = RE_FRASE.exec(l.trim());
    if (!m) return [];
    const [lineas, caracteresLinea, cps, t] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
    return [{
      texto: m[1]!, lineas, caracteresLinea, cps, t,
      rapida: cps > LIMITES_SUBTITULOS.maxCps,
      larga: lineas > LIMITES_SUBTITULOS.maxLineas || caracteresLinea > LIMITES_SUBTITULOS.maxCaracteresLinea,
    }];
  });
}

/**
 * UX-01: la explicación de una regla que falló según su causa real. La de subtítulos falla casi siempre
 * por ritmo (más de 17 letras por segundo) y el consejo genérico hablaba de «líneas cortas»; además se
 * devuelven las frases que fallan, para señalarlas en su escena.
 */
export function explicarRegla(r: { id: string; medido?: unknown; detalle?: string }): Explicacion & { frases: FraseQc[] } {
  const base = explicar(r.id);
  if (r.id !== "subtitulos" && r.id !== "subtitulos-ritmo") return { ...base, frases: [] };
  const frases = frasesQc(r.detalle);
  if (r.id === "subtitulos-ritmo") return { ...base, frases };
  const m = (r.medido ?? {}) as { peorCps?: number; peorCaracteresLinea?: number; peorLineas?: number };
  const rapida = frases.length ? frases.some((f) => f.rapida) : (m.peorCps ?? 0) > LIMITES_SUBTITULOS.maxCps;
  const larga = frases.length
    ? frases.some((f) => f.larga)
    : (m.peorLineas ?? 0) > LIMITES_SUBTITULOS.maxLineas || (m.peorCaracteresLinea ?? 0) > LIMITES_SUBTITULOS.maxCaracteresLinea;
  if (rapida && !larga) return { que: "Que dé tiempo a leer cada subtítulo.", hacer: "Estas frases pasan muy rápido: acórtalas un poco (no cambia lo que se oye).", frases };
  if (rapida && larga) return { que: "Que los subtítulos se puedan leer: cortos y sin pasar muy rápido.", hacer: "Estas frases son largas o pasan muy rápido: acórtalas un poco (no cambia lo que se oye).", frases };
  if (larga) return { que: base.que, hacer: "Estas frases no caben en dos líneas cortas: acórtalas (no cambia lo que se oye).", frases };
  return { ...base, frases };
}

/** «pasa muy rápido (19,2 letras por segundo)» / «es muy larga (3 líneas)». */
export function porQueFalla(f: FraseQc): string {
  const partes: string[] = [];
  if (f.rapida) partes.push(`pasa muy rápido (${f.cps.toFixed(1).replace(".", ",")} letras por segundo; lo cómodo es hasta ${LIMITES_SUBTITULOS.maxCps})`);
  if (f.larga) partes.push(f.lineas > LIMITES_SUBTITULOS.maxLineas ? `es muy larga (${f.lineas} líneas)` : "tiene una línea muy larga");
  return partes.join(" y ");
}

export interface Resumen {
  estado: "listo" | "con-avisos" | "falta";
  titulo: string;
  bloquean: { id: string; nombre: string; detalle?: string; medido?: unknown }[];
  avisos: { id: string; nombre: string; detalle?: string; medido?: unknown }[];
}

/** Resumen para la persona: ¿se puede publicar?, y qué falta o conviene mirar. */
export function resumirQc(reglas: { id: string; nombre: string; ok: boolean; aviso?: boolean; detalle?: string; medido?: unknown }[]): Resumen {
  const bloquean = reglas.filter((r) => !r.ok && !r.aviso).map(({ id, nombre, detalle, medido }) => ({ id, nombre, detalle, medido }));
  const avisos = reglas.filter((r) => !r.ok && r.aviso).map(({ id, nombre, detalle, medido }) => ({ id, nombre, detalle, medido }));
  if (bloquean.length) return { estado: "falta", titulo: `Falta arreglar ${bloquean.length === 1 ? "1 cosa" : `${bloquean.length} cosas`} antes de publicar`, bloquean, avisos };
  if (avisos.length) return { estado: "con-avisos", titulo: "Listo para publicar, con cosas para mirar", bloquean, avisos };
  return { estado: "listo", titulo: "Listo para publicar", bloquean, avisos };
}
