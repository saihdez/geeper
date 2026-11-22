/** UX-17: un link que no abre se descubre antes de hacer la voz, con un mensaje simple, y se puede volver a Nuevo con lo escrito. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enlaceCambiarLink, leerBorradorDemo } from "@/lib/demo-web";
import { noAbre, probarLink } from "@/lib/demo-web-toma";

let servidor: http.Server;
let base = "";
beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    if (req.url === "/robots-no") res.writeHead(403).end("no");
    else if (req.url === "/lenta") setTimeout(() => res.writeHead(200).end("ok"), 2000);
    else res.writeHead(200, { "content-type": "text/html" }).end("<h1>hola</h1>");
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const errorDeRed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`getaddrinfo ${code} tuproduto.co`), { code }) });

describe("probarLink", () => {
  it("una página que abre pasa sin avisos", async () => {
    const log: string[] = [];
    await probarLink(`${base}/`, { log: (l) => log.push(l) });
    expect(log).toEqual([]);
  });

  it("un sitio que no existe corta con un mensaje simple y deja el detalle técnico en el registro", async () => {
    const log: string[] = [];
    const url = "https://tuproduto.co";
    await expect(probarLink(url, { log: (l) => log.push(l), fetch: () => Promise.reject(errorDeRed("ENOTFOUND")) })).rejects.toThrow(noAbre(url));
    expect(noAbre(url)).not.toMatch(/ENOTFOUND|net::|page\.goto/);
    expect(log.join("\n")).toContain("Detalle técnico: fetch failed: getaddrinfo ENOTFOUND");
  });

  it("un puerto cerrado de verdad también corta", async () => {
    const cerrado = http.createServer();
    await new Promise<void>((ok) => cerrado.listen(0, "127.0.0.1", ok));
    const puerto = (cerrado.address() as AddressInfo).port;
    await new Promise<void>((ok) => cerrado.close(() => ok()));
    await expect(probarLink(`http://127.0.0.1:${puerto}/`)).rejects.toThrow("No se pudo abrir");
  });

  it("un sitio que rechaza a los robots o tarda sólo avisa: no impide grabar", async () => {
    const log: string[] = [];
    await probarLink(`${base}/robots-no`, { log: (l) => log.push(l) });
    await probarLink(`${base}/lenta`, { log: (l) => log.push(l), timeoutMs: 200 });
    expect(log[0]).toContain("respondió 403");
    expect(log[1]).toContain("tardó más de");
  });
});

describe("volver a Nuevo con lo escrito", () => {
  it("el enlace lleva el link, el texto y lo elegido, y se lee igual", () => {
    const b = { url: "https://tuproduto.co", texto: "Conoce Tu Producto.", formato: "16:9" as const, estilo: "plano" as const, plantilla: "gta-vi-shorts", propio: true };
    const enlace = enlaceCambiarLink(b);
    expect(enlace.startsWith("/nuevo?modo=web&")).toBe(true);
    expect(leerBorradorDemo(new URL(enlace, "http://x").searchParams)).toEqual(b);
  });

  it("ignora lo que no es válido", () => {
    expect(leerBorradorDemo(new URLSearchParams("formato=4:3&estilo=raro&plantilla=../x&propio=si"))).toEqual({});
  });
});
