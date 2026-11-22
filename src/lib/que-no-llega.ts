/**
 * Lo que otro editor no recibe del paquete (`paquete-editor.ts`), dicho para quien no edita video. Sin
 * dependencias de Node: lo usan la guía del .zip y la página del proyecto. La versión técnica es `NO_VIAJA`.
 */
export const QUE_NO_LLEGA = [
  "El estilo de los subtítulos: llegan como archivo aparte (.srt), con el texto y los tiempos.",
  "Los textos en pantalla (títulos, rótulos, citas): quedan como marcadores con su texto, para volver a ponerlos.",
  "El logo de la marca, el zoom en los cortes y la tarjeta final.",
  "Que la música baje sola cuando habla la voz (el volumen de la música sí llega).",
  "Movimientos de cámara, color, opacidad y transiciones que no sean un fundido.",
] as const;

/**
 * Lo que no llega igual al abrir en FilmCraft desde Geeper (filmcraft-capas.ts): ahí los textos, los
 * subtítulos, la marca, la tarjeta final y el presentador sí llegan, cada uno como una pieza aparte.
 */
export const QUE_NO_LLEGA_FILMCRAFT = [
  "Las animaciones de entrada de los textos y el resaltado palabra por palabra de los subtítulos (el texto y los tiempos sí llegan).",
  "El tipo de letra: FilmCraft usa Inter.",
  "El logo de la marca, el zoom en los cortes, el borde de la burbuja del presentador y el fondo borroso de las escenas que no llenan el cuadro.",
  "Que la música baje sola cuando habla la voz (el volumen de la música sí llega).",
  "Movimientos de cámara, color, efectos y transiciones que no sean un fundido.",
] as const;
