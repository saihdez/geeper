/**
 * Páginas de Facebook con login de Facebook: Reels de página (Video API → Reels Publishing).
 * Un login trae todas las páginas que administra la persona; cada página es una cuenta con su token.
 * Ver docs/PUBLICAR.md §3 y §9. Documentación consultada (nov. 2026):
 * - developers.facebook.com/docs/video-api/guides/reels-publishing
 * - developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 *
 * Sólo Reels (9:16, 3 a 90 s). Los videos 16:9 de página (`/{page_id}/videos`) quedan fuera por ahora.
 */
import { credenciales, urlCallback } from "./config";
import { formulario, pedirJson } from "./http";
import { clasificarErrorGraph, crearGraph, cuota, GRAPH_VERSION, HORA_MS, subirTramoRupload, textoSesion, uriSubida } from "./meta";
import { registrarSecreto } from "./secretos";
import { ErrorRed, type CuentaDescifrada, type CuentaNueva, type Red, type Sesion } from "./tipos";

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
/** Permisos que pide hoy la Reels Publishing API. */
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

/** 190/102 → auth; límites de llamadas (4, 17, 32, 613 y 80001, el de la página) → cuota 1 h. */
export function clasificarErrorFacebook(contexto: string) {
  // 80001 = límite de llamadas de la página. El tope de 30 Reels por página en 24 h móviles no tiene
  // un código documentado en la guía de Reels.
  // VERIFICAR: el código que devuelve `video_reels` al pasar los 30 Reels/24 h (hoy cae como 1 h de espera si es uno de estos).
  return clasificarErrorGraph(contexto, (e, msg) => (e.code === 80001 ? cuota(msg, HORA_MS) : null));
}

const graph = crearGraph(GRAPH, clasificarErrorFacebook);
const texto = (s: Sesion, k: string) => textoSesion(s, k, "Facebook");

interface EstadoVideo {
  status?: {
    video_status?: "error" | "expired" | "processing" | "ready" | "uploading" | "upload_failed" | "upload_complete";
    uploading_phase?: { status?: string; bytes_transfered?: number; bytes_transferred?: number; errors?: { message?: string }[] };
    processing_phase?: { status?: string; error?: { message?: string } };
    publishing_phase?: { status?: string; publish_status?: "draft" | "error" | "published" | "scheduled"; error?: { message?: string } };
  };
}

const estadoVideo = (c: CuentaDescifrada, videoId: string) => graph<EstadoVideo>(c, `/${videoId}?fields=status`, "Estado del Reel de Facebook");

interface Pagina {
  id: string;
  name?: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
}

