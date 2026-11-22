/**
 * Instagram con «Instagram API with Instagram Login» (cuentas profesionales, sin página de Facebook).
 * Reels por subida reanudable: contenedor (`upload_type=resumable`) → rupload → estado → media_publish.
 * Ver docs/PUBLICAR.md §3 y §9. Documentación consultada (nov. 2026):
 * - developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 * - developers.facebook.com/docs/instagram-platform/content-publishing
 * - developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
 */
import { credenciales, urlCallback } from "./config";
import { errorDe, formulario, pedir, pedirJson } from "./http";
import { clasificarErrorGraph, crearGraph, cuota, GRAPH_VERSION, subirTramoRupload, textoSesion, uriSubida } from "./meta";
import { registrarSecreto } from "./secretos";
import { ErrorRed, type CuentaDescifrada, type CuentaNueva, type Red, type Sesion, type Tokens } from "./tipos";

const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const MAX_CAPTION = 2200;
const DIA_MS = 24 * 60 * 60_000;
/** Margen al buscar el media ya publicado tras un corte (relojes desfasados). */
const MARGEN_PUBLICANDO_MS = 2 * 60_000;

/** Clasifica los errores de Graph: 190 → auth; límite de publicación → cuota 24 h; límites de llamadas → cuota 1 h. */
export function clasificarErrorInstagram(contexto: string) {
  // Límite de publicaciones de la Content Publishing API (50 en 24 h móviles según content_publishing_limit).
  // Se espera 24 h: la ventana es móvil y el ejecutor no gasta intentos mientras espera.
  return clasificarErrorGraph(contexto, (e, msg) => (e.code === 9 && e.error_subcode === 2207042 ? cuota(msg, DIA_MS) : null));
}

// VERIFICAR: graph.instagram.com acepta el token en `Authorization: Bearer` (así no viaja en la query).
const graph = crearGraph(GRAPH, clasificarErrorInstagram);
const texto = (s: Sesion, k: string) => textoSesion(s, k, "Instagram");

