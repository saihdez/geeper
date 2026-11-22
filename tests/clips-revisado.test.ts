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
    expect(s).toMatch(/maxMinutos: Math\.min\(600/);
  });
});
