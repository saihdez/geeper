/** UX-34: el análisis avisa cada paso, con archivos no dice «Bajando» y la página nombra el video. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-clips-pasos-"));
process.env.GEEPER_DATA = dir;
const fdir = path.join(dir, "_fuentes", "abcabcabcabc");
fs.mkdirSync(fdir, { recursive: true });

vi.mock("@/lib/fuentes", async (orig) => ({
  ...(await orig<typeof import("@/lib/fuentes")>()),
  traerFuente: async (src: string) => ({
    id: "abcabcabcabc", dir: fdir, video: src, chat: null,
    info: { url: src, titulo: "partida", canal: null, plataforma: "archivo", id: null, duracion: 120, subida: null, vistas: null, heatmap: null, fueDirecto: false },
  }),
}));
vi.mock("@/lib/media", async (orig) => ({ ...(await orig<typeof import("@/lib/media")>()), ffmpeg: async () => ({ codigo: 0, stdout: "", stderr: "" }) }));
vi.mock("@/lib/momentos", async (orig) => ({
  ...(await orig<typeof import("@/lib/momentos")>()),
  // 2 min de sonido con dos picos: salen candidatos sin abrir ningún video.
  dbPorSegundo: async () => Array.from({ length: 120 }, (_, i) => (i > 20 && i < 40) || (i > 80 && i < 100) ? -10 : -40),
}));

describe("pasos del análisis (UX-34)", () => {
  it("buscarMomentos avisa abrir → medir → vistas previas, con avance que sube", async () => {
    const { buscarMomentos, PASOS_MOMENTOS } = await import("@/lib/buscar-momentos");
    const pasos: [string, number][] = [];
    const r = await buscarMomentos({ src: "/videos/partida.mp4", transcribir: false, min: 10, max: 20 }, () => {}, undefined, (e, p) => pasos.push([e, p]));
    expect(r.candidatos.length).toBeGreaterThan(0);
    expect(r.revisado).toBe(120);
    const textos = pasos.map(([e]) => e);
    expect(textos[0]).toBe(`${PASOS_MOMENTOS.abriendo}…`);
    expect(textos.some((e) => /^Bajando/.test(e))).toBe(false);
    expect(textos).toContain(`${PASOS_MOMENTOS.midiendo}…`);
    expect(textos.some((e) => e.startsWith(PASOS_MOMENTOS.vistas))).toBe(true);
    for (let i = 1; i < pasos.length; i++) expect(pasos[i]![1]).toBeGreaterThanOrEqual(pasos[i - 1]![1]);
  });

  it("con un enlace el primer paso es bajar", async () => {
    const { buscarMomentos, PASOS_MOMENTOS } = await import("@/lib/buscar-momentos");
    const pasos: string[] = [];
    await buscarMomentos({ src: "https://www.youtube.com/watch?v=x", transcribir: false, min: 10, max: 20 }, () => {}, undefined, (e) => pasos.push(e));
    expect(pasos[0]).toBe(`${PASOS_MOMENTOS.bajando}…`);
  });

  it("la página no dice «Bajando» con un archivo y nombra el video", async () => {
    const { etapaClip, nombreAnalisis } = await import("@/components/clips");
    expect(etapaClip("Trayendo la fuente y midiendo el sonido", "corriendo", "/datos/subidas/1a2b3c4d-partida.mp4")).toBe("Midiendo dónde hay más reacción…");
    expect(etapaClip("Trayendo la fuente y midiendo el sonido", "corriendo", "https://youtu.be/x")).toMatch(/^Bajando el video/);
    expect(etapaClip("Escuchando lo que se dice (momento 2 de 8)…", "corriendo", "/a.mp4")).toBe("Escuchando lo que se dice (momento 2 de 8)…");
    expect(nombreAnalisis("/datos/subidas/1a2b3c4d-partida.mp4", [])).toBe("partida.mp4");
    expect(nombreAnalisis("https://www.youtube.com/watch?v=x", [])).toBe("youtube.com/watch?v=x");
    expect(nombreAnalisis("https://youtu.be/x", [{ info: { url: "https://youtu.be/x", titulo: "Mi directo", canal: null, plataforma: null, duracion: 1 } }])).toBe("Mi directo");
  });

  it("el idioma va antes de elegir el video y «1 momento» va en singular", () => {
    const s = fs.readFileSync(path.join(process.cwd(), "src/components/clips.tsx"), "utf8");
    expect(s.indexOf('htmlFor="idioma"')).toBeLessThan(s.indexOf("Arrastra tu video aquí"));
    expect(s.indexOf('htmlFor="idioma"')).toBeLessThan(s.indexOf('htmlFor="url"'));
    expect(s).toContain('"1 momento"');
  });
});
