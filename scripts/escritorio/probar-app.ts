/**
 * Prueba la app armada antes de hacer el instalador (ESC-12): arranca preparar-db y el servidor de
 * escritorio-app/ con el Node de Electron, en carpetas de datos temporales y como lo hace la carcasa
 * (escritorio/main.ts), y pide unas páginas. Si algo no viajó en la app (un módulo, el runtime de
 * Hyperframes, el esquema), falla aquí, en CI, y no en el equipo de alguien.
 *
 *   pnpm tsx scripts/escritorio/probar-app.ts [carpeta-de-la-app]
 *
 * empaquetar.ts la corre sola antes de electron-builder (GEEPER_SIN_PRUEBA=1 la salta).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { entornoHijos } from "../../escritorio/reglas";

export interface OpcionesPrueba {
  app: string;
  /** El ejecutable que corre los hijos: el de Electron (con ELECTRON_RUN_AS_NODE) o, en las pruebas, Node. */
  ejecutable: string;
  esperaMs?: number;
  log?: (linea: string) => void;
}

/** Lo que se pide al servidor y qué tiene que responder. */
export const PEDIDOS: { ruta: string; revisar: (estado: number, cuerpo: string) => string | null }[] = [
  { ruta: "/api/media", revisar: (e) => (e === 200 ? null : `respondió ${e}`) },
  {
    ruta: "/api/plantillas",
    revisar: (e, c) => {
      if (e !== 200) return `respondió ${e}: ${c.slice(0, 200)}`;
      // preparar-db siembra las plantillas iniciales: sin ellas, la base o Prisma no funcionan.
      const n = (JSON.parse(c) as { plantillas?: unknown[] }).plantillas?.length ?? 0;
      return n > 0 ? null : "no hay plantillas (preparar-db no sembró la base)";
    },
  },
  { ruta: "/", revisar: (e, c) => (e === 200 && c.includes("<html") ? null : `respondió ${e}`) },
  { ruta: "/sistema", revisar: (e) => (e === 200 ? null : `respondió ${e}`) },
];

function puertoLibre(): Promise<number> {
  return new Promise((ok, mal) => {
    const s = net.createServer();
    s.on("error", mal);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? ok(a.port) : mal(new Error("sin puerto"))));
    });
  });
}

function esperarSalida(p: ChildProcess): Promise<number | null> {
  return new Promise((ok) => (p.exitCode !== null ? ok(p.exitCode) : p.once("exit", (c) => ok(c))));
}

/** Devuelve la lista de fallas (vacía si la app arranca y responde). */
export async function probarApp(o: OpcionesPrueba): Promise<string[]> {
  const log = o.log ?? ((l: string) => console.log(l));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-probar-app-"));
  const puerto = await puertoLibre();
  const env = entornoHijos(
    { raiz: o.app, documentos: path.join(tmp, "Documentos"), appData: path.join(tmp, "appdata"), plataforma: process.platform, puerto },
    { ...process.env, GPU_LOCK: path.join(tmp, "gpu.lock") },
  );
  let salida = "";
  const juntar = (p: ChildProcess) => {
    p.stdout?.on("data", (d: Buffer) => (salida += d.toString()));
    p.stderr?.on("data", (d: Buffer) => (salida += d.toString()));
  };
  const fallas: string[] = [];
  let web: ChildProcess | null = null;
  try {
    const db = spawn(o.ejecutable, [path.join(o.app, "preparar-db.mjs")], { cwd: o.app, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    juntar(db);
    const c = await esperarSalida(db);
    if (c !== 0) {
      fallas.push(`preparar-db terminó con código ${c}`);
      return fallas;
    }
    log("preparar-db: ok");

    const standalone = path.join(o.app, "standalone");
    web = spawn(o.ejecutable, [path.join(o.app, "vigia.mjs"), path.join(standalone, "server.js")], { cwd: standalone, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    juntar(web);
    const base = `http://127.0.0.1:${puerto}`;
    const fin = Date.now() + (o.esperaMs ?? 60_000);
    for (;;) {
      if (web.exitCode !== null) {
        fallas.push(`el servidor se cerró al arrancar (código ${web.exitCode})`);
        return fallas;
      }
      if (Date.now() > fin) {
        fallas.push("el servidor no respondió a tiempo");
        return fallas;
      }
      const r = await fetch(`${base}/api/media`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
      if (r) break;
      await new Promise((ok) => setTimeout(ok, 300));
    }
    for (const p of PEDIDOS) {
      try {
        const r = await fetch(`${base}${p.ruta}`, { signal: AbortSignal.timeout(30_000) });
        const problema = p.revisar(r.status, await r.text());
        if (problema) fallas.push(`${p.ruta}: ${problema}`);
        else log(`${p.ruta}: ok`);
      } catch (e) {
        fallas.push(`${p.ruta}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return fallas;
  } finally {
    if (web && web.exitCode === null) {
      web.stdin?.end();
      const t = setTimeout(() => web?.kill("SIGKILL"), 6000);
      await esperarSalida(web);
      clearTimeout(t);
    }
    if (fallas.length) log(`--- salida de los procesos ---\n${salida.slice(-4000)}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** El ejecutable de Electron instalado en el repo (el mismo Node que usa la app instalada). */
export function electronDelRepo(): string {
  return createRequire(__filename)("electron") as string;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const app = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "..", "escritorio-app"));
  void probarApp({ app, ejecutable: electronDelRepo() }).then((fallas) => {
    if (fallas.length) {
      console.error(`La app armada no funciona:\n  ${fallas.join("\n  ")}`);
      process.exit(1);
    }
    console.log("La app armada arranca y responde.");
  });
}
