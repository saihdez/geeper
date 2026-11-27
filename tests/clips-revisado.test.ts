/** UX-24: de un video de más de 90 minutos se dice que sólo se revisó una parte, y se puede revisar todo. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-clips-revisado-"));
process.env.GEEPER_DATA = dir;

describe("video más largo que el tope (UX-24)", () => {
  it("la página lo dice sólo si quedó una parte sin revisar", async () => {
    const { revisadoParcial } = await import("@/components/clips");
    const info = (duracion: number) => ({ url: "https://y", titulo: "t", canal: null, plataforma: "Youtube", duracion });
    expect(revisadoParcial({ info: info(12_000), revisado: 5400 })).toBe("la primera hora y media");
    expect(revisadoParcial({ info: info(12_000) })).toBe("la primera hora y media"); // análisis viejo, sin el dato
    expect(revisadoParcial({ info: info(12_000), revisado: 7200 })).toBe("los primeros 2 h");
    expect(revisadoParcial({ info: info(5000), revisado: 5000 })).toBeNull();
    expect(revisadoParcial({ info: info(12_000), revisado: 11_990 })).toBeNull();
  });

  it("listarFuentes da lo revisado (guardado o, si es viejo, el tope de 90 min)", async () => {
    const { listarFuentes } = await import("@/lib/buscar-momentos");
    const base = path.join(dir, "_fuentes");
    const crear = (id: string, duracion: number, revisado?: number) => {
      fs.mkdirSync(path.join(base, id), { recursive: true });
      fs.writeFileSync(path.join(base, id, "info.json"), JSON.stringify({ url: "https://y", titulo: id, canal: null, plataforma: "Youtube", duracion }));
      fs.writeFileSync(path.join(base, id, "candidatos.json"), JSON.stringify({ candidatos: [], idioma: "es", creado: "2026-11-22", ...(revisado ? { revisado } : {}) }));
    };
    crear("aaaaaaaaaaaa", 12_000);
    crear("bbbbbbbbbbbb", 12_000, 12_000);
    const fs2 = await listarFuentes();
    expect(fs2.find((f) => f.id === "aaaaaaaaaaaa")?.revisado).toBe(5400);
    expect(fs2.find((f) => f.id === "bbbbbbbbbbbb")?.revisado).toBe(12_000);
  });

  it("si lo bajado es más corto que lo que ahora se pide, se baja otra vez", async () => {
    const { faltaPorBajar } = await import("@/lib/fuentes");
    expect(faltaPorBajar(5400, 12_000, 5400)).toBe(false); // mismo tope: se reutiliza
    expect(faltaPorBajar(5400, 12_000, 600 * 60)).toBe(true); // «Revisar todo el video»
    expect(faltaPorBajar(11_995, 12_000, 600 * 60)).toBe(false); // ya estaba completo
    expect(faltaPorBajar(0, 12_000, 5400)).toBe(true); // el archivo no se pudo leer
  });

  it("el paso 2 avisa y ofrece revisar todo", () => {
    const s = fs.readFileSync(path.join(process.cwd(), "src/components/clips.tsx"), "utf8");
    expect(s).toContain("Revisar todo el video (tarda más y ocupa más espacio)");
    expect(s).toMatch(/pedidoOtraVez\(f, Math\.min\(600/);
  });

  it("«Revisar todo» pide lo que pegó la persona, con su idioma y sus duraciones", async () => {
    const { pedidoOtraVez } = await import("@/components/clips");
    const info = { url: "https://www.youtube.com/watch?v=abc", src: "https://youtu.be/abc?t=30", titulo: "t", canal: null, plataforma: "Youtube", duracion: 12_000 };
    expect(pedidoOtraVez({ info, idioma: "en", opciones: { top: 8, min: 20, max: 60 } }, 201))
      .toEqual({ src: "https://youtu.be/abc?t=30", idioma: "en", top: 8, min: 20, max: 60, maxMinutos: 201 });
    // Análisis viejo: sin `src` ni opciones, usa la página y deja las duraciones por omisión.
    expect(pedidoOtraVez({ info: { ...info, src: undefined }, idioma: null, opciones: null }))
      .toEqual({ src: "https://www.youtube.com/watch?v=abc", idioma: "es" });
  });

  it("listarFuentes da las opciones con que se buscó", async () => {
    const { listarFuentes } = await import("@/lib/buscar-momentos");
    const d = path.join(dir, "_fuentes", "cccccccccccc");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "info.json"), JSON.stringify({ url: "https://y", titulo: "c", canal: null, plataforma: "Youtube", duracion: 100 }));
    fs.writeFileSync(path.join(d, "candidatos.json"), JSON.stringify({ candidatos: [], idioma: "es", opciones: { top: 5, min: 20, max: 60 }, creado: "2026-11-22" }));
    expect((await listarFuentes()).find((f) => f.id === "cccccccccccc")?.opciones).toEqual({ top: 5, min: 20, max: 60 });
  });

  it("la webpage_url de una fuente ya traída da esa misma carpeta, no una nueva", async () => {
    const { idDeEnlace, idFuente } = await import("@/lib/fuentes");
    const d = path.join(dir, "_fuentes", "dddddddddddd");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "info.json"), JSON.stringify({ url: "https://www.youtube.com/watch?v=zzz", titulo: "d", canal: null, plataforma: "Youtube", duracion: 100 }));
    expect(await idDeEnlace("https://www.youtube.com/watch?v=zzz")).toBe("dddddddddddd");
    expect(await idDeEnlace("https://youtu.be/otro")).toBe(idFuente("https://youtu.be/otro"));
  });

  it("al volver de «Revisar todo», el paso 1 sigue ese trabajo y enseña si falló", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Paso1 } = await import("@/components/clips");
    const datos = {
      fuentes: [], workerVivo: true,
      trabajos: [{ id: "t1", estado: "fallido", etapa: "", progreso: 0, error: "Ese video es privado.", payload: { src: "https://y" }, resultado: null }],
    };
    const props = { datos, recargar: async () => {}, elegir: () => {} };
    expect(renderToStaticMarkup(createElement(Paso1, { ...props, trabajoInicial: "t1" }))).toContain("Volver a intentar");
    expect(renderToStaticMarkup(createElement(Paso1, props))).not.toContain("Volver a intentar");
  });
});
