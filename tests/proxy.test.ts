import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config, motivoDeRechazo, type Pedido } from "@/proxy";

const p = (o: Partial<Pedido>): Pedido => ({ metodo: "POST", host: "localhost:3300", origen: null, sitio: null, ...o });

describe("proxy: pedidos de otros sitios y rebinding (SEG-06)", () => {
  afterEach(() => {
    delete process.env.GEEPER_URL;
  });

  it("deja pasar a la propia app, a scripts sin cabeceras y a 127.0.0.1 ↔ localhost", () => {
    expect(motivoDeRechazo(p({ origen: "http://localhost:3300", sitio: "same-origin" }))).toBeNull();
    expect(motivoDeRechazo(p({ host: "127.0.0.1:3300", origen: "http://localhost:3300" }))).toBeNull();
    expect(motivoDeRechazo(p({}))).toBeNull();
    expect(motivoDeRechazo(p({ sitio: "none" }))).toBeNull();
  });

  it("rechaza lo que cambia algo y viene de otra página", () => {
    expect(motivoDeRechazo(p({ sitio: "cross-site" }))).toMatch(/otra página/);
    expect(motivoDeRechazo(p({ sitio: "same-site" }))).toMatch(/otra página/);
    expect(motivoDeRechazo(p({ origen: "http://evil.com" }))).toMatch(/otra página/);
    expect(motivoDeRechazo(p({ origen: "http://localhost:9999" }))).toMatch(/otra página/);
    expect(motivoDeRechazo(p({ origen: "null" }))).toMatch(/otra página/);
    expect(motivoDeRechazo(p({ metodo: "DELETE", origen: "https://evil.com" }))).toMatch(/otra página/);
  });

  it("los GET de otro sitio pasan (regreso de OAuth), pero no con un Host ajeno", () => {
    expect(motivoDeRechazo(p({ metodo: "GET", sitio: "cross-site", origen: "https://accounts.google.com" }))).toBeNull();
    expect(motivoDeRechazo(p({ metodo: "GET", host: "evil.com:3300" }))).toMatch(/esta computadora/);
    expect(motivoDeRechazo(p({ host: "evil.com:3300", origen: "http://evil.com:3300", sitio: "same-origin" }))).toMatch(/esta computadora/);
    expect(motivoDeRechazo(p({ host: null }))).toMatch(/esta computadora/);
  });

  it("acepta el host de GEEPER_URL", () => {
    process.env.GEEPER_URL = "http://geeper.casa:3300";
    expect(motivoDeRechazo(p({ host: "geeper.casa:3300", origen: "http://geeper.casa:3300" }))).toBeNull();
    expect(motivoDeRechazo(p({ host: "[::1]:3300" }))).toBeNull();
  });

  it("sin puerto escrito toma el de su protocolo (443 en https)", () => {
    process.env.GEEPER_URL = "https://geeper.casa";
    expect(motivoDeRechazo(p({ host: "geeper.casa", origen: "https://geeper.casa" }))).toBeNull();
    expect(motivoDeRechazo(p({ host: "geeper.casa:443", origen: "https://geeper.casa" }))).toBeNull();
    expect(motivoDeRechazo(p({ host: "localhost", origen: "http://localhost" }))).toBeNull();
    expect(motivoDeRechazo(p({ host: "geeper.casa:3300", origen: "https://geeper.casa" }))).toMatch(/otra página/);
    expect(motivoDeRechazo(p({ host: "localhost:80", origen: "https://localhost" }))).toMatch(/otra página/);
  });
});

describe("matcher del proxy: las subidas no pasan por la copia de 10 MB", () => {
  const general = new RegExp(`^${(config.matcher[0] as string).replace("/api/(", "/api/(?:")}$`);
  const subidas = [
    "/api/clips/subir",
    "/api/proyectos/p1/avatar",
    "/api/proyectos/p1/filmcraft",
    "/api/avatares",
    "/api/paleta",
    "/api/anuncios/a1/imagen",
    "/api/plantillas/mi-marca/logo",
    "/api/plantillas/mi-marca/portada-propia",
    "/api/proyectos/p1/clip",
    "/api/workflows/w1",
  ];

  it("el matcher general deja fuera las subidas y cubre lo demás", () => {
    for (const s of subidas) expect(general.test(s), s).toBe(false);
    for (const s of ["/api/proyectos", "/api/proyectos/p1", "/api/workflows/w1/cancelar", "/api/clips/subir/otra", "/api/plantillas/x"]) expect(general.test(s), s).toBe(true);
  });

  it("el filtro de Host de las subidas sólo da por locales a los hosts locales (igual que Next)", () => {
    type Regla = { missing?: { type: string; value?: string }[] };
    const valor = (config.matcher as (string | Regla)[])
      .flatMap((m) => (typeof m === "string" ? [] : (m.missing ?? [])))
      .find((x) => x.type === "host")?.value;
    expect(valor).toBeDefined();
    // Lo mismo que hace Next en matchHas: corta en el primer «:», pasa a minúsculas y arma ^valor$.
    const esLocal = (host: string) => new RegExp(`^${valor}$`).test(host.split(":", 1)[0]!.toLowerCase());
    for (const h of ["localhost", "localhost:3300", "LOCALHOST:3300", "127.0.0.1:3300", "[::1]:3300"]) expect(esLocal(h), h).toBe(true);
    for (const h of ["localhost.atacante.com", "atacante.com", "x127.0.0.1", "127.0.0.1.atacante.com:3300", "evil.localhost", "127a0b0c1"]) expect(esLocal(h), h).toBe(false);
  });

  it("toda ruta que lee el cuerpo como archivo está en la lista de subidas", () => {
    const raiz = path.join(process.cwd(), "src", "app");
    const rutas = (fs.readdirSync(path.join(raiz, "api"), { recursive: true }) as string[])
      .filter((f) => f.endsWith("route.ts"))
      .filter((f) => /req\.(formData|arrayBuffer|blob)\(|req\.body\b/.test(fs.readFileSync(path.join(raiz, "api", f), "utf8")))
      .map((f) => "/api/" + path.dirname(f).split(path.sep).join("/").replace(/\[[^\]]+\]/g, "x"));
    for (const r of rutas) expect(subidas.map((s) => s.replace(/\/(a1|mi-marca|p1|w1)(\/|$)/, "/x$2")), r).toContain(r);
  });
});
