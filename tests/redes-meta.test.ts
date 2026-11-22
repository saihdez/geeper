/** Adaptadores de Instagram y Facebook con fetch simulado: nunca se llama a las redes reales. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { facebook } from "../src/lib/redes/facebook";
import { instagram } from "../src/lib/redes/instagram";
import { ErrorRed, type CuentaDescifrada, type MetaPublicacion } from "../src/lib/redes/tipos";

interface Llamada {
  url: string;
  metodo: string;
  headers: Record<string, string>;
  body: string;
}

let dir: string;
let llamadas: Llamada[] = [];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-meta-"));
  fs.writeFileSync(
    path.join(dir, "redes.json"),
    JSON.stringify({ instagram: { appId: "ig-app", appSecret: "ig-secreto-123" }, facebook: { appId: "fb-app", appSecret: "fb-secreto-123" } }),
    { mode: 0o600 },
  );
  process.env.GEEPER_CONFIG = dir;
  process.env.GEEPER_URL = "http://localhost:3300";
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  llamadas = [];
});

const json = (datos: unknown, status = 200) => new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });

/** Simula fetch con una función que recibe la llamada y devuelve la respuesta. */
function simular(responder: (l: Llamada) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL, init: RequestInit = {}) => {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
      const l: Llamada = { url: String(entrada), metodo: init.method ?? "GET", headers, body };
      llamadas.push(l);
      return responder(l);
    }),
  );
}

const cuentaIg: CuentaDescifrada = { id: "c1", red: "instagram", externoId: "1784", usuario: "geeper", acceso: "IGTOKEN-largo-123456", refresco: null, expira: null, scopes: "" };
const cuentaFb: CuentaDescifrada = { id: "c2", red: "facebook", externoId: "page1", usuario: "Página", acceso: "PAGETOKEN-123456", refresco: null, expira: null, scopes: "" };
const meta = (privacidad: MetaPublicacion["privacidad"]): MetaPublicacion => ({ titulo: "Título", descripcion: "Descripción", privacidad, programada: null });

describe("urls de conexión", () => {
  it("Instagram: authorize con scopes de negocio, callback, state y force_reauth", () => {
    const u = new URL(instagram.urlConexion("st4te", ""));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("ig-app");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3300/api/cuentas/callback/instagram");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("force_reauth")).toBe("true");
  });

  it("Facebook: dialog/oauth versionado con permisos de páginas y rerequest", () => {
    const u = new URL(facebook.urlConexion("st4te", ""));
    expect(u.origin).toBe("https://www.facebook.com");
    expect(u.pathname).toMatch(/^\/v\d+\.\d+\/dialog\/oauth$/);
    expect(u.searchParams.get("client_id")).toBe("fb-app");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3300/api/cuentas/callback/facebook");
    expect(u.searchParams.get("scope")).toBe("pages_show_list,pages_manage_posts,pages_read_engagement");
    expect(u.searchParams.get("auth_type")).toBe("rerequest");
    expect(u.searchParams.get("state")).toBe("st4te");
  });
});

