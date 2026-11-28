import { NextResponse, type NextRequest } from "next/server";
import { canjearGoogle } from "@/lib/invitaciones/google";
import { abrir, COOKIE_OAUTH } from "@/lib/redes/oauth";
import { tapar } from "@/lib/redes/secretos";

export const dynamic = "force-dynamic";

/** Vuelta a /invitaciones (dirección relativa, ver callback/[red]) y siempre se borra la cookie de OAuth. */
function volver(req: NextRequest, params: Record<string, string>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, tapar(v).slice(0, 500));
  const res = new NextResponse(null, { status: 302, headers: { Location: `/invitaciones?${q}` } });
  res.cookies.set(COOKIE_OAUTH, "", { httpOnly: true, sameSite: "lax", path: "/api/cuentas", maxAge: 0, secure: req.nextUrl.protocol === "https:" });
  return res;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const errorGoogle = q.get("error");
    if (errorGoogle) return volver(req, { google: "error", error: errorGoogle === "access_denied" ? "No diste el permiso en Google." : `Google no dio el permiso: ${errorGoogle}` });
    const estado = abrir(req.cookies.get(COOKIE_OAUTH)?.value, "formularios", q.get("state"));
    const code = q.get("code");
    if (!code) return volver(req, { google: "error", error: "Google volvió sin código de autorización" });
    await canjearGoogle(code, estado.verifier);
    return volver(req, { google: "ok" });
  } catch (e) {
    return volver(req, { google: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
