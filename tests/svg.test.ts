import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describirAsset } from "@/lib/almacen";
import { compilar } from "@/lib/compilador";
import { ampliaciones } from "@/lib/nitidez";
import { aplicarEdicion } from "@/lib/ediciones";
import { registrarAsset } from "@/lib/ediciones";
import type { Asset, Proyecto } from "@/lib/esquema";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { AMPLIACION_MAX, reglaAmpliacion } from "@/lib/qc";
import { revisarSvg } from "@/lib/svg";
import { proyectoDePrueba } from "./fixtures";

const plantilla = PLANTILLAS_INICIALES[0]!.datos;
const svg = (attrs: string, cuerpo = '<path d="M0 0h10v10z" fill="url(#g)"/>') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!-- exportado de VectorCraft -->\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><defs><linearGradient id="g"/></defs>${cuerpo}</svg>`;

describe("revisarSvg", () => {
  it("lee el tamaño de width/height, del viewBox o de la proporción", () => {
    expect(revisarSvg(svg('width="512" height="128"'))).toEqual({ ancho: 512, alto: 128 });
    expect(revisarSvg(svg('width="512px" height="128px" viewBox="0 0 10 10"'))).toEqual({ ancho: 512, alto: 128 });
    expect(revisarSvg(svg('viewBox="0 0 300.4 100"'))).toEqual({ ancho: 300, alto: 100 });
    expect(revisarSvg(svg('width="600" viewBox="0 0 300 100"'))).toEqual({ ancho: 600, alto: 200 });
    // En unidades físicas no hay píxeles: manda el viewBox.
    expect(revisarSvg(svg('width="10cm" height="5cm" viewBox="0,0,200,100"'))).toEqual({ ancho: 200, alto: 100 });
  });

  it("acepta referencias internas e imágenes raster incrustadas", () => {
    const cuerpo = '<use href="#g"/><use xlink:href="#g"/><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>';
    expect(() => revisarSvg(svg('width="10" height="10" xmlns:xlink="http://www.w3.org/1999/xlink"', cuerpo))).not.toThrow();
  });

  it.each([
    ["script", '<script>alert(1)</script>', /contenido web incrustado/],
    ["script con prefijo", '<svg:script>alert(1)</svg:script>', /contenido web incrustado/],
    ["foreignObject", '<foreignObject><div/></foreignObject>', /contenido web incrustado/],
    ["evento", '<rect onload="alert(1)"/>', /al tocarlo/],
    ["evento en mayúsculas", '<rect ONCLICK = "x"/>', /al tocarlo/],
    ["href externo", '<image href="https://example.com/a.png"/>', /enlaza algo de afuera/],
    ["href a archivo local", '<use xlink:href="otro.svg#a"/>', /enlaza algo de afuera/],
    ["href con entidad", '<a href="&#x6a;avascript:alert(1)"><rect/></a>', /enlaza algo de afuera/],
    ["SVG anidado en data:", '<image href="data:image/svg+xml;base64,PHN2Zz4="/>', /enlaza algo de afuera/],
    ["url() externa en CSS", '<style>rect{fill:url(https://x.y/f.svg#a)}</style>', /recurso de afuera/],
    ["@import", '<style>@import "x.css";</style>', /@import/],
    ["animar href", '<a><set attributeName="href" to="x"/></a>', /cambia enlaces o eventos/],
    ["javascript:", '<a><animate values="javascript:alert(1)"/></a>', /javascript/],
    // Entidades que el parser XML resuelve dentro de los valores (revisión con Nemotron, verificada).
    ["animar href con entidad", '<a><set attributeName="hr&#x65;f" to="https://x.y/"/></a>', /cambia enlaces o eventos/],
    ["animar un evento", '<a><set attributeName="onclick" to="x"/></a>', /cambia enlaces o eventos/],
    ["url() con entidad", '<rect fill="&#x75;rl(https://x.y/a.png)"/>', /recurso de afuera/],
    ["evento con entidad en el valor", '<a><set attributeName="&#111;nclick" to="x"/></a>', /cambia enlaces o eventos/],
    ["escape CSS", '<style>rect{fill:\\75rl(https://x.y/a)}</style>', /barra invertida/],
    ["image-set con cadena", '<style>rect{background:image-set("https://x.y/a.png" 1x)}</style>', /image-set o src/],
  ])("rechaza %s", (_n, cuerpo, motivo) => {
    expect(() => revisarSvg(svg('width="10" height="10"', cuerpo))).toThrow(motivo);
  });

  it("rechaza DOCTYPE, raíz que no es svg y SVG sin tamaño", () => {
    expect(() => revisarSvg('<!DOCTYPE svg [<!ENTITY a "b">]><svg width="1" height="1"/>')).toThrow(/DOCTYPE/);
    expect(() => revisarSvg('<html><svg width="1" height="1"/></html>')).toThrow(/no es un SVG/);
    expect(() => revisarSvg(svg(""))).toThrow(/no dice su tamaño/);
    expect(() => revisarSvg(svg('width="100%" height="100%"'))).toThrow(/no dice su tamaño/);
    // UTF-16 leído como UTF-8: no queda una raíz <svg> reconocible.
    const utf16 = Buffer.from(`﻿${svg('width="1" height="1"')}`, "utf16le").toString("utf8");
    expect(() => revisarSvg(utf16)).toThrow(/no se puede usar/);
    // Texto con entidades comunes sigue entrando.
    expect(() => revisarSvg(svg('width="1" height="1"', "<text>R&amp;D &lt;3 &#233;</text>"))).not.toThrow();
  });
});

describe("SVG como asset", () => {
  it("describirAsset toma el tamaño del SVG sin ffprobe y rechaza uno inseguro", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-svg-"));
    try {
      await fs.mkdir(path.join(dir, "assets"));
      await fs.writeFile(path.join(dir, "assets/logo.svg"), svg('viewBox="0 0 640 160"'));
      const a = await describirAsset(dir, "assets/logo.svg", { id: "logo", tipo: "imagen", source: "archivo", licencia: "propia" });
      expect(a).toMatchObject({ ancho: 640, alto: 160, duracion: undefined });
      expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
      await fs.writeFile(path.join(dir, "assets/malo.svg"), svg('width="1" height="1"', "<script/>"));
      await expect(describirAsset(dir, "assets/malo.svg", { id: "malo", tipo: "imagen", source: "archivo", licencia: "propia" })).rejects.toThrow(/no se puede usar/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("una superposición SVG se compila como <img> y no cuenta para la ampliación", () => {
    const logo: Asset = { id: "logo", tipo: "imagen", ruta: "assets/logo.svg", hash: "c".repeat(64), source: "archivo", licencia: "propia", ancho: 64, alto: 16, regenerar: {} };
    const p = aplicarEdicion(registrarAsset(proyectoDePrueba(), logo), { tipo: "agregarClipLibre", pista: "rotulos", asset: "logo", inicio: 1, duracion: 2, desde: 0 });
    const { html } = compilar(p, plantilla, "/tmp/m.wav", "/tmp/p");
    expect(html).toMatch(/<img id="s-rotulos-0"[^>]*src="[^"]*logo\.svg"/);
    expect(ampliaciones(p, 1080, 1920).map((x) => x.asset)).not.toContain("logo");
  });
});

describe("ampliación de clips raster", () => {
  const conLogoPng = (): Proyecto => {
    const png: Asset = { id: "logo-png", tipo: "imagen", ruta: "assets/logo.png", hash: "d".repeat(64), source: "archivo", licencia: "propia", ancho: 270, alto: 480, regenerar: {} };
    return aplicarEdicion(registrarAsset(proyectoDePrueba(), png), { tipo: "agregarClipLibre", pista: "rotulos", asset: "logo-png", inicio: 0, duracion: 2, desde: 0 });
  };

  it("mide cubrir, contener y el zoom del movimiento", () => {
    const p = proyectoDePrueba();
    // Clips de 1080×1920 en 9:16: píxel a píxel.
    expect(ampliaciones(p, 1080, 1920).every((x) => Math.abs(x.factor - 1) < 1e-9)).toBe(true);
    // Los de MPT (832×1216) cubriendo 9:16: 1,58×, pasa.
    for (const a of Object.values(p.assets)) if (a.tipo === "video") Object.assign(a, { ancho: 832, alto: 1216 });
    expect(ampliaciones(p, 1080, 1920)[0]!.factor).toBeCloseTo(1920 / 1216, 3);
    // Con un zoom de cámara a 1.5× ya no.
    p.pistas[0]!.clips[0]!.movimiento = { desde: { escala: 1, x: 0, y: 0 }, hasta: { escala: 1.5, x: 0, y: 0 } };
    expect(ampliaciones(p, 1080, 1920)[0]!.factor).toBeGreaterThan(AMPLIACION_MAX);
  });

  it("reglaAmpliacion avisa (no bloquea) y dice qué clip", () => {
    const r = reglaAmpliacion(ampliaciones(conLogoPng(), 1080, 1920))!;
    expect(r).toMatchObject({ id: "ampliacion", ok: false, aviso: true });
    expect(r.detalle).toBe("Superposición a los 0.0 s: se estira 4.0× y se verá borrosa. Cámbiala por una de al menos 540×960 px, o por un SVG.");
    expect(reglaAmpliacion(ampliaciones(proyectoDePrueba(), 1080, 1920))).toMatchObject({ ok: true });
    expect(reglaAmpliacion([])).toBeNull();
  });
});

describe("nitidez en palabras", () => {
  it("la regla de nitidez nombra la escena en palabras", () => {
    const p = proyectoDePrueba();
    for (const a of Object.values(p.assets)) if (a.tipo === "video") Object.assign(a, { ancho: 270, alto: 480 });
    const r = reglaAmpliacion(ampliaciones(p, 1080, 1920))!;
    expect(r.detalle?.split("\n")[0]).toMatch(/^Escena 1: se estira 4.0× y se verá borrosa/);
  });
});
