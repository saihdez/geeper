/**
 * Catálogo de las escenas 3D (lo usan la página y el servidor; sin imports de Node). Cada plantilla está
 * hecha en py/blender/escena3d.py; aquí va lo que la persona ve y puede cambiar.
 */

export const PLANTILLAS_3D = ["texto", "personaje", "datos", "logo", "producto", "fondo", "caja"] as const;
export type Plantilla3d = (typeof PLANTILLAS_3D)[number];

export type Campo3d = "texto" | "logo" | "imagen" | "estilo" | "movimiento" | "estilo_fondo" | "colores_logo" | "datos" | "personaje" | "dialogo";

export interface InfoPlantilla3d {
  id: Plantilla3d;
  nombre: string;
  /** Una frase: para qué sirve. */
  para: string;
  campos: Campo3d[];
  /** Campos que hacen falta sí o sí. */
  obligatorios: Campo3d[];
  /** Qué colores usa y cómo se llaman para esta plantilla. */
  colores: { principal: string; acento: string | null };
  /** Texto de ejemplo para el campo «texto». */
  ejemploTexto?: string;
  etiquetaTexto?: string;
}

export const INFO_PLANTILLAS: Record<Plantilla3d, InfoPlantilla3d> = {
  texto: {
    id: "texto", nombre: "Título en 3D", para: "Una frase grande en 3D que entra con movimiento. Para abrir un video o anunciar algo.",
    campos: ["texto", "estilo", "movimiento"], obligatorios: ["texto"], colores: { principal: "Color de las letras", acento: null },
    ejemploTexto: "¡Oferta del día!", etiquetaTexto: "¿Qué dice?",
  },
  personaje: {
    id: "personaje", nombre: "Personaje que habla", para: "Un personaje 3D dice lo que escribas con la voz que elijas: mueve la boca, parpadea y hace gestos.",
    campos: ["personaje", "dialogo"], obligatorios: ["dialogo"], colores: { principal: "Color del personaje", acento: "Color de los detalles" },
  },
  datos: {
    id: "datos", nombre: "Gráfico con tus datos", para: "Barras, un anillo o un número grande que se arman solos con tus cifras. Para explicar algo con números.",
    campos: ["datos", "texto", "estilo"], obligatorios: ["datos"], colores: { principal: "Color de las barras", acento: "Color para resaltar" },
    ejemploTexto: "Ventas por mes", etiquetaTexto: "Título del gráfico (opcional)",
  },
  logo: {
    id: "logo", nombre: "Tu logo en 3D", para: "Tu logo gira, entra y le pasa un brillo. Para el inicio o el cierre.",
    campos: ["logo", "estilo", "colores_logo"], obligatorios: ["logo"], colores: { principal: "Color del logo (si no usas los suyos)", acento: null },
  },
  producto: {
    id: "producto", nombre: "Tu producto en un pedestal", para: "La foto de tu producto flota sobre un pedestal que gira, con su precio arriba.",
    campos: ["imagen", "texto", "estilo"], obligatorios: ["imagen"], colores: { principal: "Color del pedestal", acento: "Color del precio y del aro" },
    ejemploTexto: "$19.99", etiquetaTexto: "Precio o frase corta (opcional)",
  },
  fondo: {
    id: "fondo", nombre: "Fondo en movimiento", para: "Formas que flotan sin parar (se repite sin cortes). Para poner detrás de textos.",
    campos: ["estilo_fondo"], obligatorios: [], colores: { principal: "Color 1", acento: "Color 2" },
  },
  caja: {
    id: "caja", nombre: "Caja sorpresa", para: "Una caja de regalo se sacude, se abre con confeti y aparece tu mensaje o tu foto.",
    campos: ["texto", "imagen", "estilo"], obligatorios: [], colores: { principal: "Color de la caja", acento: "Color de la cinta y del mensaje" },
    ejemploTexto: "¡Nuevo!", etiquetaTexto: "¿Qué aparece? (o sube una foto)",
  },
};

export const ESTILOS_3D = [
  { id: "brillante", titulo: "Brillante", texto: "Como plástico pulido: colores vivos." },
  { id: "metal", titulo: "Metal", texto: "Refleja la luz como metal." },
  { id: "mate", titulo: "Mate", texto: "Suave, sin brillos." },
] as const;
export type Estilo3d = (typeof ESTILOS_3D)[number]["id"];

export const MOVIMIENTOS_3D = [
  { id: "entra", titulo: "Entra girando", texto: "Aparece de lejos dando media vuelta." },
  { id: "rebota", titulo: "Cae y rebota", texto: "Cae desde arriba y rebota." },
  { id: "gira", titulo: "Se balancea", texto: "Ya está en su lugar y se mueve suave." },
] as const;
export type Movimiento3d = (typeof MOVIMIENTOS_3D)[number]["id"];

export const FONDOS_3D = [
  { id: "burbujas", titulo: "Burbujas", texto: "Gotas grandes que se juntan y se separan." },
  { id: "particulas", titulo: "Partículas de luz", texto: "Puntitos que suben brillando." },
] as const;
export type EstiloFondo3d = (typeof FONDOS_3D)[number]["id"];