/** "2026-11-18T12:00:00+0000" → Date (Graph manda el huso sin dos puntos). */
function fechaGraph(t: string | undefined): number {
  if (!t) return NaN;
  return Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

type EstadoContenedor = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
interface Contenedor {
  status_code?: EstadoContenedor;
  status?: string;
}

const estadoContenedor = (c: CuentaDescifrada, contenedor: string) =>
  graph<Contenedor>(c, `/${contenedor}?fields=status_code,status`, "Estado del contenedor de Instagram");

export const instagram: Red = {
  id: "instagram",
  nombre: "Instagram",
  formatos: ["shorts-9x16", "cuadrado-1x1"],
  privacidades: ["publico"], // Instagram no tiene publicaciones privadas ni borradores por API.
  programar: false,
  pkce: false,
  margenRefresco: 7 * DIA_MS, // los tokens largos duran 60 días

  urlConexion(state) {
    const { appId } = credenciales("instagram");
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.searchParams.set("client_id", appId);
    u.searchParams.set("redirect_uri", urlCallback("instagram"));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES.join(","));
    u.searchParams.set("state", state);
    // Pide las credenciales de la cuenta profesional aunque haya una sesión de Instagram abierta.
    u.searchParams.set("force_reauth", "true");
    return u.toString();
  },

  async canjear(code) {
    const { appId, appSecret } = credenciales("instagram");
    const limpio = code.replace(/#_$/, ""); // Instagram agrega "#_" al redirect; no es parte del código.
    const corto = await pedirJson<{ access_token?: string; user_id?: string | number; permissions?: string | string[]; data?: { access_token?: string; user_id?: string | number; permissions?: string | string[] }[] }>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body: formulario({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: urlCallback("instagram"), code: limpio }),
      },
      "Canje de código de Instagram",
      clasificarErrorInstagram("Canje de código de Instagram"),
    );
    // La doc muestra `{ data: [ {...} ] }`; en la práctica suele llegar plano. Se aceptan los dos.
    const d = corto.data?.[0] ?? corto;
    if (!d.access_token) throw new ErrorRed("red", "Instagram no devolvió el token de acceso");
    registrarSecreto(d.access_token);

    // Token largo (60 días). La API exige el token y el secreto en la query; los errores pasan por tapar.
    const u = new URL("https://graph.instagram.com/access_token");
    u.searchParams.set("grant_type", "ig_exchange_token");
    u.searchParams.set("client_secret", appSecret);
    u.searchParams.set("access_token", d.access_token);
    const largo = await pedirJson<{ access_token: string; expires_in?: number }>(u.toString(), {}, "Token largo de Instagram", clasificarErrorInstagram("Token largo de Instagram"));
    registrarSecreto(largo.access_token);

    const yo = await graph<{ id?: string; user_id?: string | number; username?: string; profile_picture_url?: string }>(
      { acceso: largo.access_token },
      "/me?fields=user_id,username,profile_picture_url",
      "Perfil de Instagram",
    );
    // `user_id` es el id de la cuenta profesional (el que va en /{id}/media); `id` es el de la app.
    const externoId = String(yo.user_id ?? d.user_id ?? yo.id ?? "");
    if (!externoId) throw new ErrorRed("red", "Instagram no devolvió el id de la cuenta");
    const permisos = Array.isArray(d.permissions) ? d.permissions : (d.permissions ?? SCOPES.join(",")).split(",");
    const cuenta: CuentaNueva = {
      externoId,
      usuario: yo.username ?? externoId,
      avatarUrl: yo.profile_picture_url ?? null,
      tokens: {
        acceso: largo.access_token,
        refresco: null,
        expira: new Date(Date.now() + (largo.expires_in ?? 60 * 24 * 3600) * 1000),
        scopes: permisos.map((p) => p.trim()).filter(Boolean).join(" "),
      },
    };
    return [cuenta];
  },

  async refrescar(c): Promise<Tokens> {
    // Sólo se puede con un token largo vigente de más de 24 h; si ya venció hay que reconectar.
    const u = new URL("https://graph.instagram.com/refresh_access_token");
    u.searchParams.set("grant_type", "ig_refresh_token");
    u.searchParams.set("access_token", c.acceso);
    const r = await pedir(u.toString());
    if (!r.ok) {
      const e = await errorDe(r, "Refresco de token de Instagram", clasificarErrorInstagram("Refresco de token de Instagram"));
      if (e.tipo === "cuota") throw e;
      throw new ErrorRed("auth", `${e.message} · reconecta la cuenta de Instagram`, undefined, e.status);
    }
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    registrarSecreto(j.access_token);
    return { acceso: j.access_token, refresco: null, expira: new Date(Date.now() + (j.expires_in ?? 60 * 24 * 3600) * 1000), scopes: c.scopes };
  },
  // Sin `revocar`: Instagram Login no documenta un endpoint para revocar el token; se quita desde la app.

  tramo: () => Infinity,

  async iniciarSubida(c, _archivo, meta) {
    const caption = (meta.descripcion.trim() ? `${meta.titulo}\n\n${meta.descripcion}` : meta.titulo).slice(0, MAX_CAPTION);
    // VERIFICAR: la guía de content publishing dice que `upload_type=resumable` es «sólo para apps con
    // Facebook Login for Business»; con Instagram Login no está confirmado. Si falla, la alternativa es
    // `video_url` (un video alojado en una URL pública), que Geeper no tiene.
    const r = await graph<{ id: string; uri?: string }>(c, `/${c.externoId}/media`, "Contenedor de Instagram", {
      method: "POST",
      body: formulario({ media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true" }),
    });
    if (!r.id) throw new ErrorRed("red", "Instagram no devolvió el id del contenedor");
    return { contenedor: r.id, uri: uriSubida(r.uri, "ig-api-upload", r.id) };
  },

  async bytesRecibidos(c, s, archivo) {
    // La doc no describe un GET de rupload que informe el offset: se mira el contenedor.
    let st: Contenedor;
    try {
      st = await estadoContenedor(c, texto(s, "contenedor"));
    } catch (e) {
      // Contenedor inexistente o vencido (code 24 / 2207008, 2207006): hay que abrir otro.
      if (e instanceof ErrorRed && e.tipo === "red" && (e.status === 400 || e.status === 404)) return null;
      throw e;
    }
    if (st.status_code === "EXPIRED" || st.status_code === "ERROR") return null;
    if (st.status_code === "FINISHED" || st.status_code === "PUBLISHED") return { bytes: archivo.bytes };
    // VERIFICAR: que rupload acepte reenviar desde 0 al mismo contenedor tras un corte a mitad.
    return { bytes: 0 };
  },

  async subirTramo(c, s, archivo, desde, hasta) {
    const uri = uriSubida(s.uri, "ig-api-upload", texto(s, "contenedor"));
    return subirTramoRupload(uri, c.acceso, archivo, desde, hasta, "Subida a Instagram", clasificarErrorInstagram("Subida a Instagram"));
  },

  async consultar(c, s) {
    const st = await estadoContenedor(c, texto(s, "contenedor"));
    switch (st.status_code) {
      case "FINISHED":
      case "PUBLISHED":
        return { listo: true };
      case "ERROR":
        return { listo: false, error: st.status ?? "el contenedor quedó en ERROR" };
      case "EXPIRED":
        return { listo: false, error: "el contenedor venció (no se publicó en 24 h)" };
      default:
        return { listo: false, detalle: st.status_code === "IN_PROGRESS" ? "procesando el video" : (st.status ?? "esperando") };
    }
  },

  async publicar(c, s) {
    const contenedor = texto(s, "contenedor");
    const st = await estadoContenedor(c, contenedor);
    if (st.status_code === "PUBLISHED") {
      // Un corte entre media_publish y el guardado: se busca el Reel ya publicado y no se repite.
      const desde = typeof s.publicando === "string" ? Date.parse(s.publicando) - MARGEN_PUBLICANDO_MS : NaN;
      const lista = await graph<{ data?: { id: string; permalink?: string; timestamp?: string }[] }>(
        c,
        `/${c.externoId}/media?fields=id,permalink,timestamp&limit=10`,
        "Medios de Instagram",
      );
      const todos = lista.data ?? [];
      // Sin `publicando` (no debería pasar: el ejecutor lo pone) se toma el más reciente.
      const candidatos = Number.isFinite(desde) ? todos.filter((m) => fechaGraph(m.timestamp) >= desde) : todos.slice(0, 1);
      // El más antiguo dentro de la ventana es el nuestro (lo publicado después sería de otra fuente).
      candidatos.sort((a, b) => fechaGraph(a.timestamp) - fechaGraph(b.timestamp));
      const m = candidatos[0];
      if (!m) throw new ErrorRed("red", "El contenedor de Instagram ya figura publicado pero no encuentro el Reel: revísalo en la app antes de reintentar");
      return { idExterno: m.id, url: m.permalink };
    }
    if (st.status_code !== "FINISHED") throw new ErrorRed("red", `El contenedor de Instagram no está listo para publicar (${st.status_code ?? "sin estado"})`);
    const r = await graph<{ id: string }>(c, `/${c.externoId}/media_publish`, "Publicación en Instagram", {
      method: "POST",
      body: formulario({ creation_id: contenedor }),
    });
    let url: string | undefined;
    try {
      url = (await graph<{ permalink?: string }>(c, `/${r.id}?fields=permalink`, "Enlace del Reel")).permalink;
    } catch {
      // Ya está publicado: sin el enlace se guarda sólo el id.
    }
    return { idExterno: r.id, url };
  },
};
