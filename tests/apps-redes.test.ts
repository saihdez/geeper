import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { esInicioLogin, esVueltaOAuth, pasoLogin } from "../escritorio/oauth";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apps-redes-"));
process.env.GEEPER_CONFIG = dir;
process.env.GEEPER_DATA = path.join(dir, "datos");
process.env.GEEPER_DB = path.join(dir, "prueba.db");
const { abrirArchivo, borrarApp, exportarApps, guardarApp, importarApps, resumenApps } = await import("@/lib/redes/credenciales");
const { leerConfig } = await import("@/lib/redes/config");
const { proxy } = await import("../src/proxy");
const { GET: vueltaGET } = await import("../src/app/api/cuentas/callback/[red]/route");

const SECRETO = "GOCSPX-secreto-de-prueba-123";

describe("apps de las redes desde la UI", () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("guarda una red sin tocar las demás y nunca devuelve el secreto", () => {
    guardarApp("youtube", { clientId: "  123-abc.apps.googleusercontent.com ", clientSecret: SECRETO });
    guardarApp("tiktok", { clientKey: "aw123", clientSecret: "tt-secreto-largo", publicacionDirecta: true });
    expect(leerConfig().youtube?.clientId).toBe("123-abc.apps.googleusercontent.com");
    const r = resumenApps();
    expect(JSON.stringify(r)).not.toContain(SECRETO);
    expect(r.find((a) => a.red === "youtube")).toMatchObject({ configurada: true, id: "…nt.com" });
    expect(r.find((a) => a.red === "tiktok")?.opciones).toEqual({ publicacionDirecta: true });
    expect(r.find((a) => a.red === "facebook")?.configurada).toBe(false);
    if (process.platform !== "win32") expect(fs.statSync(path.join(dir, "redes.json")).mode & 0o777).toBe(0o600);
  });

  it("rechaza datos incompletos con el nombre del campo", () => {
    expect(() => guardarApp("facebook", { appId: "1" })).toThrow(/Clave secreta de la app/);
  });

  it("exporta cifrado e importa con la contraseña; con otra o alterado, no", () => {
    const archivo = exportarApps("contraseña-del-equipo");
    expect(archivo).not.toContain(SECRETO);
    expect(() => exportarApps("corta")).toThrow(/10 caracteres/);
    expect(() => abrirArchivo(archivo, "otra-contraseña-mala")).toThrow(/contraseña no es la correcta/);
    const j = JSON.parse(archivo) as { datos: string };
    const alterado = JSON.stringify({ ...JSON.parse(archivo), datos: Buffer.from("x".repeat(40)).toString("base64") });
    expect(() => abrirArchivo(alterado, "contraseña-del-equipo")).toThrow(/contraseña no es la correcta|dañado/);
    expect(j.datos.length).toBeGreaterThan(10);
    const caro = JSON.stringify({ ...JSON.parse(archivo), kdf: { n: 2 ** 22, r: 8, p: 1, sal: "AAAA" } });
    expect(() => abrirArchivo(caro, "contraseña-del-equipo")).toThrow(/fuera de lo normal/);

    borrarApp("youtube");
    expect(leerConfig().youtube).toBeUndefined();
    expect(importarApps(archivo, "contraseña-del-equipo")).toEqual(["youtube", "tiktok"]);
    expect(leerConfig().youtube?.clientSecret).toBe(SECRETO);
  });
});

describe("pedidos de otros sitios (CSRF)", () => {
  const pedido = (metodo: string, cabeceras: Record<string, string>) =>
    proxy(new NextRequest("http://127.0.0.1:3300/api/cuentas/credenciales", { method: metodo, headers: { host: "127.0.0.1:3300", ...cabeceras } }));

  it("rechaza un POST que viene de otra página", () => {
    expect(pedido("PUT", { origin: "https://malo.example", "sec-fetch-site": "cross-site" }).status).toBe(403);
    expect(pedido("POST", { origin: "http://localhost:5173", "sec-fetch-site": "same-site" }).status).toBe(403);
  });

  it("deja pasar a Geeper, a la terminal y a las lecturas", () => {
    expect(pedido("PUT", { origin: "http://127.0.0.1:3300", "sec-fetch-site": "same-origin" }).status).toBe(200);
    expect(pedido("POST", { origin: "http://localhost:3300" }).status).toBe(200);
    expect(pedido("POST", {}).status).toBe(200);
    expect(pedido("GET", { origin: "https://malo.example", "sec-fetch-site": "cross-site" }).status).toBe(200);
  });
});

describe("vuelta del inicio de sesión en la app de escritorio", () => {
  it("reconoce el redirect URI registrado aunque Geeper corra en otro puerto", () => {
    expect(esVueltaOAuth("http://localhost:3300/api/cuentas/callback/youtube?code=x&state=y")).toBe(true);
    expect(esVueltaOAuth("http://127.0.0.1:51234/api/cuentas/callback/tiktok?code=x")).toBe(true);
    expect(esVueltaOAuth("https://accounts.google.com/o/oauth2/auth")).toBe(false);
    expect(esVueltaOAuth("http://malo.example/api/cuentas/callback/youtube")).toBe(false);
  });
});

