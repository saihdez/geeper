/**
 * Plazos del apagado (WRK-07, ESC-11): el worker espera hasta 12 s a que sus trabajos cortados queden
 * «interrumpidos»; vigia.mjs, la carcasa y `pnpm run dev:up` no deben cortarlo antes.
 *
 * Todo en carpetas temporales: datos, base, candado de GPU falso (sin gpu-lock real) y una API de MPT
 * falsa en un puerto libre. Nada de GPU ni de contenedores.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAZO_APAGAR_MS, PLAZO_VIGIA_MS } from "../escritorio/reglas";

const RAIZ = path.join(__dirname, "..");
const VIGIA = path.join(RAIZ, "escritorio", "vigia.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-apagado-"));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  GEEPER_DATA: path.join(dir, "datos"),
  GEEPER_DB: path.join(dir, "prueba.db"),
  GEEPER_HERRAMIENTAS: path.join(dir, "herramientas"),
  GPU_LOCK: path.join(dir, "gpu.lock"),
};
delete env.GPU_LOCK_ACTIVE;
// Candado propio por archivo (nunca el gpu-lock del estudio).
env.GEEPER_GPU_LOCK_PROPIO = "1";
// La base de la prueba también la abre este proceso (para encolar y leer el estado).
for (const k of ["GEEPER_DATA", "GEEPER_DB", "GEEPER_HERRAMIENTAS", "GPU_LOCK", "GEEPER_GPU_LOCK_PROPIO"] as const) process.env[k] = env[k];

describe("plazos del apagado, de dentro hacia fuera", () => {
  it("worker (12 s) < vigía (13 s) < carcasa y dev:up (14 s)", async () => {
    const { TOPE_APAGAR_MS } = await import("../worker/sistema");
    expect(TOPE_APAGAR_MS).toBeLessThan(PLAZO_VIGIA_MS);
    expect(PLAZO_VIGIA_MS).toBeLessThan(PLAZO_APAGAR_MS);
    // vigia.mjs es JavaScript suelto (se copia tal cual a la app): su valor de fábrica debe ser el mismo.
    expect(fs.readFileSync(VIGIA, "utf8")).toContain(`|| ${PLAZO_VIGIA_MS.toLocaleString("en").replace(",", "_")};`);
  });
});

/** Proceso con su salida juntada y un «espera hasta que diga…». */
function seguir(hijo: ChildProcess) {
  let salida = "";
  hijo.stdout!.on("data", (d: Buffer) => (salida += d.toString()));
  hijo.stderr!.on("data", (d: Buffer) => (salida += d.toString()));
  const fin = new Promise<number | null>((ok) => hijo.on("close", (c) => ok(c)));
  const hasta = async (texto: string, ms = 30_000) => {
    const limite = Date.now() + ms;
    while (!salida.includes(texto)) {
      if (Date.now() > limite) throw new Error(`No apareció «${texto}» en:\n${salida}`);
      if (hijo.exitCode !== null) throw new Error(`Salió (${hijo.exitCode}) sin «${texto}»:\n${salida}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  return { hijo, salida: () => salida, hasta, fin };
}

describe.skipIf(process.platform === "win32")("apagar el worker con un trabajo en curso (WRK-07)", () => {
  let api: http.Server;
  let proyectoId = "";

  beforeAll(async () => {
    fs.mkdirSync(env.GEEPER_DATA!, { recursive: true });
    fs.mkdirSync(env.GEEPER_HERRAMIENTAS!, { recursive: true });
    execFileSync(path.join(RAIZ, "node_modules", ".bin", "prisma"), ["db", "push"], { env, stdio: "ignore" });
    // MPT falso: sólo responde que está vivo (el trabajo no pasa de «Esperando la GPU»).
    api = http.createServer((_q, r) => r.writeHead(200, { "content-type": "application/json" }).end('{"data":{"tasks":[]}}'));
    await new Promise<void>((ok) => api.listen(0, "127.0.0.1", ok));
    const a = api.address();
    env.GEEPER_MPT_API = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    const { db } = await import("@/lib/db");
    const { PLANTILLAS_INICIALES } = await import("@/lib/plantillas");
    const pl = PLANTILLAS_INICIALES[0]!;
    await db.plantilla.create({ data: { slug: pl.slug, nombre: pl.nombre, datos: pl.datos as object } });
    const p = await db.proyecto.create({ data: { slug: "apagado", nombre: "Apagado", tema: "prueba", formato: "9:16", plantilla: pl.slug } });
    proyectoId = p.id;
  }, 60_000);

  afterAll(async () => {
    api?.close();
    const { db } = await import("@/lib/db");
    await db.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Encola un «Generar con MPT» y ocupa la GPU (candado falso) para que quede esperando, en curso. */
  async function trabajoEnCurso(): Promise<string> {
    fs.writeFileSync(env.GPU_LOCK!, JSON.stringify({ pid: process.pid, quien: "prueba de apagado", desde: new Date().toISOString() }));
    const { encolar } = await import("@/lib/cola");
    return (await encolar(proyectoId, "mpt.generar", {})).id;
  }

  async function estado(id: string): Promise<{ estado: string; error: string | null }> {
    const { db } = await import("@/lib/db");
    return db.trabajo.findUniqueOrThrow({ where: { id }, select: { estado: true, error: true } });
  }

  async function hastaEsperandoGpu(id: string): Promise<void> {
    const { db } = await import("@/lib/db");
    const limite = Date.now() + 30_000;
    for (;;) {
      const t = await db.trabajo.findUniqueOrThrow({ where: { id } });
      if (t.estado === "corriendo" && t.etapa.startsWith("Esperando la GPU")) return;
      if (Date.now() > limite) throw new Error(`El trabajo no llegó a esperar la GPU: ${t.estado} «${t.etapa}» ${t.error ?? ""}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  it("con SIGTERM, el trabajo queda «interrumpido» y el worker sale bien antes del tope", async () => {
    const id = await trabajoEnCurso();
    const w = seguir(spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], { cwd: RAIZ, env, stdio: ["ignore", "pipe", "pipe"] }));
    await w.hasta("Ejecutores:");
    await hastaEsperandoGpu(id);
    const t0 = performance.now(); // monotónico: la hora del sistema puede saltar (WSL)
    w.hijo.kill("SIGTERM");
    expect(await w.fin).toBe(0);
    expect(performance.now() - t0).toBeLessThan(PLAZO_VIGIA_MS);
    expect(w.salida()).toContain("SIGTERM: apagando");
    expect(await estado(id)).toMatchObject({ estado: "interrumpido", error: expect.stringContaining("el worker se apagó") });
  }, 90_000);

  it("como en la app: al cerrarle la entrada a vigia.mjs, el worker deja el trabajo «interrumpido»", async () => {
    const id = await trabajoEnCurso();
    const w = seguir(spawn(process.execPath, ["--import", "tsx", VIGIA, "worker/index.ts"], { cwd: RAIZ, env, stdio: ["pipe", "pipe", "pipe"] }));
    await w.hasta("Ejecutores:");
    await hastaEsperandoGpu(id);
    w.hijo.stdin!.end();
    expect(await w.fin).toBe(0);
    expect(w.salida()).toContain("la app pidió cerrar");
    expect(w.salida()).toContain("SIGINT: apagando");
    expect(await estado(id)).toMatchObject({ estado: "interrumpido" });
  }, 90_000);
});

