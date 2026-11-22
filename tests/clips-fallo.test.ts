/** UX-03: si el análisis de un enlace falla, se dice por qué en palabras simples y se puede reintentar. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-clips-fallo-"));
process.env.GEEPER_DATA = dir;
// Un «python» que hace de yt-dlp y falla como un video privado (no baja nada ni usa la red).
const falso = path.join(dir, "python-falso.sh");
fs.writeFileSync(falso, "#!/bin/sh\necho 'ERROR: [youtube] abc123: Private video. Sign in if you have been granted access' >&2\nexit 1\n", { mode: 0o755 });
process.env.GEEPER_PYTHON_CLIPS = falso;

describe("fallos al abrir un enlace (UX-03)", () => {
  it("los fallos típicos de yt-dlp se dicen simple", async () => {
    const { explicarFalloYtdlp, FALLO_ENLACE } = await import("@/lib/fuentes");
    expect(explicarFalloYtdlp("ERROR: [youtube] x: Private video")).toMatch(/es privado/);
    expect(explicarFalloYtdlp("ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader")).toMatch(/ya no existe/);
    expect(explicarFalloYtdlp("ERROR: Unsupported URL: https://example.com/a")).toMatch(/No reconozco ese enlace/);
    expect(explicarFalloYtdlp("ERROR: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>")).toMatch(/internet/);
    expect(explicarFalloYtdlp("ERROR: Sign in to confirm you’re not a bot")).toMatch(/robot/);
    expect(explicarFalloYtdlp("/venv/bin/python: No module named yt_dlp")).toMatch(/le falta la herramienta/);
    expect(explicarFalloYtdlp("ERROR: Unable to download webpage: HTTP Error 403: Forbidden")).toMatch(/no dejó bajar/);
    expect(explicarFalloYtdlp("algo rarísimo")).toBe(FALLO_ENLACE);
  });

  it("traerFuente falla con la frase simple y el comando queda sólo en el detalle", async () => {
    const { traerFuente } = await import("@/lib/fuentes");
    const { explicarError } = await import("@/lib/textos");
    const e = await traerFuente("https://www.youtube.com/watch?v=abc123").catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    const { simple, detalle } = explicarError((e as Error).message);
    expect(simple).toMatch(/^Ese video es privado/);
    expect(simple).not.toMatch(/python|yt_dlp|Falló/);
    expect(detalle).toContain("Private video");
  });

  it("la página pinta la frase, «Volver a intentar» y el detalle plegado; los botones no dependen de `esperando`", async () => {
    const { FalloAnalisis } = await import("@/components/clips");
    const { SEPARADOR_DETALLE } = await import("@/lib/textos");
    const html = renderToStaticMarkup(createElement(FalloAnalisis, { t: { estado: "fallido", error: `Ese video es privado.${SEPARADOR_DETALLE}Falló (1): python -m yt_dlp` }, reintentar: () => {} }));
    expect(html).toContain("Ese video es privado.");
    expect(html).toContain("Volver a intentar");
    expect(html).toContain("Ver detalle técnico");
    const crudo = renderToStaticMarkup(createElement(FalloAnalisis, { t: { estado: "fallido", error: "Falló (1): /x/python -m yt_dlp -J https://y" }, reintentar: () => {} }));
    expect(crudo).toContain("No pude abrir ese video. Revisa que el enlace esté completo");
    const cancelado = renderToStaticMarkup(createElement(FalloAnalisis, { t: { estado: "cancelado", error: "Cancelado por la persona" }, reintentar: () => {} }));
    expect(cancelado).toContain("Se canceló");
    const s = fs.readFileSync(path.join(process.cwd(), "src/components/clips.tsx"), "utf8");
    expect(s).not.toContain("Boolean(esperando)}");
    expect(s).not.toContain("No pude analizar ese video: {fallo.error}");
  });
});
