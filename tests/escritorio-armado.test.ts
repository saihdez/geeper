import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copiarStandalone, revisarStandalone } from "../scripts/escritorio/armado";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-armado-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function escribir(rel: string, contenido: string | Buffer = "x"): void {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenido);
}

describe("servidor standalone de la app (ESC-15)", () => {
  it("copia sólo server.js, package.json y .next-escritorio, sin los alias de Turbopack", () => {
    escribir("de/server.js");
    escribir("de/package.json", "{}");
    escribir("de/.next-escritorio/server/app/page.js");
    escribir("de/.next-escritorio/node_modules/@prisma/client-abc/index.js");
    escribir("de/src/lib/rutas.ts");
    escribir("de/dist-escritorio/Geeper-0.1.0.exe");
    escribir("de/py/reencuadre.py");
    escribir("de/.env.local", "SECRETO=1");
    copiarStandalone(path.join(tmp, "de"), path.join(tmp, "a"));
    const quedan = fs.readdirSync(path.join(tmp, "a"), { recursive: true }).map(String).sort();
    expect(quedan).toEqual([".next-escritorio", path.join(".next-escritorio", "server"), path.join(".next-escritorio", "server", "app"), path.join(".next-escritorio", "server", "app", "page.js"), "package.json", "server.js"].sort());
  });

  it("falla si al standalone le falta lo que el servidor necesita", () => {
    escribir("de/package.json", "{}");
    expect(() => copiarStandalone(path.join(tmp, "de"), path.join(tmp, "a"))).toThrow(/server\.js/);
  });

  it("la guarda rechaza un .env y un servidor demasiado grande", () => {
    escribir("s/server.js");
    expect(() => revisarStandalone(path.join(tmp, "s"))).not.toThrow();
    escribir("s/.next-escritorio/.env.production", "X=1");
    expect(() => revisarStandalone(path.join(tmp, "s"))).toThrow(/\.env/);
    fs.rmSync(path.join(tmp, "s", ".next-escritorio"), { recursive: true });
    escribir("s/grande.bin", Buffer.alloc(2048));
    expect(() => revisarStandalone(path.join(tmp, "s"), 1024)).toThrow(/pesa/);
  });
});
