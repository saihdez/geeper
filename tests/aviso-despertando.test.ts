/** GPU-09: mientras se espera a la IA local, junto al botón se dice que puede tardar hasta 3 min. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AVISO_DESPERTANDO } from "@/components/comun";
import { AVISO_DESPERTANDO as DEL_SERVIDOR } from "@/lib/llm-local";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");

describe("aviso de la IA despertando (GPU-09)", () => {
  it("la copia de la pantalla dice lo mismo que el cliente del modelo local", () => {
    expect(AVISO_DESPERTANDO).toBe(DEL_SERVIDOR);
  });

  it.each(["clips.tsx", "panel-publicar.tsx"])("%s lo muestra junto al botón mientras piensa, sin prometer 1 min", (f) => {
    const s = leer(f);
    expect(s).toMatch(/\{pensando\s*(&&|\?)\s*<span[^>]*role="status">\{AVISO_DESPERTANDO\}<\/span>/);
    expect(s).not.toContain("hasta 1 min");
  });
});