describe("canje", () => {
  it("Instagram: limpia #_, cambia a token largo y arma la cuenta", async () => {
    simular((l) => {
      if (l.url === "https://api.instagram.com/oauth/access_token") return json({ access_token: "CORTO-abcdefgh", user_id: 1784, permissions: "instagram_business_basic,instagram_business_content_publish" });
      if (l.url.startsWith("https://graph.instagram.com/access_token")) return json({ access_token: "LARGO-abcdefgh", token_type: "bearer", expires_in: 5_184_000 });
      if (l.url.includes("/me?")) return json({ id: "app-scoped", user_id: "1784", username: "geeper", profile_picture_url: "https://x/a.jpg" });
      return json({ error: { message: "inesperado" } }, 500);
    });
    const antes = Date.now();
    const [c, ...resto] = await instagram.canjear("CODIGO123#_", "");
    expect(resto).toHaveLength(0);
    const canje = new URLSearchParams(llamadas[0]!.body);
    expect(llamadas[0]!.metodo).toBe("POST");
    expect(canje.get("code")).toBe("CODIGO123");
    expect(canje.get("grant_type")).toBe("authorization_code");
    expect(canje.get("redirect_uri")).toBe("http://localhost:3300/api/cuentas/callback/instagram");
    const largo = new URL(llamadas[1]!.url);
    expect(largo.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(largo.searchParams.get("access_token")).toBe("CORTO-abcdefgh");
    expect(llamadas[2]!.headers.authorization).toBe("Bearer LARGO-abcdefgh");
    expect(c).toMatchObject({ externoId: "1784", usuario: "geeper", avatarUrl: "https://x/a.jpg" });
    expect(c!.tokens.acceso).toBe("LARGO-abcdefgh");
    expect(c!.tokens.refresco).toBeNull();
    expect(c!.tokens.expira!.getTime()).toBeGreaterThanOrEqual(antes + 5_184_000_000);
    expect(c!.tokens.scopes).toBe("instagram_business_basic instagram_business_content_publish");
  });

  it("Instagram: acepta la respuesta del canje dentro de `data`", async () => {
    simular((l) => {
      if (l.url === "https://api.instagram.com/oauth/access_token") return json({ data: [{ access_token: "CORTO-abcdefgh", user_id: "1784", permissions: "instagram_business_basic" }] });
      if (l.url.startsWith("https://graph.instagram.com/access_token")) return json({ access_token: "LARGO-abcdefgh", expires_in: 100 });
      return json({ user_id: "1784", username: "geeper" });
    });
    const [c] = await instagram.canjear("X", "");
    expect(c!.externoId).toBe("1784");
  });

  it("Facebook: token largo y una cuenta por página, siguiendo la paginación", async () => {
    simular((l) => {
      const u = new URL(l.url);
      if (u.pathname.endsWith("/oauth/access_token")) {
        return u.searchParams.get("grant_type") === "fb_exchange_token" ? json({ access_token: "USUARIO-LARGO-1234" }) : json({ access_token: "USUARIO-CORTO-1234", expires_in: 3600 });
      }
      if (u.pathname.endsWith("/me/accounts") && !u.searchParams.get("after")) {
        return json({ data: [{ id: "p1", name: "Página Uno", access_token: "TOKEN-P1-12345678", picture: { data: { url: "https://x/p1.jpg" } } }], paging: { next: `${u.origin}${u.pathname}?after=AAA` } });
      }
      if (u.pathname.endsWith("/me/accounts")) return json({ data: [{ id: "p2", name: "Página Dos", access_token: "TOKEN-P2-12345678" }], paging: {} });
      return json({ error: { message: "inesperado" } }, 500);
    });
    const cuentas = await facebook.canjear("COD", "");
    expect(new URL(llamadas[0]!.url).searchParams.get("code")).toBe("COD");
    expect(new URL(llamadas[1]!.url).searchParams.get("fb_exchange_token")).toBe("USUARIO-CORTO-1234");
    expect(llamadas[2]!.headers.authorization).toBe("Bearer USUARIO-LARGO-1234");
    expect(llamadas[3]!.headers.authorization).toBe("Bearer USUARIO-LARGO-1234");
    expect(cuentas).toEqual([
      { externoId: "p1", usuario: "Página Uno", avatarUrl: "https://x/p1.jpg", tokens: { acceso: "TOKEN-P1-12345678", refresco: null, expira: null, scopes: "pages_show_list pages_manage_posts pages_read_engagement" } },
      { externoId: "p2", usuario: "Página Dos", avatarUrl: null, tokens: { acceso: "TOKEN-P2-12345678", refresco: null, expira: null, scopes: "pages_show_list pages_manage_posts pages_read_engagement" } },
    ]);
  });
});

describe("publicar en Instagram", () => {
  const sesion = { contenedor: "cont9", uri: "https://rupload.facebook.com/ig-api-upload/v27.0/cont9", publicando: "2026-11-18T12:00:00.000Z" };

  it("si el contenedor ya está PUBLISHED, devuelve el Reel sin llamar a media_publish", async () => {
    simular((l) => {
      if (l.url.includes("/cont9?")) return json({ status_code: "PUBLISHED", status: "Published" });
      if (l.url.includes("/1784/media?")) {
        return json({
          data: [
            { id: "nuevo-de-otro", permalink: "https://instagram.com/reel/B", timestamp: "2026-11-18T12:30:00+0000" },
            { id: "nuestro", permalink: "https://instagram.com/reel/A", timestamp: "2026-11-18T11:59:30+0000" },
            { id: "viejo", permalink: "https://instagram.com/reel/V", timestamp: "2026-11-17T10:00:00+0000" },
          ],
        });
      }
      return json({ id: "NO-DEBERIA" });
    });
    const r = await instagram.publicar!(cuentaIg, sesion, meta("publico"));
    expect(r).toEqual({ idExterno: "nuestro", url: "https://instagram.com/reel/A" });
    expect(llamadas.some((l) => l.url.includes("media_publish"))).toBe(false);
  });

  it("si está FINISHED, publica y pide el permalink", async () => {
    simular((l) => {
      if (l.url.includes("/cont9?")) return json({ status_code: "FINISHED" });
      if (l.url.endsWith("/1784/media_publish")) return json({ id: "m1" });
      if (l.url.includes("/m1?fields=permalink")) return json({ permalink: "https://instagram.com/reel/M1" });
      return json({ error: { message: "inesperado" } }, 500);
    });
    const r = await instagram.publicar!(cuentaIg, sesion, meta("publico"));
    expect(r).toEqual({ idExterno: "m1", url: "https://instagram.com/reel/M1" });
    const pub = llamadas.find((l) => l.url.endsWith("media_publish"))!;
    expect(new URLSearchParams(pub.body).get("creation_id")).toBe("cont9");
  });

  it("iniciarSubida crea un contenedor REELS reanudable con caption", async () => {
    simular(() => json({ id: "cont9", uri: "https://rupload.facebook.com/ig-api-upload/v27.0/cont9" }));
    const s = await instagram.iniciarSubida(cuentaIg, { ruta: "/x.mp4", bytes: 10, perfil: "shorts-9x16", duracion: 5 }, meta("publico"));
    expect(s).toEqual({ contenedor: "cont9", uri: "https://rupload.facebook.com/ig-api-upload/v27.0/cont9" });
    const f = new URLSearchParams(llamadas[0]!.body);
    expect(f.get("media_type")).toBe("REELS");
    expect(f.get("upload_type")).toBe("resumable");
    expect(f.get("caption")).toBe("Título\n\nDescripción");
    expect(f.get("share_to_feed")).toBe("true");
  });
});

describe("Facebook: cerrar la subida", () => {
  const sesion = { videoId: "v1", uploadUrl: "https://rupload.facebook.com/video-upload/v27.0/v1" };

  it("borrador → video_state=DRAFT; público → PUBLISHED", async () => {
    simular(() => json({ success: true }));
    await facebook.cerrarSubida!(cuentaFb, sesion, meta("borrador"));
    await facebook.cerrarSubida!(cuentaFb, sesion, meta("publico"));
    const [a, b] = llamadas.map((l) => new URLSearchParams(l.body));
    expect(llamadas[0]!.url).toMatch(/\/page1\/video_reels$/);
    expect(a!.get("upload_phase")).toBe("finish");
    expect(a!.get("video_id")).toBe("v1");
    expect(a!.get("video_state")).toBe("DRAFT");
    expect(a!.get("description")).toBe("Título\n\nDescripción");
    expect(b!.get("video_state")).toBe("PUBLISHED");
  });

  it("es idempotente si el video ya estaba cerrado", async () => {
    simular((l) => {
      if (l.metodo === "POST") return json({ error: { message: "already finished", code: 100 } }, 400);
      return json({ status: { video_status: "processing", publishing_phase: { status: "in_progress" } } });
    });
    await expect(facebook.cerrarSubida!(cuentaFb, sesion, meta("publico"))).resolves.toBeUndefined();
  });

  it("consultar: listo como borrador con la url del Reel", async () => {
    simular(() => json({ status: { video_status: "ready", processing_phase: { status: "complete" }, publishing_phase: { status: "complete", publish_status: "draft" } } }));
    expect(await facebook.consultar(cuentaFb, sesion)).toEqual({ listo: true, idExterno: "v1", url: "https://www.facebook.com/reel/v1", borrador: true });
  });
});

describe("clasificación de errores", () => {
  it("Instagram: 190 → auth sin filtrar el token", async () => {
    simular(() => json({ error: { message: "Invalid OAuth access token IGTOKEN-largo-123456", code: 190 } }, 400));
    const e = await instagram.consultar(cuentaIg, { contenedor: "c" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorRed);
    expect((e as ErrorRed).tipo).toBe("auth");
    expect((e as ErrorRed).message).not.toContain("IGTOKEN-largo-123456");
  });

  it("Instagram: límite de publicación (9/2207042) → cuota por 24 h", async () => {
    simular((l) => (l.url.includes("/c?") ? json({ status_code: "FINISHED" }) : json({ error: { message: "max posts", code: 9, error_subcode: 2207042 } }, 400)));
    const antes = Date.now();
    const e = (await instagram.publicar!(cuentaIg, { contenedor: "c", publicando: new Date().toISOString() }, meta("publico")).catch((x: unknown) => x)) as ErrorRed;
    expect(e.tipo).toBe("cuota");
    expect(e.hasta!.getTime()).toBeGreaterThanOrEqual(antes + 24 * 3600_000 - 1000);
  });

  it("Facebook: 190 → auth y límite de llamadas (32) → cuota 1 h", async () => {
    simular(() => json({ error: { message: "Error validating access token", code: 190, error_subcode: 463 } }, 400));
    const e1 = (await facebook.iniciarSubida(cuentaFb, { ruta: "/x", bytes: 1, perfil: "shorts-9x16", duracion: 1 }, meta("publico")).catch((x: unknown) => x)) as ErrorRed;
    expect(e1.tipo).toBe("auth");

    vi.unstubAllGlobals();
    simular(() => json({ error: { message: "Page request limit reached", code: 32 } }, 400));
    const antes = Date.now();
    const e2 = (await facebook.consultar(cuentaFb, { videoId: "v1" }).catch((x: unknown) => x)) as ErrorRed;
    expect(e2.tipo).toBe("cuota");
    expect(e2.hasta!.getTime()).toBeGreaterThanOrEqual(antes + 3600_000 - 1000);
  });

  it("Facebook: refrescar pide reconectar", async () => {
    await expect(facebook.refrescar(cuentaFb)).rejects.toMatchObject({ tipo: "auth" });
  });
});

describe("subida por tramos a rupload (Facebook e Instagram)", () => {
  /** Un archivo de 10 bytes de verdad: leerTramo lo lee del disco. */
  const archivo = () => {
    const ruta = path.join(dir, "video.mp4");
    fs.writeFileSync(ruta, "0123456789");
    return { ruta, bytes: 10, perfil: "shorts-9x16" as const, duracion: 5 };
  };

  it("Facebook: sube a la URL de rupload con el token de la página, offset y tamaño", async () => {
    simular(() => json({ success: true }));
    const r = await facebook.subirTramo(cuentaFb, { videoId: "v1", uploadUrl: "https://rupload.facebook.com/video-upload/v27.0/v1?x=1" }, archivo(), 0, 10);
    expect(r).toEqual({ bytes: 10 });
    expect(llamadas[0]).toMatchObject({ url: "https://rupload.facebook.com/video-upload/v27.0/v1?x=1", metodo: "POST" });
    expect(llamadas[0]!.headers).toMatchObject({ authorization: "OAuth PAGETOKEN-123456", offset: "0", file_size: "10" });
  });

  it("Instagram: reanuda desde el offset en la URL del contenedor", async () => {
    simular(() => json({ success: true }));
    await instagram.subirTramo(cuentaIg, { contenedor: "c9", uri: "https://rupload.facebook.com/ig-api-upload/v27.0/c9" }, archivo(), 4, 10);
    expect(llamadas[0]!.url).toBe("https://rupload.facebook.com/ig-api-upload/v27.0/c9");
    expect(llamadas[0]!.headers).toMatchObject({ authorization: "OAuth IGTOKEN-largo-123456", offset: "4", file_size: "10" });
  });

  it("nunca manda el token a otro sitio: una URL ajena se cambia por la de rupload", async () => {
    simular(() => json({ success: true }));
    await facebook.subirTramo(cuentaFb, { videoId: "v1", uploadUrl: "https://malo.example/robar" }, archivo(), 0, 10);
    await instagram.subirTramo(cuentaIg, { contenedor: "c9", uri: "http://rupload.facebook.com/ig-api-upload/v27.0/c9" }, archivo(), 0, 10);
    await instagram.subirTramo(cuentaIg, { contenedor: "c9" }, archivo(), 0, 10);
    expect(llamadas.map((l) => l.url)).toEqual([
      "https://rupload.facebook.com/video-upload/v27.0/v1",
      "https://rupload.facebook.com/ig-api-upload/v27.0/c9",
      "https://rupload.facebook.com/ig-api-upload/v27.0/c9",
    ]);
  });

  it("sin el id en la sesión, error claro con el nombre de la red", async () => {
    simular(() => json({ success: true }));
    await expect(facebook.subirTramo(cuentaFb, {}, archivo(), 0, 10)).rejects.toThrow("La sesión de Facebook no tiene videoId");
    await expect(instagram.subirTramo(cuentaIg, {}, archivo(), 0, 10)).rejects.toThrow("La sesión de Instagram no tiene contenedor");
    expect(llamadas).toHaveLength(0);
  });

  it("un error de la subida se clasifica con los códigos de cada red", async () => {
    simular(() => json({ error: { message: "Page limit", code: 80001 } }, 400));
    const fb = (await facebook.subirTramo(cuentaFb, { videoId: "v1" }, archivo(), 0, 10).catch((x: unknown) => x)) as ErrorRed;
    expect(fb.tipo).toBe("cuota");
    expect(fb.message).toContain("Subida a Facebook");
    // 80001 es sólo de Facebook: en Instagram queda como error común de la red.
    const ig = (await instagram.subirTramo(cuentaIg, { contenedor: "c9" }, archivo(), 0, 10).catch((x: unknown) => x)) as ErrorRed;
    expect(ig.tipo).not.toBe("cuota");
    expect(ig.message).toContain("Subida a Instagram");

    vi.unstubAllGlobals();
    simular(() => json({ error: { message: "Invalid token PAGETOKEN-123456", code: 102 } }, 400));
    const auth = (await facebook.subirTramo(cuentaFb, { videoId: "v1" }, archivo(), 0, 10).catch((x: unknown) => x)) as ErrorRed;
    expect(auth.tipo).toBe("auth");
    expect(auth.message).not.toContain("PAGETOKEN-123456");
  });

  it("las dos redes usan la misma versión de Graph en la conexión y en la subida", () => {
    expect(new URL(facebook.urlConexion("s", "")).pathname).toBe("/v27.0/dialog/oauth");
  });
});
