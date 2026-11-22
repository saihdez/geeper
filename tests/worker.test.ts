/**
 * El worker como proceso, con datos, base y candado de GPU en carpetas temporales (nada de GPU ni de
 * gpu-lock reales: GEEPER_HERRAMIENTAS apunta a una carpeta sin `bin/gpu-lock`).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-worker-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GEEPER_DATA: path.join(dir, "datos"),
  GEEPER_DB: path.join(dir, "prueba.db"),
  GEEPER_HERRAMIENTAS: path.join(dir, "herramientas"),
  GPU_LOCK: path.join(dir, "gpu.lock"),
};
delete env.GPU_LOCK_ACTIVE;

beforeAll(() => {
  fs.mkdirSync(env.GEEPER_DATA!, { recursive: true });
  fs.mkdirSync(env.GEEPER_HERRAMIENTAS!, { recursive: true });
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env, stdio: "ignore" });
}, 60_000);

interface Worker {
  hijo: ChildProcess;
  salida: () => string;
  /** Espera a que la salida contenga `texto`. */
  hasta: (texto: string | RegExp, ms?: number) => Promise<void>;
  fin: Promise<number | null>;
}

/** Un solo proceso (sin el envoltorio de la CLI de tsx, que no reenvía SIGHUP). */
function lanzarWorker(extra: Record<string, string | undefined> = {}): Worker {
  const hijo = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  hijo.stdout!.on("data", (d: Buffer) => (salida += d.toString()));
  hijo.stderr!.on("data", (d: Buffer) => (salida += d.toString()));
  const fin = new Promise<number | null>((ok) => hijo.on("close", (c) => ok(c)));
  const hasta = async (texto: string | RegExp, ms = 30_000) => {
    const limite = Date.now() + ms;
    while (!(typeof texto === "string" ? salida.includes(texto) : texto.test(salida))) {
      if (Date.now() > limite) throw new Error(`No apareció «${texto}» en:\n${salida}`);
      if (hijo.exitCode !== null) throw new Error(`El worker salió (${hijo.exitCode}) sin «${texto}»:\n${salida}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  return { hijo, salida: () => salida, hasta, fin };
}

describe.skipIf(process.platform === "win32")("worker como proceso", () => {
  it("cerrar la terminal (SIGHUP) apaga con orden (WRK-02)", async () => {
    const w = lanzarWorker();
    await w.hasta("Ejecutores:");
    w.hijo.kill("SIGHUP");
    expect(await w.fin).toBe(0);
    expect(w.salida()).toContain("SIGHUP: apagando");
  });

  it("si la base queda bloqueada más de 10 s, el latido avisa y el worker sigue vivo (WRK-08)", async () => {
    const w = lanzarWorker();
    await w.hasta("Ejecutores:");
    const { DatabaseSync } = await import("node:sqlite");
    const otra = new DatabaseSync(env.GEEPER_DB!);
    otra.exec("BEGIN EXCLUSIVE");
    try {
      // El latido del sistema va cada 15 s y la espera de bloqueo es de 10 s.
      await w.hasta("No se pudo guardar el latido del worker", 40_000);
    } finally {
      otra.exec("COMMIT");
      otra.close();
    }
    expect(w.hijo.exitCode).toBeNull();
    w.hijo.kill("SIGTERM");
    expect(await w.fin).toBe(0);
  }, 60_000);

  it("no arranca dentro de gpu-lock: avisa y sale (GPU-11)", async () => {
    const w = lanzarWorker({ GPU_LOCK_ACTIVE: "1" });
    expect(await w.fin).toBe(1);
    expect(w.salida()).toContain("dentro de gpu-lock");
  });

  it("un segundo worker sobre la misma cola avisa y no arranca (WRK-10)", async () => {
    const a = lanzarWorker();
    await a.hasta("Ejecutores:");
    const b = lanzarWorker({ GEEPER_WORKER_ESPERA_MS: "500" });
    expect(await b.fin).toBe(1);
    expect(b.salida()).toContain("Ya hay otro worker atendiendo esta cola");
    a.hijo.kill("SIGTERM");
    expect(await a.fin).toBe(0);
    // Muerto el primero, el siguiente arranca sin esperar.
    const c = lanzarWorker();
    await c.hasta("Ejecutores:", 10_000);
    c.hijo.kill("SIGTERM");
    expect(await c.fin).toBe(0);
  }, 60_000);
});
