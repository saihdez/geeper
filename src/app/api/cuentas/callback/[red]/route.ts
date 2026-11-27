import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guardarCuentas } from "@/lib/redes/cuentas";
import { esIdRed, obtenerRed } from "@/lib/redes/index";
import { abrir, COOKIE_OAUTH } from "@/lib/redes/oauth";
import { verificarSalida } from "@/lib/redes/salida";
import { tapar } from "@/lib/redes/secretos";

export const dynamic = "force-dynamic";

/**
 * Vuelve a /cuentas sin el código ni el state en la URL, y siempre borra la cookie de OAuth. La dirección
 * va relativa (ESC-02): `req.url` de Next cambia 127.0.0.1 por localhost, y en la app de escritorio esa
 * vuelta ya no sería Geeper (la ventana de inicio de sesión quedaba en blanco). Relativa, el navegador
 * vuelve por la misma dirección por la que entró.
 */
function volver(req: NextRequest, params: Record<string, string>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, k === "ok" ? v : tapar(v).slice(0, 500));
  const res = new NextResponse(null, { status: 302, headers: { Location: `/cuentas?${q}` } });
  res.cookies.set(COOKIE_OAUTH, "", { httpOnly: true, sameSite: "lax", path: "/api/cuentas", maxAge: 0, secure: req.nextUrl.protocol === "https:" });
  return res;
}

/** La red vuelve aquí con `code` y `state`: se valida la cookie, se canjea y se guardan las cuentas. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ red: string }> }) {
  const { red: idRed } = await ctx.params;
  const q = req.nextUrl.searchParams;
  try {
    if (!esIdRed(idRed)) return volver(req, { error: `Red desconocida: ${idRed}` });
    const red = obtenerRed(idRed);
    const errorRed = q.get("error");
    if (errorRed) {
      const desc = q.get("error_description") ?? q.get("error_reason") ?? "";
      return volver(req, { error: `${red.nombre} no dio el permiso: ${errorRed}${desc ? ` (${desc})` : ""}` });
    }
    const estado = abrir(req.cookies.get(COOKIE_OAUTH)?.value, idRed, q.get("state"));
    const code = q.get("code");
    if (!code) return volver(req, { error: `${red.nombre} volvió sin código de autorización` });
    const vpn = await verificarSalida();
    if (!vpn.ok) return volver(req, { error: `No se canjea el permiso con el VPN en este estado: ${vpn.detalle}` });

    const nuevas = await red.canjear(code, estado.verifier);
    if (nuevas.length === 0) return volver(req, { error: `${red.nombre} no devolvió ninguna cuenta (¿la cuenta es del tipo que pide la red?)` });
    const guardadas = await guardarCuentas(idRed, nuevas);
    const params: Record<string, string> = { ok: String(guardadas.length) };
    if (estado.cuentaId && !guardadas.some((c) => c.id === estado.cuentaId)) {
      const previa = await db.cuenta.findUnique({ where: { id: estado.cuentaId }, select: { usuario: true, alias: true } });
      if (previa) params.aviso = `Se conectó otra cuenta que la que querías reconectar (${previa.alias ?? previa.usuario}); esa sigue igual.`;
    }
    return volver(req, params);
  } catch (e) {
    return volver(req, { error: e instanceof Error ? e.message : String(e) });
  }
}
