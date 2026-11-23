/** A11-07: con teclado se salta a las escenas o al historial, y cada reproductor tiene nombre. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");
const editor = leer("editor-proyecto.tsx");

describe("saltos y nombres en el editor (A11-07)", () => {
  it("al principio hay enlaces «Ir a las escenas» e «Ir al historial» que llevan a su lugar", () => {
    const inicio = editor.slice(editor.indexOf("<FranjaAviso"), editor.indexOf('<header id="arriba"'));
    expect(inicio).toMatch(/href="#escenas"[^>]*>Ir a las escenas</);
    expect(inicio).toMatch(/href="#historial"[^>]*onClick=\{\(\) => setHistorialAbierto\(true\)\}>Ir al historial</);
    expect(editor).toMatch(/<ol id="escenas"/);
    expect(editor).toMatch(/<Plegable id="historial"/);
  });

  it("el video creado y la vista en vivo tienen nombre para el lector de pantalla", () => {
    expect(editor).toMatch(/<video key=\{render\.id\}[^>]*aria-label=\{`Video creado/);
    expect(leer("vista-en-vivo.tsx")).toMatch(/"aria-label": `Vista en vivo del video/);
    expect(editor).toContain('etiqueta="Avance del video"');
  });
});
