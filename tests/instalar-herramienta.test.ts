/** COD-01: PhotoCraft usa el mismo botón de instalar que VectorCraft (sin copia aparte). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(process.cwd(), "src", "components");

describe("instalar herramientas (COD-01)", () => {
  it("no queda la copia de PhotoCraft y Sistema usa el genérico", () => {
    expect(fs.existsSync(path.join(dir, "instalar-photocraft.tsx"))).toBe(false);
    const s = fs.readFileSync(path.join(dir, "sistema.tsx"), "utf8");
    expect(s).toContain('<InstalarHerramienta api="/api/sistema/photocraft"');
    expect(s).not.toContain("InstalarPhotocraft");
  });
});
