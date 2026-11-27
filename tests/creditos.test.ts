import { describe, expect, it } from "vitest";
import { LICENCIA_LIBRE } from "../src/lib/animos-musica";
import { creditosDe } from "../src/lib/creditos";
import type { Proyecto } from "../src/lib/esquema";
import { proyectoDePrueba } from "./fixtures";

const h = "b".repeat(64);
function con(assets: { id: string; tipo: "audio" | "imagen" | "video"; licencia: string }[]): Proyecto {
  const p = proyectoDePrueba();
  for (const a of assets) {
    p.assets[a.id] = { ...a, ruta: `assets/${a.id}.ogg`, hash: h, source: "archivo", regenerar: {} };
    p.pistas.push({ id: `pista-${a.id}`, tipo: a.tipo === "audio" ? "audio" : "video", clips: [{ id: `c-${a.id}`, asset: a.id, inicio: 0, rango: { inicio: 0, duracion: 1 } }] });
  }
  for (const a of Object.values(p.assets)) if (a.licencia === "x") a.licencia = "Apache-2.0 (prueba)";
  return p;
}

describe("creditosDe", () => {
  it("con todo libre no hace falta crédito; con lo de Doory ofrece una línea de cortesía", () => {
    const c = creditosDe(con([{ id: "libre-whoosh-soft", tipo: "audio", licencia: LICENCIA_LIBRE }]));
    expect(c).toMatchObject({ hacenFalta: false, lineas: [], avisos: [] });
    expect(c.cortesia).toMatch(/Doory/);
  });

  it("CC BY pide crédito; CC0 y CC BY-NC no lo cuentan como CC BY", () => {
    const c = creditosDe(con([{ id: "musica", tipo: "audio", licencia: "CC BY 4.0, «Canción» de Ana" }, { id: "otra", tipo: "audio", licencia: "CC0 1.0" }]));
    expect(c.hacenFalta).toBe(true);
    expect(c.lineas).toEqual(["La música: CC BY 4.0, «Canción» de Ana"]);
    const nc = creditosDe(con([{ id: "musica", tipo: "audio", licencia: "CC BY-NC 4.0" }]));
    expect(nc.hacenFalta).toBe(false);
    expect(nc.avisos[0]).toMatch(/fines comerciales/);
  });

  it("lo desconocido no se da por libre: avisa", () => {
    const c = creditosDe(con([{ id: "musica", tipo: "audio", licencia: "desconocida: resource/songs de MPT" }]));
    expect(c.avisos[0]).toMatch(/la música/);
  });

  it("un asset que ya no usa ningún clip no cuenta", () => {
    const p = proyectoDePrueba();
    p.assets.viejo = { id: "viejo", tipo: "audio", ruta: "assets/viejo.mp3", hash: h, source: "archivo", licencia: "desconocida", regenerar: {} };
    expect(creditosDe(p).avisos.some((a) => a.includes("desconocida"))).toBe(false);
  });
});
