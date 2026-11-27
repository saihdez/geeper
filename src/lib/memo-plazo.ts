/**
 * Guarda el resultado de una función cara durante `ms` y comparte la llamada en vuelo: si dos
 * pestañas piden a la vez, corre una sola vez. `forzar` ignora lo guardado (pero no duplica una en vuelo).
 */
export function memoConPlazo<T>(fn: () => Promise<T>, ms: number, ahora: () => number = Date.now) {
  let enVuelo: Promise<{ valor: T; cuando: number }> | null = null;
  let guardado: { valor: T; cuando: number } | null = null;
  const obtener = (forzar = false): Promise<{ valor: T; cuando: number }> => {
    if (enVuelo) return enVuelo;
    if (!forzar && guardado && ahora() - guardado.cuando < ms) return Promise.resolve(guardado);
    const p = fn()
      .then((valor) => {
        guardado = { valor, cuando: ahora() };
        return guardado;
      })
      .finally(() => {
        if (enVuelo === p) enVuelo = null;
      });
    enVuelo = p;
    return p;
  };
  return Object.assign(obtener, { olvidar: () => { guardado = null; } });
}
