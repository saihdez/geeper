/** «Volver a intentar» de un trabajo que usa la tarjeta pide antes «Ya guardé…», como las demás acciones. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), r), "utf8");

describe("reintentar con la tarjeta", () => {
  it("BotonReintentar muestra el aviso y deja el botón apagado hasta marcar la casilla", () => {
    const s = leer("src/components/comun.tsx");
    expect(s).toContain("export function BotonReintentar");
    expect(s).toMatch(/if \(!usaGpu \|\| \(g\.guardado && !pidiendo\)\)/);
    expect(s).toMatch(/disabled=\{disabled \|\| !g\.guardado\}/);
    expect(s).toContain("<AvisoTarjeta g={g} />");
  });

  it("la lista de trabajos y los avisos del editor lo usan con usaGpu", () => {
    const lista = leer("src/components/lista-trabajos.tsx");
    expect(lista).toContain("<BotonReintentar usaGpu={t.usaGpu}");
    expect(lista).not.toMatch(/accion\(t\.id, "relanzar"\)\}>Volver a intentar/);
    const editor = leer("src/components/editor-proyecto.tsx");
    expect(editor.match(/<BotonReintentar /g)?.length).toBe(2);
    expect(editor).not.toMatch(/accion: "relanzar" \}\), "Listo: lo estamos intentando otra vez\."\)\}>Volver a intentar/);
  });

  it("la vista del proyecto trae usaGpu de cada trabajo", () => {
    expect(leer("src/lib/vista.ts")).toMatch(/trabajos: \{ orderBy: \{ creado: "desc" \}, take: 30, select: \{[^}]*usaGpu: true/);
  });
});
