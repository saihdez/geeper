import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copiarStandalone, faltantesApp, podarNodeModules, revisarStandalone } from "../scripts/escritorio/armado";

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

describe("node_modules de la app (ESC-04)", () => {
  it("borra lo que no se usa al correr y deja lo que el servidor carga", () => {
    const quedan = [
      "next/dist/server/next-server.js",
      "@next/env/index.js",
      "@prisma/client/runtime/client.js",
      "@prisma/client/runtime/query_compiler_fast_bg.sqlite.mjs",
      "@prisma/client-ad5a1/runtime/query_compiler_fast_bg.sqlite.wasm-base64.mjs",
      "@prisma/adapter-better-sqlite3/dist/index.js",
      "better-sqlite3/lib/index.js",
      "better-sqlite3/build/Release/better_sqlite3.node",
      "hyperframes/dist/hyperframe.runtime.iife.js",
    ];
    const van = [
      "@next/swc-win32-x64-msvc/next-swc.node",
      "@next/swc-darwin-arm64/next-swc.node",
      "@img/sharp-win32-x64/lib/sharp.node",
      "sharp/lib/index.js",
      "@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs",
      "@prisma/client/runtime/query_compiler_small_bg.mysql.js",
      "@prisma/client-ad5a1/runtime/query_compiler_fast_bg.sqlserver.wasm-base64.js",
      "@prisma/client-ad5a1/runtime/query_compiler_fast_bg.cockroachdb.mjs",
      "better-sqlite3/deps/sqlite3/sqlite3.c",
      "better-sqlite3/src/better_sqlite3.cpp",
      "better-sqlite3/build/Release/obj.target/better_sqlite3.o",
      "better-sqlite3/build/Release/obj/x.obj",
    ];
    for (const f of [...quedan, ...van]) escribir(path.join("nm", f));
    const nm = path.join(tmp, "nm");
    podarNodeModules(nm);
    for (const f of quedan) expect(fs.existsSync(path.join(nm, f)), f).toBe(true);
    for (const f of van) expect(fs.existsSync(path.join(nm, f)), f).toBe(false);
  });

  it("sin nada que podar no falla", () => {
    fs.mkdirSync(path.join(tmp, "vacio"));
    expect(podarNodeModules(path.join(tmp, "vacio"))).toEqual([]);
  });
});

describe("lo que la app lee al correr (ESC-01)", () => {
  it("nombra lo que falta: el runtime de Hyperframes, los .py, fuentes.json y esquema.sql", () => {
    const app = path.join(tmp, "app");
    fs.mkdirSync(app);
    expect(faltantesApp(app)).toEqual(expect.arrayContaining([path.join("node_modules", "hyperframes", "dist", "hyperframe.runtime.iife.js"), path.join("docs", "fuentes.json"), "esquema.sql", path.join("py", "*.py")]));
    for (const f of ["node_modules/hyperframes/dist/hyperframe.runtime.iife.js", "node_modules/hyperframes/bin/hyperframes.mjs", "docs/fuentes.json", "esquema.sql", "standalone/server.js", "main.cjs", "worker.mjs", "preparar-db.mjs", "vigia.mjs", "py/reencuadre.py"]) escribir(path.join("app", f));
    expect(faltantesApp(app)).toEqual([]);
    fs.writeFileSync(path.join(app, "esquema.sql"), "");
    expect(faltantesApp(app)).toEqual(["esquema.sql"]);
  });
});
