/** A11-05: cada pestaña se llama distinto; el proyecto y la campaña, por su nombre. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-titulos-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_CONFIG = path.join(dir, "config");

let tituloDe: typeof import("@/lib/titulos-pagina")["tituloDe"];

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  const { db } = await import("@/lib/db");
  tituloDe = (await import("@/lib/titulos-pagina")).tituloDe;
  await db.proyecto.create({ data: { id: "p1", slug: "p1", nombre: "  Faros del mundo ", tema: "t", formato: "9:16", plantilla: "x" } });
  await db.campana.create({ data: { id: "c1", nombre: "Rebajas de invierno", datos: {} } });
}, 60_000);

describe("títulos de pestaña", () => {
  it("usa el nombre del proyecto o de la campaña", async () => {
    expect(await tituloDe("proyecto", "p1")).toBe("Faros del mundo");
    expect(await tituloDe("campana", "c1")).toBe("Rebajas de invierno");
  });

  it("si no existe, un nombre genérico en vez de fallar", async () => {
    expect(await tituloDe("proyecto", "nada")).toBe("Video");
    expect(await tituloDe("campana", "nada")).toBe("Anuncio");
  });

  it("cada sección de la barra tiene su título", () => {
    for (const d of ["nuevo", "clips", "avatares", "workflows", "trabajos", "anuncios", "plantillas", "media", "cuentas", "sistema"]) {
      expect(fs.readFileSync(path.join(process.cwd(), "src", "app", d, "layout.tsx"), "utf8")).toMatch(/title: "[^"]+"/);
    }
  });
});
