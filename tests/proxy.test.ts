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
});

describe("matcher del proxy: las subidas no pasan por la copia de 10 MB", () => {
  const general = new RegExp(`^${(config.matcher[0] as string).replace("/api/(", "/api/(?:")}$`);
  const subidas = [
    "/api/clips/subir",
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

  it("toda ruta que lee el cuerpo como archivo está en la lista de subidas", () => {
    const raiz = path.join(process.cwd(), "src", "app");
    const rutas = (fs.readdirSync(path.join(raiz, "api"), { recursive: true }) as string[])
      .filter((f) => f.endsWith("route.ts"))
      .filter((f) => /req\.(formData|arrayBuffer|blob)\(|req\.body\b/.test(fs.readFileSync(path.join(raiz, "api", f), "utf8")))
      .map((f) => "/api/" + path.dirname(f).split(path.sep).join("/").replace(/\[[^\]]+\]/g, "x"));
    for (const r of rutas) expect(subidas.map((s) => s.replace(/\/(a1|mi-marca|p1|w1)(\/|$)/, "/x$2")), r).toContain(r);
  });
});
