/**
 * Permiso de Google Forms para pedirle al cliente los datos de su invitación (formularios.ts).
 * Mismo esquema que las redes (docs/PUBLICAR.md §6): OAuth con PKCE, la vuelta pasa por
 * /api/cuentas/callback/formularios (así la app de escritorio abre y cierra su ventana de inicio de
 * sesión como con YouTube), y el token queda cifrado con la clave de Geeper en un archivo privado.
 *
 * Referencias (revisadas 2026-11):
 * - OAuth para apps web: https://developers.google.com/identity/protocols/oauth2/web-server
 * - Forms API v1: https://developers.google.com/workspace/forms/api/reference/rest
 */
import path from "node:path";
import { z } from "zod";
import { leerPrivado, noExiste, escribirPrivado } from "../redes/archivo-privado";
import { cifrar, descifrar } from "../redes/cifrado";
import { dirConfig, leerConfig, rutaRedes, urlBase } from "../redes/config";
import { formulario as cuerpoFormulario } from "../redes/http";
import { registrarSecreto, tapar } from "../redes/secretos";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
export const API_FORMS = "https://forms.googleapis.com/v1";
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
];
const TIMEOUT_MS = 30_000;

export const urlVueltaGoogle = () => `${urlBase()}/api/cuentas/callback/formularios`;
const rutaToken = () => path.join(dirConfig(), "google-formularios.json");

/** La app de Google: la propia de formularios o, si no hay, la de YouTube (es el mismo tipo de cliente). */
export function appGoogle(): { clientId: string; clientSecret: string; deYoutube: boolean } | null {
  let c;
  try {
    c = leerConfig();
  } catch {
    return null;
  }
  if (c.formularios) return { ...c.formularios, deYoutube: false };
  if (c.youtube) return { ...c.youtube, deYoutube: true };
  return null;
}

/** Guarda la app de Google de los formularios en redes.json (las demás redes quedan igual). */
export function guardarAppGoogle(datos: unknown): void {
  const { clientId, clientSecret } = z.object({ clientId: z.string().trim().min(10, "Pega el ID de cliente"), clientSecret: z.string().trim().min(6, "Pega el secreto del cliente") }).parse(datos);
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("El ID de cliente de Google termina en «.apps.googleusercontent.com». Revisa que copiaste el correcto.");
  escribirPrivado(rutaRedes(), `${JSON.stringify({ ...leerConfig(), formularios: { clientId, clientSecret } }, null, 2)}\n`);
}

const Token = z.object({ refresh: z.string(), acceso: z.string(), vence: z.number(), correo: z.string().optional() });
type Token = z.infer<typeof Token>;

function leerToken(): Token | null {
  try {
    const t = Token.parse(JSON.parse(descifrar(leerPrivado(rutaToken()).toString("utf8"))));
    registrarSecreto(t.refresh);
    registrarSecreto(t.acceso);
    return t;
  } catch (e) {
    if (noExiste(e)) return null;
    throw e;
  }
}

function guardarToken(t: Token) {
  escribirPrivado(rutaToken(), cifrar(JSON.stringify(t)));
}

export interface EstadoGoogle {
  /** Hay app de Google cargada (propia o la de YouTube). */
  app: boolean;
  deYoutube: boolean;
  conectado: boolean;
  correo?: string;
  vuelta: string;
}

export function estadoGoogle(): EstadoGoogle {
  const app = appGoogle();
  let t: Token | null = null;
  try {
    t = leerToken();
  } catch {
    /* clave cambiada o archivo dañado: se vuelve a conectar */
  }
  return { app: !!app, deYoutube: !!app?.deYoutube, conectado: !!t, correo: t?.correo, vuelta: urlVueltaGoogle() };
}

