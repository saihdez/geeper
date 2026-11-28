/**
 * PKCE y state de OAuth. El state y el code_verifier viajan en una cookie firmada, httpOnly, que
 * dura 10 minutos; el verifier nunca sale de la PC (PUBLICAR.md §6).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { firmar } from "./cifrado";
import type { IdRed } from "./tipos";

export const COOKIE_OAUTH = "geeper_oauth";
export const DURACION_OAUTH_MS = 10 * 60_000;

export function nuevoVerifier(): string {
  return randomBytes(48).toString("base64url"); // 64 caracteres, dentro de 43–128
}

export function challenge(verifier: string, formato: "S256" | "S256-hex" = "S256"): string {
  const h = createHash("sha256").update(verifier);
  return formato === "S256-hex" ? h.digest("hex") : h.digest("base64url");
}

/** Además de las redes, el permiso de Google Forms para las invitaciones (invitaciones/google.ts). */
export type IdOauth = IdRed | "formularios";

export interface EstadoOauth {
  red: IdOauth;
  state: string;
  verifier: string;
  /** Si se reconecta una cuenta concreta. */
  cuentaId?: string;
  exp: number;
}

export function nuevoEstado(red: IdOauth, cuentaId?: string, ahora = Date.now()): EstadoOauth {
  return { red, state: randomBytes(24).toString("base64url"), verifier: nuevoVerifier(), cuentaId, exp: ahora + DURACION_OAUTH_MS };
}

export function sellar(e: EstadoOauth, clave?: Buffer): string {
  const datos = Buffer.from(JSON.stringify(e)).toString("base64url");
  return `${datos}.${firmar(datos, "oauth", clave)}`;
}

/** Valida la cookie al volver de la red. Lanza con un mensaje claro si algo no cuadra. */
export function abrir(cookie: string | undefined, red: string, state: string | null, clave?: Buffer, ahora = Date.now()): EstadoOauth {
  if (!cookie) throw new Error("No encontré el inicio de la conexión (la cookie venció o se abrió en otro navegador). Vuelve a conectar.");
  const [datos, firma] = cookie.split(".");
  if (!datos || !firma) throw new Error("Cookie de conexión inválida");
  const esperada = Buffer.from(firmar(datos, "oauth", clave));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) throw new Error("Cookie de conexión con firma inválida");
  const e = JSON.parse(Buffer.from(datos, "base64url").toString("utf8")) as EstadoOauth;
  if (e.exp < ahora) throw new Error("La conexión tardó más de 10 minutos. Vuelve a conectar.");
  if (e.red !== red) throw new Error("La respuesta es de otra red que la que se estaba conectando");
  if (!state || state !== e.state) throw new Error("El parámetro state no coincide: se rechaza la conexión");
  return e;
}
