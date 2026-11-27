/** Componentes de la página del proyecto que no deben arrastrar zod ni esquema.ts al navegador (WEB-12). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SIN_ESQUEMA = ["src/components/panel-presentador.tsx"];

describe("sin zod en el cliente del proyecto (WEB-12)", () => {
  for (const f of SIN_ESQUEMA) {
    it(`${f} sólo importa tipos de esquema.ts`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      const valores = [...src.matchAll(/^import\s+(?!type\b)[^;]*from\s+"(?:@\/lib\/esquema|\.\.?\/[^"]*esquema)";/gm)].map((m) => m[0]);
      expect(valores).toEqual([]);
      expect(src).not.toMatch(/from\s+"zod"/);
    });
  }
});
