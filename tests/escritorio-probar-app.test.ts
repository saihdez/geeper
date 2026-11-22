import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probarApp } from "../scripts/escritorio/probar-app";
import { entornoHijos } from "../escritorio/reglas";

let app: string;
beforeEach(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-app-falsa-"));
  fs.copyFileSync(path.join(__dirname, "..", "escritorio", "vigia.mjs"), path.join(app, "vigia.mjs"));
  fs.mkdirSync(path.join(app, "standalone"));
});
afterEach(() => fs.rmSync(app, { recursive: true, force: true }));

/** Una app armada de mentira: preparar-db anota que corrió; el servidor responde con `plantillas`. */
function armar({ db = "process.exit(0)", plantillas = '[{"slug":"x"}]' } = {}): void {
  fs.writeFileSync(path.join(app, "preparar-db.mjs"), db);
  fs.writeFileSync(
    path.join(app, "standalone", "server.js"),
    `require("node:http").createServer((q, r) => {
       if (q.url === "/api/plantillas") return r.end(JSON.stringify({ plantillas: ${plantillas}, repo: process.env.GEEPER_REPO }));
       r.end("<html>Geeper</html>");
     }).listen(Number(process.env.PORT), process.env.HOSTNAME);`,
  );
}

const callado = { log: () => {} };

describe("prueba de la app armada antes del instalador (ESC-12)", () => {
  it("pasa si preparar-db termina bien y el servidor responde", async () => {
    armar();
    expect(await probarApp({ app, ejecutable: process.execPath, ...callado })).toEqual([]);
  });

  it("falla si preparar-db falla", async () => {
    armar({ db: "process.exit(3)" });
    expect(await probarApp({ app, ejecutable: process.execPath, ...callado })).toEqual(["preparar-db terminó con código 3"]);
  });

  it("falla si la base quedó sin las plantillas iniciales", async () => {
    armar({ plantillas: "[]" });
    const fallas = await probarApp({ app, ejecutable: process.execPath, ...callado });
    expect(fallas).toEqual([expect.stringMatching(/^\/api\/plantillas: no hay plantillas/)]);
  });

  it("falla si el servidor se cae al arrancar (un módulo que no viajó)", async () => {
    armar();
    fs.writeFileSync(path.join(app, "standalone", "server.js"), 'require("modulo-que-no-viajo");');
    const fallas = await probarApp({ app, ejecutable: process.execPath, ...callado });
    expect(fallas).toEqual([expect.stringMatching(/el servidor se cerró al arrancar/)]);
  });
});

describe("entorno de los hijos (carcasa y prueba)", () => {
  it("en Windows las herramientas van en Local; en el resto, junto a los datos de la app", () => {
    const win = entornoHijos({ raiz: "C:\\Geeper\\resources\\app", documentos: "D", appData: "C:\\R", localAppData: "C:\\L", plataforma: "win32", puerto: 3300 });
    expect(win.GEEPER_HERRAMIENTAS).toBe("C:\\L\\Geeper\\herramientas");
    expect(win.GEEPER_HYPERFRAMES_CLI).toBe("C:\\Geeper\\resources\\app\\node_modules\\hyperframes\\bin\\hyperframes.mjs");
    const mac = entornoHijos({ raiz: "/A", documentos: "/D", appData: "/S", plataforma: "darwin", puerto: 3301 });
    expect(mac).toMatchObject({ GEEPER_HERRAMIENTAS: "/S/herramientas", GEEPER_REPO: "/A", PORT: "3301", HOSTNAME: "127.0.0.1", ELECTRON_RUN_AS_NODE: "1" });
  });
});
