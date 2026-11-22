/**
 * REN-12: `hyperframes check` y el render del crudo a la vez, no uno detrás del otro.
 *
 * El check tarda de 1 a 13 s (mediana 4,6) y antes el render lo esperaba. Ahora arrancan juntos; si el
 * check encuentra errores (o falla), se corta el render con su señal y se lanza el error del check. Si
 * el render falla, se corta el check. Cada uno corre en su propia carpeta (`render.ts` escribe el
 * proyecto dos veces con enlaces duros) para que no se pisen el estado `.hyperframes`.
 *
 * `GEEPER_RENDER_CHECK_A_LA_VEZ=0` vuelve al orden de antes (check y después render), para comparar
 * tiempos o si la captura se resiente por compartir CPU con el check.
 */

type Entorno = Record<string, string | undefined>;

export const checkALaVez = (env: Entorno = process.env) => env.GEEPER_RENDER_CHECK_A_LA_VEZ !== "0";

export interface OpcionesCheckYRender {
  signal?: AbortSignal;
  /** true: el check y el render arrancan juntos. false: primero el check, después el render. */
  aLaVez: boolean;
}

export async function checkYRender<C, R>(
  check: (signal: AbortSignal) => Promise<C>,
  render: (signal: AbortSignal) => Promise<R>,
  op: OpcionesCheckYRender,
): Promise<{ check: C; render: R }> {
  const corte = new AbortController();
  const alCortar = () => corte.abort(op.signal?.reason);
  if (op.signal?.aborted) alCortar();
  else op.signal?.addEventListener("abort", alCortar, { once: true });
  try {
    if (!op.aLaVez) {
      const c = await check(corte.signal);
      return { check: c, render: await render(corte.signal) };
    }
    // La primera que falla corta a la otra y su error es el que se lanza (el de la otra sólo diría
    // «se canceló»). Se esperan las dos para no dejar procesos sueltos.
    let primero: { error: unknown } | null = null;
    const alFallar = (e: unknown) => {
      if (!primero) primero = { error: e };
      corte.abort(e);
      throw e;
    };
    const pc = check(corte.signal).catch(alFallar);
    const pr = render(corte.signal).catch(alFallar);
    const [rc, rr] = await Promise.allSettled([pc, pr]);
    if (rc.status === "rejected" || rr.status === "rejected") throw (primero as { error: unknown } | null)?.error ?? (rc.status === "rejected" ? rc.reason : (rr as PromiseRejectedResult).reason);
    return { check: rc.value, render: rr.value };
  } finally {
    op.signal?.removeEventListener("abort", alCortar);
  }
}
