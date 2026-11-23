import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ACCEPT_IMAGEN, esVector } from "@/lib/formatos-vector";
import { VECTORCRAFT_CLI, VECTORCRAFT_VERSION } from "@/lib/rutas";
import { describirAsset } from "@/lib/almacen";
import { compilar } from "@/lib/compilador";
import { aplicarEdicion, registrarAsset } from "@/lib/ediciones";
import { validarProyecto, type Asset, type Proyecto } from "@/lib/esquema";
import { ampliaciones, cambiarAsset } from "@/lib/nitidez";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { reglaAmpliacion } from "@/lib/qc";
import { revisarSvg } from "@/lib/svg";
import { proyectoDePrueba } from "./fixtures";
import { pruebasReales } from "./ayudas/reales";

const instalado = (() => {
  try {
    return execFileSync(VECTORCRAFT_CLI, ["--version"], { encoding: "utf8" }).includes(VECTORCRAFT_VERSION);
  } catch {
    return false;
  }
})();

const MARCA = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120"><rect width="400" height="120" rx="20" fill="#ff3d7f"/><text x="30" y="80" font-family="sans-serif" font-size="56" font-weight="700" fill="#fff">DIMERSO</text></svg>`;

describe("formatos vectoriales", () => {
  it("reconoce .ai, .pdf, .eps y Affinity sin importar mayúsculas, y los ofrece en el selector", () => {
    for (const n of ["logo.ai", "Logo.PDF", "marca.eps", "x.afdesign"]) expect(esVector(n)).toBe(true);
    for (const n of ["logo.svg", "logo.png", "ai", "video.mp4"]) expect(esVector(n)).toBe(false);
    expect(ACCEPT_IMAGEN.split(",")).toEqual(expect.arrayContaining(["image/*", ".svg", ".ai", ".pdf", ".eps"]));
  });

  it("sin VectorCraft, un .ai da un mensaje que dice cómo instalarlo", async () => {
    vi.resetModules();
    vi.stubEnv("GEEPER_VECTORCRAFT", path.join(os.tmpdir(), "no-existe-vectorcraft-cli"));
    try {
      const { aSvg } = await import("@/lib/vectorcraft");
      await expect(aSvg(Buffer.from("%PDF"), "logo.ai")).rejects.toThrow(/Instalar con un clic/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe.skipIf(!pruebasReales || !instalado)("VectorCraft real", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-vc-test-"));
  fs.writeFileSync(path.join(dir, "marca.svg"), MARCA);
  // Un PDF y un PNG de verdad, hechos con la misma CLI (como los exportaría un programa de diseño).
  execFileSync(VECTORCRAFT_CLI, ["--safe-mode", "convert", path.join(dir, "marca.svg"), path.join(dir, "marca.pdf")]);
  execFileSync(VECTORCRAFT_CLI, ["--safe-mode", "convert", path.join(dir, "marca.svg"), path.join(dir, "marca.png"), "--ppi", "144"]);

  it("un logo en PDF sale como SVG seguro, del mismo tamaño y con el texto en contornos", async () => {
    const { aSvg } = await import("@/lib/vectorcraft");
    const r = await aSvg(fs.readFileSync(path.join(dir, "marca.pdf")), "Marca Final.pdf");
    const texto = r.svg.toString("utf8");
    expect(revisarSvg(texto)).toEqual({ ancho: 400, alto: 120 });
    expect(texto).not.toMatch(/<text\b/);
    expect(texto).toMatch(/<path\b/);
  });

  it("un logo PNG plano se vectoriza en pocos trazos", async () => {
    const { vectorizar } = await import("@/lib/vectorcraft");
    const r = await vectorizar(fs.readFileSync(path.join(dir, "marca.png")), "marca.png");
    const texto = r.svg.toString("utf8");
    expect(() => revisarSvg(texto)).not.toThrow();
    const trazos = texto.match(/<path\b/g)?.length ?? 0;
    expect(trazos).toBeGreaterThan(0);
    expect(trazos).toBeLessThan(200);
  });

  it("vectorizar conserva los colores del logo (no lo pasa a blanco y negro)", async () => {
    const { vectorizar } = await import("@/lib/vectorcraft");
    // Logo de dos colores planos sobre blanco.
    fs.writeFileSync(path.join(dir, "color.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#ffffff"/><rect x="10" y="10" width="80" height="100" fill="#1d3888"/><rect x="110" y="10" width="80" height="100" fill="#f59d09"/></svg>');
    execFileSync(VECTORCRAFT_CLI, ["--safe-mode", "convert", path.join(dir, "color.svg"), path.join(dir, "color.png")]);
    const texto = (await vectorizar(fs.readFileSync(path.join(dir, "color.png")), "color.png")).svg.toString("utf8").toLowerCase();
    const colores = new Set(texto.match(/#[0-9a-f]{6}/g) ?? []);
    const cerca = (hex: string) => [...colores].some((c) => [1, 3, 5].every((i) => Math.abs(parseInt(c.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= 24));
    expect(cerca("#1d3888")).toBe(true);
    expect(cerca("#f59d09")).toBe(true);
  });

  it("un archivo roto da un mensaje en palabras, no un volcado", async () => {
    const { aSvg } = await import("@/lib/vectorcraft");
    await expect(aSvg(Buffer.from("esto no es un PDF"), "roto.pdf")).rejects.toThrow(/No se pudo convertir el archivo.*exportarlo como SVG o PNG/);
  });
});

describe("vectorizar desde el aviso de nitidez", () => {
  const logoPng = (): Proyecto => {
    const png: Asset = { id: "logo-png", tipo: "imagen", ruta: "assets/logo.png", hash: "d".repeat(64), source: "archivo", licencia: "propia", ancho: 270, alto: 480, regenerar: {} };
    return aplicarEdicion(registrarAsset(proyectoDePrueba(), png), { tipo: "agregarClipLibre", pista: "rotulos", asset: "logo-png", inicio: 1, duracion: 2, desde: 0, opacidad: 0.8 });
  };

  it("la regla ofrece vectorizar sólo imágenes borrosas, una vez por imagen", () => {
    const p = logoPng();
    for (const a of Object.values(p.assets)) if (a.tipo === "video") Object.assign(a, { ancho: 270, alto: 480 });
    const m = reglaAmpliacion(ampliaciones(p, 1080, 1920))!.medido as { vectorizables: { asset: string; donde: string }[] };
    // Los clips de video también están borrosos, pero un video no se vectoriza.
    expect(m.vectorizables).toEqual([{ asset: "logo-png", donde: "Superposición a los 1.0 s" }]);
  });

  it("cambiarAsset reemplaza la imagen en sus clips y conserva el resto del clip", () => {
    const p = logoPng();
    const svg: Asset = { id: "vector-abc", tipo: "imagen", ruta: "assets/vector-abc.svg", hash: "e".repeat(64), source: "archivo", licencia: "propia", ancho: 270, alto: 480, regenerar: { desde: "logo-png" } };
    const q = cambiarAsset(p, "logo-png", svg);
    const clip = q.pistas.find((x) => x.id === "rotulos")!.clips[0]!;
    expect(clip).toMatchObject({ asset: "vector-abc", inicio: 1, opacidad: 0.8 });
    expect(p.pistas.find((x) => x.id === "rotulos")!.clips[0]!.asset).toBe("logo-png");
    expect(() => validarProyecto(q)).not.toThrow();
    expect(() => cambiarAsset(p, "no-existe", svg)).toThrow(/ya no está/);
  });

  it.skipIf(!pruebasReales || !instalado)("de punta a punta: PNG → SVG con VectorCraft → asset → compila como <img> SVG", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-vect-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "marca.svg"), MARCA);
    execFileSync(VECTORCRAFT_CLI, ["--safe-mode", "convert", path.join(dir, "marca.svg"), path.join(dir, "assets", "logo.png"), "--ppi", "72"]);
    const { vectorizar } = await import("@/lib/vectorcraft");
    const { svg } = await vectorizar(fs.readFileSync(path.join(dir, "assets", "logo.png")), "logo.png");
    fs.writeFileSync(path.join(dir, "assets", "vector.svg"), svg);
    const nuevo = await describirAsset(dir, "assets/vector.svg", { id: "vector", tipo: "imagen", source: "archivo", licencia: "propia" });
    expect(nuevo).toMatchObject({ ancho: 400, alto: 120 });
    const q = cambiarAsset(logoPng(), "logo-png", nuevo);
    const { html } = compilar(q, PLANTILLAS_INICIALES[0]!.datos, "/tmp/m.wav", dir);
    expect(html).toMatch(/<img id="s-rotulos-0"[^>]*src="assets\/vector\.svg"/);
    expect(ampliaciones(q, 1080, 1920).map((x) => x.asset)).not.toContain("vector");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
