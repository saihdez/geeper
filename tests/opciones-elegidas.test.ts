/** A11-08: lo elegido se marca con .opcion / .opcion-tarjeta y aria-pressed o aria-checked, no con el botón principal. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", r), "utf8");

describe("opciones elegidas (A11-08)", () => {
  it.each(["clips.tsx", "avatares.tsx", "workflows.tsx"])("%s no pinta lo elegido con boton-primario ni con contorno celeste", (r) => {
    const s = leer(r);
    // boton-primario sólo fijo (la acción siguiente), nunca según lo elegido.
    expect(s).not.toMatch(/\? "boton-primario"/);
    expect(s).not.toMatch(/outline-cyan-500|ring-2 ring-cyan-500|border-cyan-400/);
    expect(s).toMatch(/className="opcion(-tarjeta)?[ "]/);
  });

  it("cada opción con .opcion dice si está elegida (aria-pressed, aria-checked o un radio adentro)", () => {
    for (const r of ["clips.tsx", "avatares.tsx", "workflows.tsx"]) {
      for (const m of leer(r).matchAll(/<(button|label)\b[^>]*className="opcion[^"]*"[^>]*>/g)) {
        if (m[1] === "label") continue; // lleva <input type="radio"> adentro
        expect(m[0], `${r}: ${m[0].slice(0, 80)}`).toMatch(/aria-(pressed|checked)=/);
      }
    }
  });

  it("los pasos de Clips y Avatares se marcan igual: el actual con aria-current y su número en celeste", async () => {
    const { CLASE_PASO, CIRCULO_PASO } = await import("@/components/comun");
    expect(CIRCULO_PASO.actual).toContain("bg-cyan-500");
    expect(CLASE_PASO.actual).toContain("font-semibold");
    for (const r of ["clips.tsx", "avatares.tsx"]) {
      const s = leer(r);
      expect(s).toContain("CIRCULO_PASO[");
      expect(s).toContain('aria-current={');
    }
    expect(leer("clips.tsx")).not.toContain("border-cyan-500 bg-cyan-950/50 text-white");
  });
});
