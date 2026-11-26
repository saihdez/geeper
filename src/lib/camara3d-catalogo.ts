/** Movimientos de la cámara 3D sobre una foto (camara3d.ts, py/blender/camara3d.py). Sin imports de Node. */
export const MOVIMIENTOS_CAMARA3D = [
  { id: "acercar", titulo: "Acercarse", texto: "La cámara avanza hacia lo importante; el fondo queda atrás." },
  { id: "lateral", titulo: "Pasar de lado", texto: "La cámara se desliza: lo de adelante pasa más rápido que el fondo." },
  { id: "orbitar", titulo: "Rodear", texto: "La cámara gira un poco alrededor del sujeto." },
  { id: "alejar", titulo: "Alejarse", texto: "Empieza cerca y se abre para mostrar más." },
  { id: "subir", titulo: "Subir", texto: "La cámara sube despacio, como una grúa." },
] as const;
export type MovimientoCamara3d = (typeof MOVIMIENTOS_CAMARA3D)[number]["id"];

export const INTENSIDADES_CAMARA3D = [
  { id: "suave", titulo: "Suave", texto: "Casi no se nota que es una foto.", valor: 0.7 },
  { id: "normal", titulo: "Normal", texto: "Profundidad clara, natural.", valor: 1 },
  { id: "marcada", titulo: "Marcada", texto: "Más relieve; en fotos con bordes finos puede deformar.", valor: 1.35 },
] as const;
export type IntensidadCamara3d = (typeof INTENSIDADES_CAMARA3D)[number]["id"];

/**
 * Movimiento que se elige solo para la escena `indice` (función pura): va cambiando de escena a escena para
 * que el video no repita el mismo; con una cara, acercarse o rodear (lo que mejor queda con una persona).
 */
export function movimientoAuto(indice: number, conCara: boolean): MovimientoCamara3d {
  const rueda: MovimientoCamara3d[] = conCara ? ["acercar", "orbitar"] : ["acercar", "lateral", "orbitar", "alejar", "subir"];
  return rueda[indice % rueda.length]!;
}
