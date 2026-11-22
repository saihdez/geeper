import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { configurada } from "@/lib/redes/config";
import { esIdRed, obtenerRed } from "@/lib/redes/index";
import { privadosBloquean } from "@/lib/redes/privados";
import { challenge, COOKIE_OAUTH, DURACION_OAUTH_MS, nuevoEstado, sellar } from "@/lib/redes/oauth";
import { verificarSalida } from "@/lib/redes/salida";
import { tapar } from "@/lib/redes/secretos";

export const dynamic = "force-dynamic";

/** A /cuentas con el error. Dirección relativa, como en la vuelta (ESC-02: `req.url` dice localhost). */
function volver(error: string) {
  const q = new URLSearchParams({ error: tapar(error).slice(0, 500) });
  return new NextResponse(null, { status: 302, headers: { Location: `/cuentas?${q}` } });
}

/**
 * Arranca el OAuth: guarda state y code_verifier en una cookie firmada y manda a la pantalla oficial
 * de la red. `?cuenta=ID` reconecta una cuenta existente (la red igual pide elegir cuenta).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ red: string }> }) {
  const { red: idRed } = await ctx.params;
  try {
    if (!esIdRed(idRed)) return volver(`Red desconocida: ${idRed}`);
    const red = obtenerRed(idRed);
    if (privadosBloquean()) return volver("Tus datos de acceso no están protegidos. Pulsa «Protegerlos ahora» en esta página y vuelve a intentarlo.");
    if (!configurada(idRed)) return volver(`Falta la app de ${red.nombre}: cárgala en «Apps de las redes».`);
    const vpn = await verificarSalida();
    if (!vpn.ok) return volver(`No se conecta con el VPN en este estado: ${vpn.detalle}`);

    const cuentaId = req.nextUrl.searchParams.get("cuenta") || undefined;
    if (cuentaId) {
      const c = await db.cuenta.findUnique({ where: { id: cuentaId }, select: { red: true } });
      if (!c || c.red !== idRed) return volver("La cuenta a reconectar no existe o es de otra red");
    }

    const estado = nuevoEstado(idRed, cuentaId);
    const destino = red.urlConexion(estado.state, red.pkce ? challenge(estado.verifier, red.formatoChallenge) : "");
    const res = NextResponse.redirect(destino, 302);
    res.cookies.set(COOKIE_OAUTH, sellar(estado), {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/cuentas",
      maxAge: Math.round(DURACION_OAUTH_MS / 1000),
      secure: req.nextUrl.protocol === "https:",
    });
    return res;
  } catch (e) {
    return volver(e instanceof Error ? e.message : String(e));
  }
}
