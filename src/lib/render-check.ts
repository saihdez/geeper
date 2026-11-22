/**
 * Lectura de la salida de `hyperframes check --json` (WRK-12). Si la salida no es JSON con `ok`
 * booleano (npx sin red, Chrome que no abre, salida cortada) se lanza: el paso no se da por hecho y no
 * se guarda su manifiesto, así que el próximo render vuelve a revisar en vez de aprobar a ciegas.
 */

export interface ResumenCheck {
  ok: boolean;
  errores: number;
  avisos: number;
  resumen: string;
}

export const NO_SE_PUDO_REVISAR = "No se pudo revisar la composición. Vuelve a intentarlo.";

function contarHallazgos(v: unknown, acc: { errores: string[]; avisos: number }) {
  if (Array.isArray(v)) v.forEach((x) => contarHallazgos(x, acc));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.severity === "error") acc.errores.push(`${String(o.code ?? "")}: ${String(o.message ?? "")}`.slice(0, 300));
    else if (o.severity === "warning") acc.avisos++;
    Object.values(o).forEach((x) => contarHallazgos(x, acc));
  }
}

/** Resume la salida del check; lanza `NO_SE_PUDO_REVISAR` si no es JSON con `ok` booleano. */
export function leerCheck(stdout: string): ResumenCheck {
  let j: unknown;
  try {
    j = JSON.parse(stdout);
  } catch {
    throw new Error(NO_SE_PUDO_REVISAR);
  }
  if (!j || typeof j !== "object" || Array.isArray(j) || typeof (j as { ok?: unknown }).ok !== "boolean") throw new Error(NO_SE_PUDO_REVISAR);
  const acc = { errores: [] as string[], avisos: 0 };
  contarHallazgos(j, acc);
  return { ok: (j as { ok: boolean }).ok, errores: acc.errores.length, avisos: acc.avisos, resumen: acc.errores.slice(0, 5).join("\n") };
}
