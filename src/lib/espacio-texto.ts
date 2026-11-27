/**
 * Textos del espacio en disco (DSC-05), sin nada de Node: los usan el servidor (espacio.ts) y la pantalla
 * Sistema (liberar-espacio.tsx).
 */

/** Bytes en palabras: «1,4 GB», «320 MB», «12 KB». */
export function bytesLegibles(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("es", { maximumFractionDigits: 1 })} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6).toLocaleString("es")} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("es")} KB`;
  return `${n} bytes`;
}

/** Lo que se mide de un disco. */
export interface MedidaDisco {
  /** Bytes que se pueden usar todavía. */
  libre: number;
  /** Tamaño del disco (en WSL, el de Linux). */
  total: number;
  /** Nombre del disco para la persona: «C:», «D:» o «el disco». */
  disco: string;
  /**
   * En WSL: el número sale del disco de Windows donde vive el de Linux (DSC-06). Linux cree tener más,
   * pero su disco sólo crece mientras quede lugar en C:.
   */
  enWindows: boolean;
}

/** Reserva que siempre se deja libre: si C: se llena, WSL queda en sólo lectura a mitad de un trabajo. */
export const MARGEN_DISCO = 20e9;

const enDisco = (m: Pick<MedidaDisco, "disco">) => (m.disco === "el disco" ? "en el disco" : `en el disco ${m.disco}`);

/** «Quedan 148 GB libres en el disco C:.» con la aclaración de WSL si hace falta. */
export function textoLibre(m: MedidaDisco): string {
  const base = `Quedan ${bytesLegibles(m.libre)} libres ${enDisco(m)}.`;
  return m.enWindows ? `${base} Ahí vive también el disco de Linux donde trabaja Geeper.` : base;
}

/** Cuánto falta para hacer algo que ocupa `necesario` bytes dejando la reserva; 0 si alcanza. */
export function faltaParaUsar(m: Pick<MedidaDisco, "libre">, necesario: number, margen = MARGEN_DISCO): number {
  return Math.max(0, Math.ceil(necesario + margen - m.libre));
}

/**
 * El aviso cuando no alcanza, en palabras simples: qué se quería hacer, cuánto falta liberar y dónde.
 * `para` va sin mayúscula: «bajar los modelos», «subir este video», «crear el video».
 */
export function textoSinEspacio(m: MedidaDisco, necesario: number, para: string, margen = MARGEN_DISCO): string {
  const falta = faltaParaUsar(m, necesario, margen);
  return (
    `No hay lugar suficiente ${enDisco(m)} para ${para}: hay que liberar unos ${bytesLegibles(falta)}. ` +
    `Hacen falta ${bytesLegibles(necesario)} y quedan ${bytesLegibles(m.libre)} libres (siempre se dejan ${bytesLegibles(margen)} de reserva para que la computadora no se trabe). ` +
    "Puedes borrar lo que ya no uses en Sistema → «Liberar espacio»."
  );
}

/** Por debajo de esto, Sistema avisa: un modelo de IA o un video largo ya no entran tranquilos. */
export const AVISO_DISCO = 50e9;

/**
 * El chequeo «Espacio en disco» de Sistema: falla por debajo de la reserva, avisa por debajo de 50 GB.
 * En WSL recuerda que borrar dentro de Linux no devuelve el lugar a C: hasta compactar su disco.
 */
export function estadoDisco(m: MedidaDisco, margen = MARGEN_DISCO): { ok: boolean; aviso?: boolean; detalle: string; arreglo?: string } {
  const detalle = textoLibre(m);
  if (m.libre >= AVISO_DISCO) return { ok: true, detalle };
  const compactar = m.enWindows ? " Ojo: lo que borres dentro de Linux no vuelve solo a C:; para recuperarlo hay que compactar el disco de Linux (pídelo a quien te ayuda con la computadora)." : "";
  const arreglo = `Borra lo que ya no uses en «Liberar espacio», aquí arriba, o archivos grandes ${m.disco === "el disco" ? "del disco" : `de ${m.disco}`}.${compactar}`;
  if (m.libre < margen) return { ok: false, detalle: `${detalle} Es muy poco: no se podrán bajar modelos, subir videos largos ni crear videos.`, arreglo };
  return { ok: false, aviso: true, detalle: `${detalle} Queda poco: un modelo de IA o un video largo pueden no entrar.`, arreglo };
}