export const facebook: Red = {
  id: "facebook",
  nombre: "Facebook",
  formatos: ["shorts-9x16"],
  privacidades: ["borrador", "publico"],
  programar: false,
  pkce: false,

  urlConexion(state) {
    const { appId } = credenciales("facebook");
    const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    u.searchParams.set("client_id", appId);
    u.searchParams.set("redirect_uri", urlCallback("facebook"));
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES.join(","));
    // Vuelve a pedir los permisos (y deja elegir páginas) aunque ya se hayan negado antes. Facebook no
    // documenta hoy un parámetro para forzar elegir otra cuenta: se usa la sesión abierta del navegador.
    u.searchParams.set("auth_type", "rerequest");
    return u.toString();
  },

  async canjear(code) {
    const { appId, appSecret } = credenciales("facebook");
    const ctx = "Canje de código de Facebook";
    // El endpoint de canje sólo admite los datos en la query; los errores pasan por tapar.
    const u = new URL(`${GRAPH}/oauth/access_token`);
    u.searchParams.set("client_id", appId);
    u.searchParams.set("client_secret", appSecret);
    u.searchParams.set("redirect_uri", urlCallback("facebook"));
    u.searchParams.set("code", code);
    const corto = await pedirJson<{ access_token: string }>(u.toString(), {}, ctx, clasificarErrorFacebook(ctx));
    registrarSecreto(corto.access_token);

    // Token de usuario largo: los tokens de página que se obtienen con él no vencen.
    const ctxL = "Token largo de Facebook";
    const l = new URL(`${GRAPH}/oauth/access_token`);
    l.searchParams.set("grant_type", "fb_exchange_token");
    l.searchParams.set("client_id", appId);
    l.searchParams.set("client_secret", appSecret);
    l.searchParams.set("fb_exchange_token", corto.access_token);
    const largo = await pedirJson<{ access_token: string }>(l.toString(), {}, ctxL, clasificarErrorFacebook(ctxL));
    registrarSecreto(largo.access_token);

    const cuentas: CuentaNueva[] = [];
    let siguiente: string | undefined = `${GRAPH}/me/accounts?fields=${encodeURIComponent("id,name,access_token,picture{url}")}&limit=100`;
    for (let vueltas = 0; siguiente && vueltas < 20; vueltas++) {
      const pag: { data?: Pagina[]; paging?: { next?: string } } = await pedirJson(
        siguiente,
        { headers: { Authorization: `Bearer ${largo.access_token}` } },
        "Páginas de Facebook",
        clasificarErrorFacebook("Páginas de Facebook"),
      );
      for (const p of pag.data ?? []) {
        if (!p.id || !p.access_token) continue; // sin token no se puede publicar en esa página
        registrarSecreto(p.access_token);
        cuentas.push({
          externoId: p.id,
          usuario: p.name ?? p.id,
          avatarUrl: p.picture?.data?.url ?? null,
          tokens: { acceso: p.access_token, refresco: null, expira: null, scopes: SCOPES.join(" ") },
        });
      }
      // Sólo se sigue `paging.next` si apunta a Graph (ahí va el token).
      const n: string | undefined = pag.paging?.next;
      siguiente = n && new URL(n).hostname === "graph.facebook.com" ? n : undefined;
    }
    if (!cuentas.length) throw new ErrorRed("red", "Facebook no devolvió ninguna página: elige al menos una página al conectar");
    return cuentas;
  },

  async refrescar() {
    // Los tokens de página derivados de un token de usuario largo no vencen; si dejaron de servir
    // (contraseña cambiada, permiso quitado) sólo queda volver a conectar.
    throw new ErrorRed("auth", "El token de la página de Facebook ya no sirve: reconecta la cuenta");
  },
  // Sin `revocar`: haría falta el token de usuario (DELETE /me/permissions) y sólo guardamos los de página.

  tramo: () => Infinity,

  async iniciarSubida(c) {
    const r = await graph<{ video_id?: string; upload_url?: string }>(c, `/${c.externoId}/video_reels`, "Inicio de Reel en Facebook", {
      method: "POST",
      body: formulario({ upload_phase: "start" }),
    });
    if (!r.video_id) throw new ErrorRed("red", "Facebook no devolvió el id del video");
    return { videoId: r.video_id, uploadUrl: uriSubida(r.upload_url, "video-upload", r.video_id) };
  },

  async bytesRecibidos(c, s, archivo) {
    let st: EstadoVideo;
    try {
      st = await estadoVideo(c, texto(s, "videoId"));
    } catch (e) {
      // El video ya no existe (code 100): hay que abrir otro.
      if (e instanceof ErrorRed && e.tipo === "red" && (e.status === 400 || e.status === 404)) return null;
      throw e;
    }
    const v = st.status?.video_status;
    if (v === "error" || v === "expired" || v === "upload_failed") return null;
    if (v === "upload_complete" || v === "processing" || v === "ready") return { bytes: archivo.bytes };
    // La doc indica reanudar con `offset` = `bytes_transfered` (sic).
    const b = st.status?.uploading_phase?.bytes_transfered ?? st.status?.uploading_phase?.bytes_transferred ?? 0;
    return { bytes: Math.max(0, Math.min(archivo.bytes, Number(b) || 0)) };
  },

  async subirTramo(c, s, archivo, desde, hasta) {
    const uri = uriSubida(s.uploadUrl, "video-upload", texto(s, "videoId"));
    return subirTramoRupload(uri, c.acceso, archivo, desde, hasta, "Subida a Facebook", clasificarErrorFacebook("Subida a Facebook"));
  },

  async cerrarSubida(c, s, meta) {
    const videoId = texto(s, "videoId");
    const description = meta.descripcion.trim() ? `${meta.titulo}\n\n${meta.descripcion}` : meta.titulo;
    try {
      await graph<{ success?: boolean }>(c, `/${c.externoId}/video_reels`, "Cierre de Reel en Facebook", {
        method: "POST",
        body: formulario({ upload_phase: "finish", video_id: videoId, video_state: meta.privacidad === "borrador" ? "DRAFT" : "PUBLISHED", description }),
      });
    } catch (e) {
      if (!(e instanceof ErrorRed) || e.tipo !== "red") throw e;
      // Idempotente: si un intento anterior ya cerró la subida, Facebook rechaza el segundo `finish`.
      // VERIFICAR: el mensaje exacto de ese rechazo; se decide por el estado del video.
      const st = await estadoVideo(c, videoId).catch(() => null);
      const pub = st?.status?.publishing_phase;
      const yaCerrado = !!pub && ((pub.status !== undefined && pub.status !== "not_started") || (pub.publish_status !== undefined && pub.publish_status !== "error"));
      if (!yaCerrado) throw e;
    }
  },

  async consultar(c, s) {
    const videoId = texto(s, "videoId");
    const st = (await estadoVideo(c, videoId)).status ?? {};
    const pub = st.publishing_phase;
    const fallo = st.processing_phase?.error?.message ?? pub?.error?.message ?? st.uploading_phase?.errors?.[0]?.message;
    if (st.video_status === "error" || st.video_status === "expired" || st.video_status === "upload_failed" || pub?.status === "error" || pub?.publish_status === "error") {
      return { listo: false, error: fallo ?? `estado ${st.video_status ?? pub?.status ?? "desconocido"}` };
    }
    // VERIFICAR: con video_state=DRAFT, que publishing_phase llegue a `complete` con publish_status `draft`.
    const terminado = pub?.status === "complete" || (st.video_status === "ready" && (pub?.publish_status === "published" || pub?.publish_status === "draft"));
    if (terminado) {
      return { listo: true, idExterno: videoId, url: `https://www.facebook.com/reel/${videoId}`, borrador: pub?.publish_status === "draft" };
    }
    const fase = st.processing_phase?.status && st.processing_phase.status !== "complete" ? `procesando (${st.processing_phase.status})` : `publicando (${pub?.status ?? st.video_status ?? "en curso"})`;
    return { listo: false, detalle: fase };
  },
};
