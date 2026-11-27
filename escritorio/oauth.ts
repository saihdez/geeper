import { esDeGeeper } from "./reglas";

/** ¿Es la vuelta del OAuth (el redirect URI registrado en la red: localhost:3300/api/cuentas/callback/…)? */
export function esVueltaOAuth(destino: string): boolean {
  try {
    const u = new URL(destino);
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname.startsWith("/api/cuentas/callback/");
  } catch {
    return false;
  }
}

/** ¿La ventana principal va a «Conectar» una cuenta? Ese inicio de sesión se abre en su propia ventana. */
export function esInicioLogin(base: string, destino: string): boolean {
  return esDeGeeper(base, destino) && new URL(destino).pathname.startsWith("/api/cuentas/conectar/");
}

/**
 * Qué hace la ventana «Conectar cuenta» ante cada navegación o redirección (`base` = http://127.0.0.1:<puerto>):
 * - `llevar`: la red volvió al redirect URI registrado (http://localhost:3300/…), que no es la dirección
 *   real de Geeper (127.0.0.1 y quizá otro puerto). Se carga `a`: la misma ruta y parámetros en Geeper,
 *   donde está la cookie con el state y el verifier de PKCE.
 * - `terminar`: Geeper ya procesó la vuelta (o dio un error) y manda a una página suya: se muestra `a` en
 *   la ventana principal y se cierra la de inicio de sesión.
 * - `seguir`: la ruta de cuentas de Geeper o una página de la red por https.
 * Geeper con otro nombre (localhost y el mismo puerto) cuenta como Geeper y se lleva a `base`.
 * - `bloquear`: cualquier otra cosa (las páginas de inicio de sesión de las redes van siempre por https).
 */
export type PasoLogin = { tipo: "llevar"; a: string } | { tipo: "terminar"; a: string } | { tipo: "seguir" } | { tipo: "bloquear" };

export function pasoLogin(base: string, destino: string): PasoLogin {
  if (esVueltaOAuth(destino) && !esDeGeeper(base, destino)) {
    const u = new URL(destino);
    return { tipo: "llevar", a: `${base}${u.pathname}${u.search}` };
  }
  const propio = esDeGeeper(base, destino) ? destino : mismoGeeper(base, destino);
  if (propio) {
    if (!new URL(propio).pathname.startsWith("/api/cuentas/")) return { tipo: "terminar", a: propio };
    return propio === destino ? { tipo: "seguir" } : { tipo: "llevar", a: propio };
  }
  return destino.startsWith("https://") ? { tipo: "seguir" } : { tipo: "bloquear" };
}

/**
 * `destino` es Geeper con otro nombre (localhost en vez de 127.0.0.1, mismo puerto): Next escribe
 * localhost en las direcciones que arma con `req.url`. Se devuelve la misma ruta en `base`, o null.
 */
function mismoGeeper(base: string, destino: string): string | null {
  if (base === "") return null;
  try {
    const b = new URL(base);
    const d = new URL(destino);
    const local = (h: string) => ["localhost", "127.0.0.1", "[::1]"].includes(h);
    if (d.protocol !== "http:" || !local(d.hostname) || !local(b.hostname) || d.port !== b.port || d.username || d.password) return null;
    return `${b.origin}${d.pathname}${d.search}`;
  } catch {
    return null;
  }
}
