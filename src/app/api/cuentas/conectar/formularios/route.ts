import { NextResponse } from "next/server";
import { urlConexionGoogle } from "@/lib/invitaciones/google";
import { challenge, COOKIE_OAUTH, DURACION_OAUTH_MS, nuevoEstado, sellar } from "@/lib/redes/oauth";
import { privadosBloquean } from "@/lib/redes/privados";
import { tapar } from "@/lib/redes/secretos";

export const dynamic = "force-dynamic";

function volver(error: string) {
  const q = new URLSearchParams({ google: "error", error: tapar(error).slice(0, 500) });
  return new NextResponse(null, { status: 302, headers: { Location: `/invitaciones?${q}` } });
}

/**
 * Conectar Google para los formularios de las invitaciones. Vive bajo /api/cuentas (como las redes) para
 * que la app de escritorio lo abra en su ventana de inicio de sesión y la cookie de OAuth sea la misma.
 */
export async function GET(req: Request) {
  try {
    if (privadosBloquean()) return volver("Tus datos de acceso no están protegidos. Ve a Cuentas, pulsa «Protegerlos ahora» y vuelve a intentarlo.");
    const estado = nuevoEstado("formularios");
    const res = NextResponse.redirect(urlConexionGoogle(estado.state, challenge(estado.verifier)), 302);
    res.cookies.set(COOKIE_OAUTH, sellar(estado), {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/cuentas",
      maxAge: Math.round(DURACION_OAUTH_MS / 1000),
      secure: new URL(req.url).protocol === "https:",
    });
    return res;
  } catch (e) {
    return volver(e instanceof Error ? e.message : String(e));
  }
}