export const PERSONAJES_3D = [
  { id: "bolita", titulo: "Bolita", texto: "Una mascota redonda y simpática, con ojos grandes." },
  { id: "robot", titulo: "Robot", texto: "Un robot con pantalla por cara y luces." },
] as const;
export type Personaje3d = (typeof PERSONAJES_3D)[number]["id"];
/** Lo que dice el personaje: hasta 600 letras (cerca de 40 segundos de voz). */
export const MAX_DIALOGO = 600;
export const MAX_SEGUNDOS_PERSONAJE = 60;

export const TIPOS_DATOS_3D = [
  { id: "barras", titulo: "Barras", texto: "Para comparar cosas (meses, productos, países)." },
  { id: "numero", titulo: "Un número grande", texto: "Un dato que impacta. Con «%» se llena un aro." },
  { id: "pastel", titulo: "Anillo por partes", texto: "Cómo se reparte un todo (porcentajes)." },
] as const;
export type TipoDatos3d = (typeof TIPOS_DATOS_3D)[number]["id"];
export const MAX_DATOS_3D = 6;

/** Video o una imagen fija (portada, publicación, foto de producto). */
export const SALIDAS_3D = [
  { id: "video", titulo: "Video", texto: "Con movimiento." },
  { id: "imagen", titulo: "Imagen", texto: "Una foto fija: portada, publicación o foto de producto." },
] as const;
export type Salida3d = (typeof SALIDAS_3D)[number]["id"];

/** Detrás de la escena: el color elegido, una foto tuya o nada (para ponerla encima de otro video). */
export const FONDOS_SALIDA_3D = [
  { id: "color", titulo: "Color", texto: "Los colores que elegiste." },
  { id: "foto", titulo: "Una foto tuya", texto: "Lo 3D aparece delante de tu foto." },
  { id: "transparente", titulo: "Transparente", texto: "Sin fondo: para ponerlo encima de otro video o imagen." },
] as const;
export type FondoSalida3d = (typeof FONDOS_SALIDA_3D)[number]["id"];

export const COLORES_LOGO = [
  { id: "originales", titulo: "Los colores de tu logo", texto: "Sólo con un logo SVG." },
  { id: "principal", titulo: "Un solo color", texto: "Todo el logo del color que elijas." },
] as const;

export interface Colores3d {
  fondo: string;
  fondo2: string | null;
  principal: string;
  acento: string;
}

/** Combinaciones listas, para no tener que elegir cuatro colores. */
export const PALETAS_3D: { id: string; nombre: string; colores: Colores3d }[] = [
  { id: "noche", nombre: "Noche dorada", colores: { fondo: "#14213d", fondo2: "#05070d", principal: "#fca311", acento: "#ffffff" } },
  { id: "neon", nombre: "Neón", colores: { fondo: "#1a0b2e", fondo2: "#05010a", principal: "#ff2e88", acento: "#2ef2ff" } },
  { id: "fresco", nombre: "Fresco", colores: { fondo: "#e9f5f2", fondo2: "#b9e4dc", principal: "#0f8b8d", acento: "#ec9a29" } },
  { id: "pastel", nombre: "Pastel", colores: { fondo: "#fff1f3", fondo2: "#ffd6e0", principal: "#ff8fab", acento: "#6c63ff" } },
  { id: "fuego", nombre: "Fuego", colores: { fondo: "#2b0a0a", fondo2: "#000000", principal: "#ff4d00", acento: "#ffd166" } },
  { id: "limpio", nombre: "Limpio", colores: { fondo: "#f4f4f4", fondo2: null, principal: "#111111", acento: "#e63946" } },
];

export const CALIDADES_3D = [
  { id: "rapida", titulo: "Rápida", texto: "Para probar. Un poco de grano en sombras.", minutosPor5s: 1 },
  { id: "normal", titulo: "Normal", texto: "Lista para publicar.", minutosPor5s: 3 },
  { id: "alta", titulo: "Alta", texto: "La más limpia, con desenfoque de movimiento.", minutosPor5s: 8 },
] as const;
export type Calidad3d = (typeof CALIDADES_3D)[number]["id"];

export const FORMATOS_3D = [
  { id: "9:16", titulo: "Vertical", texto: "TikTok, Reels, Shorts" },
  { id: "1:1", titulo: "Cuadrado", texto: "Publicación de Instagram" },
  { id: "16:9", titulo: "Horizontal", texto: "YouTube" },
] as const;
export type Formato3d = (typeof FORMATOS_3D)[number]["id"];

export const DURACION_3D = { min: 3, max: 15, porDefecto: 5 } as const;

/** Minutos estimados en la tarjeta de video (función pura; sin tarjeta, unas 10 veces más). Una imagen es un solo cuadro. */
export function minutosEstimados(calidad: Calidad3d, segundos: number, conGpu = true, salida: Salida3d = "video"): number {
  if (salida === "imagen") return conGpu ? 1 : 3;
  const base = CALIDADES_3D.find((c) => c.id === calidad)?.minutosPor5s ?? 3;
  return Math.max(1, Math.round((base * segundos) / 5 * (conGpu ? 1 : 10)));
}