describe("conectar una cuenta en la app de escritorio, de punta a punta (ESC-02)", () => {
  // La app corre en 127.0.0.1 y quizá en otro puerto; la red vuelve siempre a lo registrado (localhost:3300).
  const base = "http://127.0.0.1:51234";

  it("«Conectar» en la ventana principal abre la ventana de inicio de sesión; lo demás no", () => {
    expect(esInicioLogin(base, `${base}/api/cuentas/conectar/youtube?cuenta=abc`)).toBe(true);
    expect(esInicioLogin(base, `${base}/cuentas`)).toBe(false);
    expect(esInicioLogin(base, "http://localhost:3300/api/cuentas/conectar/youtube")).toBe(false);
    expect(esInicioLogin("", `${base}/api/cuentas/conectar/youtube`)).toBe(false);
  });

  it("la vuelta a localhost:3300 se lleva a la dirección real de Geeper con la misma ruta y parámetros", () => {
    expect(pasoLogin(base, "http://localhost:3300/api/cuentas/callback/youtube?code=c1&state=s1")).toEqual({
      tipo: "llevar",
      a: `${base}/api/cuentas/callback/youtube?code=c1&state=s1`,
    });
    // Facebook agrega «#_=_»: no hace falta y no llega al servidor.
    expect(pasoLogin(base, "http://localhost:3300/api/cuentas/callback/facebook?code=c2&state=s2#_=_")).toEqual({
      tipo: "llevar",
      a: `${base}/api/cuentas/callback/facebook?code=c2&state=s2`,
    });
  });

  it("las páginas de la red por https y la ruta de cuentas de Geeper siguen; lo demás se bloquea", () => {
    expect(pasoLogin(base, "https://accounts.google.com/o/oauth2/v2/auth?x=1")).toEqual({ tipo: "seguir" });
    expect(pasoLogin(base, `${base}/api/cuentas/callback/youtube?code=c&state=s`)).toEqual({ tipo: "seguir" });
    expect(pasoLogin(base, "http://malo.example/api/cuentas/callback/youtube?code=c")).toEqual({ tipo: "bloquear" });
    expect(pasoLogin(base, "file:///C:/Windows/system32")).toEqual({ tipo: "bloquear" });
  });

  it("cuando Geeper manda a /cuentas, el resultado va a la ventana principal", () => {
    expect(pasoLogin(base, `${base}/cuentas?ok=1`)).toEqual({ tipo: "terminar", a: `${base}/cuentas?ok=1` });
    // Geeper con otro nombre (localhost, mismo puerto) también es Geeper: antes la ventana quedaba en blanco.
    expect(pasoLogin(base, "http://localhost:51234/cuentas?ok=1")).toEqual({ tipo: "terminar", a: `${base}/cuentas?ok=1` });
    expect(pasoLogin(base, "http://localhost:51234/api/cuentas/conectar/youtube")).toEqual({ tipo: "llevar", a: `${base}/api/cuentas/conectar/youtube` });
    // Otro puerto u otra máquina, no.
    expect(pasoLogin(base, "http://localhost:3300/cuentas?ok=1")).toEqual({ tipo: "bloquear" });
    expect(pasoLogin(base, "http://localhost:51234@malo.example/cuentas")).toEqual({ tipo: "bloquear" });
  });

  it("si falta la app de la red, «Conectar» vuelve a /cuentas en la dirección de Geeper", async () => {
    const { GET } = await import("../src/app/api/cuentas/conectar/[red]/route");
    const res = await GET(new NextRequest(`${base}/api/cuentas/conectar/instagram`), { params: Promise.resolve({ red: "instagram" }) });
    expect(res.status).toBe(302);
    const final = new URL(res.headers.get("location") ?? "", base);
    expect(final.origin).toBe(base);
    expect(final.pathname).toBe("/cuentas");
    expect(final.searchParams.get("error")).toBeTruthy();
  });

  it("la ruta de vuelta responde en la dirección de Geeper (no en localhost:3300) y borra la cookie", async () => {
    const res = await vueltaGET(new NextRequest(`${base}/api/cuentas/callback/youtube?error=access_denied`), { params: Promise.resolve({ red: "youtube" }) });
    expect(res.status).toBe(302);
    const destino = res.headers.get("location") ?? "";
    // Next cambia 127.0.0.1 por localhost en `req.url`: una dirección armada con él ya no sería Geeper.
    const final = new URL(destino, base);
    expect(final.origin).toBe(base);
    expect(final.pathname).toBe("/cuentas");
    expect(final.searchParams.get("error")).toContain("access_denied");
    // Ese destino es una página de Geeper: la ventana de inicio de sesión se cierra y la principal lo muestra.
    expect(pasoLogin(base, final.href)).toEqual({ tipo: "terminar", a: final.href });
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
  });
});