describe.skipIf(process.platform === "win32")("pnpm run dev:up espera al worker al apagar (WRK-07, WRK-02)", () => {
  /**
   * dev:up con un `pnpm` falso en el PATH: «web» sale al instante y «worker» tarda 7 s en cerrar en orden
   * (más que los 6 s de antes). Nada de next ni del puerto 3300.
   */
  function devUp() {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-devup-"));
    const marca = path.join(bin, "cerro-en-orden");
    fs.writeFileSync(
      path.join(bin, "pnpm"),
      `#!${process.execPath}
const esWorker = process.argv.includes("worker/index.ts");
process.on("SIGINT", () => {
  if (!esWorker) process.exit(0);
  setTimeout(() => { require("node:fs").writeFileSync(${JSON.stringify(marca)}, "sí"); process.exit(0); }, 7000);
});
setInterval(() => {}, 1000);
console.log(esWorker ? "worker listo" : "web lista");
`,
      { mode: 0o755 },
    );
    const p = seguir(spawn(process.execPath, ["--import", "tsx", "scripts/dev-up.ts"], { cwd: RAIZ, env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] }));
    return { ...p, marca, limpiar: () => fs.rmSync(bin, { recursive: true, force: true }) };
  }

  it.each(["SIGTERM", "SIGHUP"] as const)("con %s no sale hasta que el worker terminó de cerrar", async (senal) => {
    const d = devUp();
    try {
      await d.hasta("worker listo");
      await d.hasta("web lista");
      d.hijo.kill(senal);
      expect(await d.fin).toBe(0);
      expect(fs.existsSync(d.marca)).toBe(true);
      expect(d.salida()).toMatch(/\[worker\].*terminó \(0\)/);
    } finally {
      d.limpiar();
    }
  }, 40_000);
});
