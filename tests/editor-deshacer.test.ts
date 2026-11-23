/** UX-38: «Deshacer» a la vista, que sigue deshaciendo (no rehace) y fechas que se entienden. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { versionParaDeshacer } from "@/components/editor-estado";
import { haceCuanto } from "@/lib/formato";
import * as estado from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("deshacer (UX-38)", () => {
  const v = (numero: number, nota: string, hash: string) => ({ numero, nota, hash });
  it("sin vueltas: la versión anterior", () => {
    expect(versionParaDeshacer([v(3, "Subtítulo corregido", "c"), v(2, "Escena quitada", "b"), v(1, "Importado", "a")], 3)?.numero).toBe(2);
  });

  it("deshacer dos veces sigue deshaciendo en vez de rehacer", () => {
    // v4 = vuelta a v2 (se deshizo v3). Volver a «la anterior» (v3) rehacía; lo correcto es v1.
    const vs = [v(4, "Vuelta a la versión 2", "b"), v(3, "Subtítulo corregido", "c"), v(2, "Escena quitada", "b"), v(1, "Importado", "a")];
    expect(versionParaDeshacer(vs, 4)?.numero).toBe(1);
    // Y una tercera vez: v5 = vuelta a v1, ya no hay nada antes.
    expect(versionParaDeshacer([v(5, "Vuelta a la versión 1", "a"), ...vs], 5)).toBeNull();
  });

  it("salta las versiones con el mismo contenido que hoy (guardados sin cambios)", () => {
    const vs = [v(3, "Muletillas quitadas", "b"), v(2, "Silencios largos acortados", "b"), v(1, "Importado", "a")];
    expect(versionParaDeshacer(vs, 3)?.numero).toBe(1);
  });

  it("fecha relativa", () => {
    const ahora = new Date("2026-11-22T12:00:00Z").getTime();
    expect(haceCuanto("2026-11-22T11:59:30Z", ahora)).toBe("hace un momento");
    expect(haceCuanto("2026-11-22T11:55:00Z", ahora)).toBe("hace 5 min");
    expect(haceCuanto("2026-11-22T09:00:00Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-11-21T10:00:00Z", ahora)).toMatch(/^ayer, /);
    // Una sola copia (la de formato.ts, con la hora de «ayer»): el editor la toma de ./comun.
    expect("haceCuanto" in estado).toBe(false);
    expect(editor).toMatch(/import \{[^}]*\bhaceCuanto\b[^}]*\} from "\.\/comun"/);
  });

  it("el botón está arriba, pregunta, y «Volver a esta» también pregunta", () => {
    expect(editor).toContain("↶ Deshacer");
    expect(editor).toContain('href="#historial">Historial</a>');
    expect(editor).toContain('id="historial"');
    expect(editor).toContain("onClick={() => volverA(x.numero,");
    expect(editor).toMatch(/if \(confirm\(pregunta\)\)/);
  });
});