export function urlConexionGoogle(state: string, challenge: string): string {
  const app = appGoogle();
  if (!app) throw new Error("Falta la app de Google: cárgala en Invitaciones → «Pedir los datos con Google Forms».");
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: urlVueltaGoogle(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH}?${q}`;
}

interface RespToken {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

async function pedirToken(datos: Record<string, string | undefined>): Promise<RespToken> {
  const r = await fetch(TOKEN, { method: "POST", body: cuerpoFormulario(datos), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const texto = await r.text();
  if (!r.ok) {
    if (/invalid_grant/.test(texto)) throw new ErrorPermisoGoogle("Google ya no acepta el permiso (se venció o lo quitaste). Vuelve a conectar Google.");
    throw new Error(`Google no dio el permiso (${r.status}): ${tapar(texto).slice(0, 300)}`);
  }
  const j = JSON.parse(texto) as RespToken;
  registrarSecreto(j.access_token);
  registrarSecreto(j.refresh_token);
  return j;
}

export class ErrorPermisoGoogle extends Error {}

/** Correo de la cuenta, leído del id_token que manda Google por TLS (no se usa para autenticar). */
function correoDe(idToken?: string): string | undefined {
  try {
    const p = JSON.parse(Buffer.from(idToken!.split(".")[1]!, "base64url").toString("utf8")) as { email?: string };
    return typeof p.email === "string" ? p.email : undefined;
  } catch {
    return undefined;
  }
}

/** Canjea el código de la vuelta y guarda el permiso. */
export async function canjearGoogle(code: string, verifier: string): Promise<string | undefined> {
  const app = appGoogle();
  if (!app) throw new Error("Falta la app de Google");
  const j = await pedirToken({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: urlVueltaGoogle() });
  const previo = (() => {
    try {
      return leerToken();
    } catch {
      return null;
    }
  })();
  const refresh = j.refresh_token ?? previo?.refresh;
  if (!refresh) throw new Error("Google no dio un permiso duradero. Quita el acceso de Geeper en tu cuenta de Google (Seguridad → Apps de terceros) y vuelve a conectar.");
  const faltan = SCOPES.filter((s) => s.startsWith("https://") && j.scope && !j.scope.split(" ").includes(s));
  if (faltan.length) throw new Error("Falta marcar los permisos de Formularios en la pantalla de Google. Vuelve a conectar y deja marcadas todas las casillas.");
  const correo = correoDe(j.id_token) ?? previo?.correo;
  guardarToken({ refresh, acceso: j.access_token, vence: Date.now() + (j.expires_in ?? 3600) * 1000, correo });
  return correo;
}

export async function desconectarGoogle(): Promise<void> {
  const t = (() => {
    try {
      return leerToken();
    } catch {
      return null;
    }
  })();
  if (t) await fetch(REVOKE, { method: "POST", body: cuerpoFormulario({ token: t.refresh }), signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
  const fs = await import("node:fs/promises");
  await fs.rm(rutaToken(), { force: true });
}

async function accesoVigente(): Promise<string> {
  const t = leerToken();
  if (!t) throw new ErrorPermisoGoogle("Conecta tu cuenta de Google para crear y leer los formularios.");
  if (t.vence - 60_000 > Date.now()) return t.acceso;
  const app = appGoogle();
  if (!app) throw new Error("Falta la app de Google");
  const j = await pedirToken({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: app.clientId, client_secret: app.clientSecret });
  guardarToken({ ...t, acceso: j.access_token, refresh: j.refresh_token ?? t.refresh, vence: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

/** Llamada a la Forms API con el permiso guardado. Los errores salen en palabras simples y sin tokens. */
export async function forms<T>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const acceso = await accesoVigente();
  const r = await fetch(`${API_FORMS}${ruta}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${acceso}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const texto = await r.text();
  if (!r.ok) {
    if (r.status === 401) throw new ErrorPermisoGoogle("Google pidió volver a conectar la cuenta.");
    if (r.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(texto)) {
      throw new Error("Falta activar «Google Forms API» en tu proyecto de Google Cloud (Biblioteca de APIs → Google Forms API → Habilitar). Después de 2 o 3 minutos, vuelve a intentarlo.");
    }
    if (r.status === 404) throw new Error("Ese formulario ya no existe en Google (¿lo borraste?).");
    throw new Error(`Google Forms respondió ${r.status}: ${tapar(texto).slice(0, 300)}`);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}
