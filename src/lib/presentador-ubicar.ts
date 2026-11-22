/**
 * Mover el presentador sin volver a generarlo. El video del avatar hablando no depende de dónde se ve:
 * esquina, tamaño y forma (círculo o rectángulo) son sólo el `marco` del clip en la pista del presentador
 * (marco.ts dibuja el recuadro). Cambiarlos es una versión nueva del proyecto en segundos, sin GPU.
 *
 * Lo que sí cambia el video y pide generarlo otra vez: otro avatar, otra forma de hablar, la voz cambiada
 * (la boca seguiría a la vieja) y pasar a o desde «recorte» (ese es otro video: cuerpo entero sin fondo).
 */
import { Marco, validarProyecto, type Clip, type Proyecto } from "./esquema";
import { MODELO_HABLAR, PISTA_PRESENTADOR } from "./presentador";

/** El clip del presentador en burbuja, si hay uno. */
export function clipBurbuja(p: Proyecto): Clip | null {
  const c = p.pistas.find((x) => x.id === PISTA_PRESENTADOR)?.clips.find((x) => p.assets[x.asset]?.regenerar.motor === MODELO_HABLAR);
  return c ?? null;
}

const esRecorte = (m: Partial<Marco> | undefined) => (m?.forma as string | undefined) === "recorte";

/** Por qué no se puede mover al instante (null si se puede). Función pura. */
export function motivoParaGenerar(p: Proyecto, marco: Partial<Marco>): string | null {
  const c = clipBurbuja(p);
  if (!c?.marco) return "Este video todavía no tiene el presentador en burbuja: hay que generarlo.";
  if (esRecorte(c.marco) !== esRecorte(marco)) return "Pasar a o desde «recorte» (cuerpo entero sin fondo) es otro video: hay que generarlo de nuevo.";
  return null;
}

/** El proyecto con la burbuja en su lugar nuevo (y el resto igual). Lanza un error si hay que generarlo. */
export function reubicarPresentador(original: Proyecto, marco: Partial<Marco>): Proyecto {
  const motivo = motivoParaGenerar(original, marco);
  if (motivo) throw new Error(motivo);
  const p = structuredClone(original);
  const c = clipBurbuja(p)!;
  c.marco = Marco.parse({ ...c.marco, ...marco });
  return validarProyecto(p);
}

/** Nota de la versión, en palabras. */
export function notaReubicar(antes: Marco, despues: Marco): string {
  const cambios: string[] = [];
  if (antes.esquina !== despues.esquina) cambios.push(`esquina ${despues.esquina === "auto" ? "automática" : despues.esquina.replace("-", " a la ")}`);
  if (antes.tamano !== despues.tamano) cambios.push(`tamaño ${Math.round(despues.tamano * 100)} %`);
  if (antes.forma !== despues.forma) cambios.push(`forma ${despues.forma}`);
  return `Presentador movido sin regenerar${cambios.length ? `: ${cambios.join(", ")}` : ""}`;
}
